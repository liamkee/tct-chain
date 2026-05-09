import type { Env } from '../index'
import { DiscordWebhookService } from './discord_webhook'
import { TacticalCalculator } from './calculator'

export class ChainMonitor implements DurableObject {
  private state: DurableObjectState;
  private env: Env['Bindings'];
  private microLogs: Array<{ts: number, msg: string}> = [];
  
  // 内存态缓存 (用于去重)
  private factionId: string | null = null;
  private commanderKeyCache: string | null = null;
  private lastChainCurrent: number = -1;
  private lastChainTimeout: number = -1;
  private lastChainMax: number = 10;
  private lastChainDeadlineMs: number = 0;
  private memberStatusCache: Map<string, string> = new Map(); // id -> stringified status
  private memberMinutesCache: Map<string, number> = new Map(); // id -> last reported minute
  private hpmHistory: number[] = []; // 存储每 10 秒的击数增量，最大长度 30 (5分钟)
  private lastRTT: number = 0; // 最近一次 API 往返延迟 (ms)
  private manualOffset: number = 0; // 指挥官手动微调 (ms)
  public lastUpdatedAt: number = 0; // 纯内存心跳
  private lastEmergencyAlertTs: number = 0; // Discord 防骚扰限流 (内存态)
  private memberDataCache: Map<string, any> = new Map(); // 完整的成员内存缓存 (用于对比)
  private lastPersistenceTs: number = 0; // 上次强制存盘时间
  private dbMembersCache: any[] = []; // DB 成员列表内存快取
  private lastDbMembersTs: number = 0; // 上次查 DB 的时间
  private tokenBuckets: Map<string, { tokens: number, resetAt: number }> = new Map(); // 纯内存 Token bucket
  private pendingPolls: Map<string, number> = new Map(); // Action-Driven Polling 追踪

  constructor(state: DurableObjectState, env: Env['Bindings']) {
    this.state = state;
    this.env = env;

    // 🚀 Hibernation Recovery: restore critical state from consolidated storage keys
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<any>([
        'faction_id',
        'system_state',
        'chain_state',
        'manual_offset',
      ]);
      
      const storedMap = stored as Map<string, any>;
      this.factionId = storedMap.get('faction_id') ?? null;
      this.manualOffset = storedMap.get('manual_offset') ?? 0;

      // Restore system state (1 key instead of 8)
      const sys = storedMap.get('system_state') ?? {};
      this.microLogs = sys.micro_logs ?? [];
      this.hpmHistory = sys.hpm_history ?? [];
      this.lastRTT = sys.last_rtt ?? 0;
      if (sys.member_status_cache) {
        this.memberStatusCache = new Map(Object.entries(sys.member_status_cache));
      }
      if (sys.member_minutes_cache) {
        this.memberMinutesCache = new Map(Object.entries(sys.member_minutes_cache));
      }

      // Restore chain state (1 key instead of 4)
      const chain = storedMap.get('chain_state') ?? {};
      this.lastChainCurrent = chain.current ?? -1;
      this.lastChainTimeout = chain.timeout ?? -1;
      this.lastChainMax = chain.max ?? 10;
      this.lastChainDeadlineMs = chain.deadline_ms ?? 0;

      // 🚀 Load all members from consolidated single-key-per-member storage
      const allStorage = await this.state.storage.list({ prefix: 'member_' });
      for (const [key, value] of allStorage.entries()) {
        const id = key.replace('member_', '');
        this.memberDataCache.set(id, value as any);
      }
      console.log(`[DO] Startup: Loaded ${this.memberDataCache.size} members into memory cache.`);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // 🚀 WebSocket 升级握手
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected Upgrade: websocket', { status: 426 });
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      const userId = url.searchParams.get('userId') || 'anonymous';
      this.state.acceptWebSocket(server, [userId]);

      return new Response(null, { status: 101, webSocket: client });
    }

    // 暴露状态查询给 Dashboard
    if (url.pathname === '/status') {
      return new Response(JSON.stringify({ 
        factionId: this.factionId,
        lastUpdatedAt: this.lastUpdatedAt,
        chainCurrent: this.lastChainCurrent,
        chainTimeout: this.lastChainTimeout
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/toggle') {
      const { state } = await request.json() as { state: 'ON' | 'OFF' };
      
      await this.state.storage.put('master_switch', state);

      if (state === 'ON') {
        const currentAlarm = await this.state.storage.getAlarm();
        if (currentAlarm === null) {
          await this.state.storage.setAlarm(Date.now());
        }
      }

      return new Response(JSON.stringify({ success: true, state }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } else if (url.pathname === '/internal/init') {
      const { factionId } = await request.json() as { factionId: string };
      this.factionId = factionId;
      await this.state.storage.put('faction_id', factionId);
      return new Response(JSON.stringify({ success: true, factionId }));
    } else if (url.pathname === '/internal/token') {
      const { apiKey, count } = await request.json() as { apiKey: string, count: number };
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiKey));
      const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
      const bucketKey = `token_${hashHex}`;
      
      const now = Date.now();
      let bucket = this.tokenBuckets.get(bucketKey) || { tokens: 90, resetAt: now + 60000 };
      
      if (now > bucket.resetAt) {
        bucket = { tokens: 90, resetAt: now + 60000 };
      }
      
      if (bucket.tokens >= count) {
        bucket.tokens -= count;
        this.tokenBuckets.set(bucketKey, bucket);
        return new Response(JSON.stringify({ allowed: true, remaining: bucket.tokens }), { headers: { 'Content-Type': 'application/json' } });
      } else {
        return new Response(JSON.stringify({ allowed: false, remaining: bucket.tokens, resetIn: bucket.resetAt - now }), { status: 429, headers: { 'Content-Type': 'application/json' } });
      }
    }

    if (url.pathname === '/internal/offset') {
      const { offset } = await request.json() as { offset: number };
      this.manualOffset = offset;
      await this.state.storage.put('manual_offset', offset);
      this.dispatchAlert(`Manual Sync Offset adjusted to ${offset}ms`);
      return new Response(JSON.stringify({ success: true, offset }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 🚀 批量数据写入接口
    if (url.pathname === '/internal/update-members-batch') {
       if (request.method === 'POST') {
          const items = await request.json() as any[];
          const storageUpdates: Record<string, any> = {};
          let needsStoragePut = false;
          
          for (const item of items) {
             const stringId = item.id.toString();
             const oldData = this.memberDataCache.get(stringId) || {};
             
             const successState = `${oldData.last_action?.timestamp || 0}_${oldData.status?.state || 'Unknown'}`;
             const newData = { 
                 ...oldData, 
                 ...item.updates,
                 last_successful_state: successState
             };

             // 只比較能量和冷卻是否實質改變 (忽略 last_updated 帶來的必然後果)
             const hasChanged = JSON.stringify({e: oldData.energy, c: oldData.cooldowns}) !== 
                              JSON.stringify({e: newData.energy, c: newData.cooldowns});
             
             if (hasChanged) {
                this.broadcastToWebSockets({ 
                  type: 'MEMBER_SOFT_UPDATE', 
                  id: stringId, 
                  data: newData 
                });
             }
             
             // 永遠更新內存快取 (包含 last_updated 和 last_successful_state)
             this.memberDataCache.set(stringId, newData);

             // 2. 只有关键变化才立即存盘，否则只更新内存
             // 关键变化：状态改变、能量大幅波动(>20)、或者距离上次存盘超过 5 分钟
             const isCritical = !oldData || 
                              oldData.status?.state !== newData.status?.state || 
                              Math.abs((oldData.energy || 0) - (newData.energy || 0)) > 20 ||
                              Date.now() - this.lastPersistenceTs > 300000;

             if (isCritical) {
                // Store entire member as 1 key (not per-field)
                storageUpdates[`member_${stringId}`] = newData;
                needsStoragePut = true;
             }
          }
          
          if (needsStoragePut) {
             await this.state.storage.put(storageUpdates);
             this.lastPersistenceTs = Date.now();
          }
          return new Response('OK');
       }
    }

    // 🚀 批量日志接口
    if (url.pathname === '/internal/log-batch') {
       if (request.method === 'POST') {
          const { msgs } = await request.json() as { msgs: string[] };
          for (const msg of msgs) {
             this.microLogs.push({ ts: Date.now(), msg });
          }
          while (this.microLogs.length > 20) this.microLogs.shift();
          this.broadcastToWebSockets({ type: 'LOG_UPDATE', microLogs: this.microLogs, do_server_time_ms: Date.now() });
          return new Response('OK');
       }
    }

    if (url.pathname === '/snapshot') {
       const predicted = this.getMembersWithPrediction();
       const members: Record<string, any> = {};
       for (const [id, data] of Object.entries(predicted.members)) {
          members[`member_${id}`] = data;
       }

       return new Response(JSON.stringify({
         factionId: this.factionId,
         members,
         microLogs: this.microLogs,
         chain_current: this.lastChainCurrent,
         chain_timeout: this.lastChainTimeout,
         chain_deadline_ms: this.lastChainDeadlineMs,
         chain_max: this.lastChainMax,
         current_hpm: this.hpmHistory.length > 0 ? (this.hpmHistory.reduce((a, b) => a + b, 0) / this.hpmHistory.length) * 2 : 0,
         lastUpdatedAt: this.lastUpdatedAt,
         do_server_time_ms: Date.now(),
         predictedCount: predicted.predictedCount
       }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/internal/stop') {
       await this.state.storage.put('master_switch', 'OFF');
       return new Response('System Stopped');
    }

    if (url.pathname === '/internal/start') {
       await this.state.storage.setAlarm(Date.now() + 100);
       await this.state.storage.put('master_switch', 'ON');
       return new Response('System Started');
    }

    if (url.pathname === '/internal/clear') {
       await this.state.storage.deleteAll();
       this.memberStatusCache.clear();
       this.memberMinutesCache.clear();
       return new Response('Storage Cleared');
    }

    return new Response('Not Found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const data = JSON.parse(message.toString());
      if (data.type === 'REQ_SNAPSHOT') {
        const snapshot = await this.getFullSnapshot();
        ws.send(JSON.stringify({ type: 'SNAPSHOT', data: snapshot }));
      }
      if (data.type === 'UPDATE_SQUAD') {
        await this.state.storage.put('global_selected_members', data.members);
        this.broadcastToWebSockets({ type: 'SQUAD_UPDATED', members: data.members });
      }
    } catch (e) {
      console.error('[WS] Message parse error', e);
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    console.log(`[WS] Closed: ${code} ${reason}`);
  }

  async webSocketError(ws: WebSocket, error: any): Promise<void> {
    console.error('[WS] Error:', error);
  }

  private async getFullSnapshot() {
    // Use memory cache — no storage.list() needed
    const predicted = this.getMembersWithPrediction();
    const data: Record<string, any> = {};

    for (const [id, memberData] of Object.entries(predicted.members)) {
      data[`member_${id}`] = memberData;
    }

    // Chain data from memory (no storage reads needed)
    data['chain_current'] = this.lastChainCurrent;
    data['chain_timeout'] = this.lastChainTimeout;
    data['chain_deadline_ms'] = this.lastChainDeadlineMs;
    data['chain_max'] = this.lastChainMax;
    data['global_selected_members'] = await this.state.storage.get('global_selected_members') || [];

    return {
      ...data,
      factionId: this.factionId,
      lastUpdatedAt: this.lastUpdatedAt,
      microLogs: this.microLogs,
      predictedCount: predicted.predictedCount
    };
  }

  async alarm() {
    try {
      if (!this.factionId) {
        console.error('[DO] No factionId set. Alarm stopping.');
        return;
      }

      // Fetch DB members with 24-hour cache (avoids D1 queries every 30s)
      const nowTs = Date.now();
      if (this.dbMembersCache.length === 0 || (nowTs - this.lastDbMembersTs > 86400000)) {
        const dbResult = await this.env.DB.prepare('SELECT torn_id, name, api_key FROM Members WHERE faction_id = ? AND api_key IS NOT NULL').bind(this.factionId).all();
        this.dbMembersCache = dbResult.results as any[];
        this.lastDbMembersTs = nowTs;
      }
      const dbMembers = this.dbMembersCache;

      let switchState = await this.state.storage.get<string>('master_switch');
      if (!switchState) {
        switchState = 'ON'; 
        await this.state.storage.put('master_switch', 'ON');
      }

      if (switchState === 'OFF') {
        return;
      }

      await this.state.storage.setAlarm(Date.now() + 30000);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      let chainData: any = null;
      let membersData: any = null;

      try {
        if (!this.commanderKeyCache) {
          // 在多租户模式下，如果没有 Faction 表，我们可以尝试从 DB 里的成员中随便选一个有效 Key
          // 或者要求每个 Faction 必须有一个 Commander Key
          if (dbMembers.length > 0) {
            const firstWithKey = dbMembers.find((m: any) => m.api_key && m.api_key !== '');     
            if (firstWithKey?.api_key) {
               const security = new (await import('../services/security')).SecurityService(this.env.ENCRYPTION_SECRET);
               this.commanderKeyCache = await security.decrypt(firstWithKey.api_key);
            }
          }
        }

        const apiKey = this.commanderKeyCache || this.env.COMMANDER_API_KEY;

        const t1 = Date.now();
        const res = await fetch(`https://api.torn.com/faction/${this.factionId}?selections=basic&key=${apiKey}`, { signal: controller.signal });
        const t2 = Date.now();
        this.lastRTT = t2 - t1;

        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        
        const data = await res.json() as any;
        if (data.error) throw new Error(`Torn API Error: ${data.error.error}`);
        
        chainData = data.chain;
        membersData = data.members || {};
        
      } catch (fetchErr: any) {
        if (fetchErr.name === 'AbortError') throw new Error('Torn API timeout (5s)');
        throw fetchErr;
      } finally {
        clearTimeout(timeoutId);
      }

      let hasChanges = false;
      const storageUpdates: Record<string, any> = {};
      let currentHPM = 0;
      let recentHPM = 0;

      if (chainData) {
        const { timeout, current, max } = chainData;
        const adjustedTimeout = Math.max(0, timeout - (this.lastRTT / 2 / 1000) + (this.manualOffset / 1000));
        
        if (this.hpmHistory.length >= 6) {
          const last6 = this.hpmHistory.slice(-6);
          recentHPM = last6.reduce((a, b) => a + b, 0);
        }
        if (this.hpmHistory.length > 10) {
          const sorted = [...this.hpmHistory].sort((a, b) => a - b);
          const trimmed = sorted.slice(2, -2);
          const sum = trimmed.reduce((a, b) => a + b, 0);
          currentHPM = (sum / trimmed.length) * 2;
        } else {
          const sum = this.hpmHistory.reduce((a, b) => a + b, 0);
          currentHPM = (sum / (this.hpmHistory.length || 1)) * 2;
        }

        if (current !== this.lastChainCurrent || timeout !== this.lastChainTimeout) {
          if (this.lastChainCurrent !== -1) {
            const hitsDelta = Math.max(0, current - this.lastChainCurrent);
            this.hpmHistory.push(hitsDelta);
            if (this.hpmHistory.length > 30) this.hpmHistory.shift();
          }

          // Chain data consolidated into single key
          storageUpdates['chain_state'] = {
            timeout: adjustedTimeout,
            deadline_ms: Math.floor(Date.now() - (this.lastRTT / 2) + (timeout * 1000) + this.manualOffset),
            current,
            max,
          };
          this.lastChainCurrent = current;
          this.lastChainTimeout = timeout;
          this.lastChainMax = max;
          this.lastChainDeadlineMs = storageUpdates['chain_state'].deadline_ms;
          hasChanges = true;
        } else {
           this.hpmHistory.push(0);
           if (this.hpmHistory.length > 30) this.hpmHistory.shift();
        }
      }

      if (membersData) {
        const now = Math.floor(Date.now() / 1000);
        for (const [id, member] of Object.entries(membersData) as [string, any][]) {
          if (member.last_action?.timestamp && member.last_action?.seconds === undefined) {
            member.last_action.seconds = now - member.last_action.timestamp;
          }

          const currentStatusStr = `${member.status?.state}_${member.last_action?.status}`;
          const currentMinutes = Math.floor((member.last_action?.seconds || 0) / 60);
            
          const cachedStatusStr = this.memberStatusCache.get(id);
          const cachedMinutes = this.memberMinutesCache.get(id);

          if (currentStatusStr !== cachedStatusStr || currentMinutes !== cachedMinutes) {
            // Merge faction API data into member's single-key cache
            const existing = this.memberDataCache.get(id) || {};
            const merged = { ...existing, name: member.name, status: member.status, last_action: member.last_action };
            this.memberDataCache.set(id, merged);
            storageUpdates[`member_${id}`] = merged;
            
            this.memberStatusCache.set(id, currentStatusStr);
            this.memberMinutesCache.set(id, currentMinutes);
            hasChanges = true;
          }
        }

        if (hasChanges) {
          // DO NOT storage.put here yet, merge with the final batch
          for (const [key, value] of Object.entries(storageUpdates)) {
            if (key.startsWith('member_')) {
              const id = key.replace('member_', '');
              this.broadcastToWebSockets({ type: 'MEMBER_SOFT_UPDATE', id, data: value, do_server_time_ms: Date.now() });
            }
          }
        }

        // 🚀 核心调度逻辑 (仅本帮派成员)
        const activeMemberKeys = new Map(dbMembers.map((m: any) => [m.torn_id.toString(), m.api_key]));

        let offlineSkipped = 0;
        let actionSkipped = 0;
        const membersToUpdate = Object.keys(membersData).filter(id => {
          if (!activeMemberKeys.has(id)) return false;
          const member = membersData[id];
          const status = member.status;
          const currentState = `${member.last_action?.timestamp || 0}_${status?.state || 'Unknown'}`;

          if (status) {
            if ((status.state === 'Hospital' || status.state === 'Jail') && (status.until || 0) > Date.now() / 1000 + 3600) return false;
            if (status.state === 'Traveling') return false;
          }

          // 🚀 Action-Driven Polling
          const cached = this.memberDataCache.get(id);
          if (cached && cached.last_successful_state === currentState) {
             if (member.last_action?.status === 'Offline') {
                offlineSkipped++;
             } else {
                actionSkipped++;
             }
             return false;
          }

          // 防止短期內重複加入佇列
          const pendingKey = `${id}_${currentState}`;
          const lastQueuedTs = this.pendingPolls.get(pendingKey);
          if (lastQueuedTs && Date.now() < lastQueuedTs + 120000) {
             return false;
          }

          this.pendingPolls.set(pendingKey, Date.now());
          return true;
        });

        if (offlineSkipped > 0 || actionSkipped > 0) {
          console.log(`[DO] Action-Driven Polling: skipped ${offlineSkipped} offline, ${actionSkipped} inactive online members.`);
        }

        const memberMessages = membersToUpdate.map(id => ({ body: { tornId: id, apiKey: activeMemberKeys.get(id), ts: Date.now() }}));

        if (memberMessages.length > 0) {
          for (let i = 0; i < memberMessages.length; i += 100) {
             await this.env.MEMBER_QUEUE.sendBatch(memberMessages.slice(i, i + 100));
          }
        }
      }

      this.lastUpdatedAt = Date.now();
      
      const predicted = this.getMembersWithPrediction();
      const allMembersData = predicted.members;
      const selectedIds: string[] = (await this.state.storage.get('global_selected_members')) || [];

      if (predicted.predictedCount > 0) {
         console.log(`[DO] Offline prediction applied to ${predicted.predictedCount} members.`);
      }

      // Fill in members who are in DB but not yet in DO storage
      for (const member of dbMembers) {
        const id = member.torn_id.toString();
        if (!allMembersData[id]) {
          allMembersData[id] = {
            id: id,
            name: member.name,
            energy: 0,
            energy_max: 100,
            cooldowns: { drug: 0, medical: 0, booster: 0 },
            status: { state: 'Okay', until: 0 },
            last_action: { status: 'Offline', seconds: 0 },
            refill_used: false,
            is_donator: false,
            is_pending: true // Mark as pending first poll
          };
        }
      }

      const aggregate = TacticalCalculator.aggregate(allMembersData, selectedIds);

      // 🚀 Conditional persistence: only write when data actually changed.
      // Consolidated into faction updates + 1 system key
      if (hasChanges) {
        storageUpdates['system_state'] = {
          micro_logs: this.microLogs,
          hpm_history: this.hpmHistory,
          last_rtt: this.lastRTT,
          member_status_cache: Object.fromEntries(this.memberStatusCache),
          member_minutes_cache: Object.fromEntries(this.memberMinutesCache),
        };
        await this.state.storage.put(storageUpdates);
      }
      
      this.broadcastToWebSockets({ 
        type: 'HEARTBEAT', 
        lastUpdatedAt: this.lastUpdatedAt, 
        do_server_time_ms: Date.now(),
        microLogs: this.microLogs,
        hpm: currentHPM,
        recentHPM,
        trend: recentHPM > currentHPM ? 'UP' : (recentHPM < currentHPM ? 'DOWN' : 'STABLE'),
        eta: currentHPM > 0 ? Math.max(0, this.lastChainMax - this.lastChainCurrent) / currentHPM : -1,
        aggregate
      });

    } catch (err: any) {
      this.microLogs.push({ ts: Date.now(), msg: `alarm error: ${err.message}` });
      if (this.microLogs.length > 20) this.microLogs.shift();
    }
  }

  // ============================================================
  // 🚀 Prediction Engine: Shared helper for all data output paths
  // Used by /snapshot, getFullSnapshot (WS), and alarm() aggregation.
  //
  // Energy prediction: OFFLINE members only (can't predict active attacks)
  // Cooldown prediction: ALL members (CD countdown is deterministic)
  // ============================================================
  private getMembersWithPrediction(): { members: Record<string, any>; predictedCount: number } {
    const members: Record<string, any> = {};
    let predictedCount = 0;

    for (const [id, data] of this.memberDataCache.entries()) {
      if (data.energy !== undefined) {
        const isDonator = data.is_donator ?? (data.energy_max || 100) > 100;
        const lastUpdated = data.last_updated || 0;

        const isOffline = data.last_action?.status === 'Offline' ||
                          data.status?.state === 'Traveling' ||
                          ((data.status?.state === 'Hospital' || data.status?.state === 'Jail') &&
                           (data.status?.until || 0) > Date.now() / 1000 + 3600);

        // --- Energy prediction: OFFLINE only ---
        let currentEnergy = data.energy;
        let energyPredicted = false;

        if (isOffline && lastUpdated > 0) {
          const energyPred = TacticalCalculator.predictCurrentEnergy(
            data.energy, data.energy_max || 100, lastUpdated, isDonator
          );
          currentEnergy = energyPred.energy;
          energyPredicted = true;
          predictedCount++;
        }

        // --- Cooldown prediction: ALL members ---
        let currentCooldowns = data.cooldowns;
        let cdNeedsRefresh = { drug: false, booster: false, medical: false };

        if (lastUpdated > 0 && data.cooldowns) {
          const cdResult = TacticalCalculator.predictCurrentCooldowns(
            data.cooldowns, lastUpdated
          );
          currentCooldowns = cdResult.predicted;

          // For offline members, refresh is never needed (can't use items)
          if (!isOffline) {
            cdNeedsRefresh = cdResult.needsRefresh;
          }
        }

        members[id] = {
          id,
          name: data.name,
          energy: currentEnergy,
          energy_max: data.energy_max || 100,
          cooldowns: currentCooldowns,
          status: data.status,
          last_action: data.last_action,
          refill_used: data.refill_used,
          is_donator: isDonator,
          is_predicted: energyPredicted,
          cd_needs_refresh: cdNeedsRefresh,
          last_updated: lastUpdated,
        };
      }
    }

    return { members, predictedCount };
  }

  private broadcastToWebSockets(payload: any) {
    const websockets = this.state.getWebSockets();
    const message = JSON.stringify(payload);
    websockets.forEach(ws => {
      try { ws.send(message); } catch (e) {}
    });
  }

  private dispatchAlert(msg: string) {
    this.microLogs.push({ ts: Date.now(), msg: `⚠️ ${msg}` });
    if (this.microLogs.length > 20) this.microLogs.shift();
    this.broadcastToWebSockets({ type: 'LOG_UPDATE', microLogs: this.microLogs });
  }
}
