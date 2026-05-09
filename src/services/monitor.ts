// Tactical Engine - v1.3.2 - Stable Sync
import type { Env } from '../index'
import { DiscordWebhookService } from './discord_webhook'
import { TacticalCalculator } from './calculator'

export class ChainMonitor implements DurableObject {
  private state: DurableObjectState;
  private env: Env['Bindings'];
  private microLogs: Array<{ ts: number, msg: string }> = [];

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
  private masterSwitch: 'ON' | 'OFF' = 'OFF';

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
        'master_switch',
      ]);

      const storedMap = stored as Map<string, any>;
      this.factionId = storedMap.get('faction_id') ?? null;
      this.manualOffset = storedMap.get('manual_offset') ?? 0;
      this.masterSwitch = storedMap.get('master_switch') ?? 'OFF';

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
      this.microLogs.push({ ts: Date.now(), msg: `Engine loaded: ${this.memberDataCache.size} cached members` });
      
      // 🚀 Pre-fetch DB members so they are available for immediate snapshots
      if (this.factionId) {
        this.syncDbMembers().catch(e => console.error('[DO] Startup DB sync failed', e));
      }

      // 🚀 AUTO-RESUME: If switch was ON, start the alarm immediately
      if (this.masterSwitch === 'ON') {
        const currentAlarm = await this.state.storage.getAlarm();
        if (currentAlarm === null) {
          await this.state.storage.setAlarm(Date.now() + 100);
          console.log(`[DO] Startup: Auto-resuming tactical scan...`);
        }
      }
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

      // 🚀 NEW: Send immediate snapshot to the new client
      this.getFullSnapshot().then(snapshot => {
        server.send(JSON.stringify({
          type: 'SNAPSHOT',
          data: snapshot
        }));
      });

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
      this.masterSwitch = state;
      console.log(`[DO] Master Switch toggled to: ${state}`);

      // 🚀 NEW: Sync state to KV for Queue Consumer and Edge Middleware
      if (this.env.TCT_KV) {
        await this.env.TCT_KV.put('SYSTEM_MASTER_SWITCH', state);
      }

      if (state === 'ON') {
        const currentAlarm = await this.state.storage.getAlarm();
        if (currentAlarm === null) {
          await this.state.storage.setAlarm(Date.now());
        }
      }

      // 🚀 NEW: Broadcast the switch change to ALL connected clients immediately
      this.broadcastToWebSockets({
        type: 'HEARTBEAT',
        master_switch: state,
        lastUpdatedAt: this.lastUpdatedAt,
        do_server_time_ms: Date.now()
      });

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
          const hasChanged = JSON.stringify({ e: oldData.energy, c: oldData.cooldowns }) !==
            JSON.stringify({ e: newData.energy, c: newData.cooldowns });

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
        predictedCount: predicted.predictedCount,
        master_switch: this.masterSwitch
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/internal/stop') {
      await this.state.storage.put('master_switch', 'OFF');
      this.masterSwitch = 'OFF';
      this.microLogs.push({ ts: Date.now(), msg: 'Engine Manual Stop: Polling suspended' });
      this.broadcastToWebSockets({ 
        type: 'HEARTBEAT', 
        master_switch: 'OFF',
        lastUpdatedAt: this.lastUpdatedAt,
        do_server_time_ms: Date.now()
      });
      return new Response('System Stopped');
    }

    if (url.pathname === '/internal/start') {
      await this.state.storage.setAlarm(Date.now() + 100);
      await this.state.storage.put('master_switch', 'ON');
      this.masterSwitch = 'ON';
      this.microLogs.push({ ts: Date.now(), msg: 'Engine Manual Start: Polling initiated' });

      // 🚀 Ensure we have the latest member list from DB before broadcasting
      await this.syncDbMembers();

      // 🚀 Immediate broadcast of full snapshot so members appear instantly
      const snapshot = await this.getFullSnapshot();
      this.broadcastToWebSockets({ 
        type: 'SNAPSHOT', 
        data: snapshot 
      });

      return new Response('System Started');
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
    // Use the prediction engine to get the latest state of all 40 members
    const predicted = this.getMembersWithPrediction();
    
    // Get target from storage (default to 100 if not set)
    const chainTarget = await this.state.storage.get<number>('chain_target') || 100;

    // --- HPM & Metrics ---
    let currentHPM = 0;
    let recentHPM = 0;
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

    // --- Tactical Aggregate ---
    // For now we use all predicted members as the pool
    const selectedIds = Object.keys(predicted.members);
    const aggregate = (await import('../services/calculator')).TacticalCalculator.aggregate(predicted.members, selectedIds);

    return {
      members: predicted.members,
      chain_current: this.lastChainCurrent,
      chain_timeout: this.lastChainTimeout,
      chain_deadline_ms: this.lastChainDeadlineMs,
      chain_max: this.lastChainMax,
      chain_target: chainTarget,
      hpm: currentHPM,
      recentHPM,
      trend: recentHPM > currentHPM ? 'UP' : (recentHPM < currentHPM ? 'DOWN' : 'STABLE'),
      eta: currentHPM > 0 ? Math.max(0, this.lastChainMax - this.lastChainCurrent) / currentHPM : -1,
      aggregate,
      factionId: this.factionId,
      lastUpdatedAt: this.lastUpdatedAt,
      microLogs: this.microLogs,
      master_switch: this.masterSwitch,
      do_server_time_ms: Date.now()
    };
  }

  async alarm() {
    try {
      if (!this.factionId) {
        console.error('[DO] No factionId set. Alarm stopping.');
        return;
      }

      if (this.masterSwitch === 'OFF') return;

      // 1. Reschedule next alarm
      await this.state.storage.setAlarm(Date.now() + 30000);

      // 2. Prepare context
      await this.syncDbMembers();
      const dbMembers = this.dbMembersCache;
      const apiKey = this.commanderKeyCache || this.env.COMMANDER_API_KEY;
      if (!apiKey) {
        console.error('[DO] No commander API key available.');
        return;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      try {
        // 3. Fetch Faction Basic
        const res = await fetch(`https://api.torn.com/faction/${this.factionId}?selections=basic&key=${apiKey}`, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        const data = await res.json() as any;
        if (data.error) throw new Error(`Torn API Error: ${data.error.error}`);

        const chainData = data.chain;
        const membersData = data.members || {};
        const storageUpdates: Record<string, any> = {};
        let hasChanges = false;

        // 4. Process Chain
        if (chainData) {
          const { timeout, current, max } = chainData;
          if (current !== this.lastChainCurrent || timeout !== this.lastChainTimeout) {
            storageUpdates['chain_state'] = {
              timeout,
              deadline_ms: Date.now() + (timeout * 1000),
              current,
              max,
            };
            this.lastChainCurrent = current;
            this.lastChainTimeout = timeout;
            this.lastChainMax = max;
            this.lastChainDeadlineMs = storageUpdates['chain_state'].deadline_ms;
            hasChanges = true;
          }
        }

        // 5. Process Members basic status
        for (const [id, m] of Object.entries(membersData) as [string, any][]) {
          const existing = this.memberDataCache.get(id) || {};
          const currentStatusStr = `${m.status?.state}_${m.last_action?.status}`;
          
          if (currentStatusStr !== this.memberStatusCache.get(id) || !existing.name) {
            const merged = {
              ...existing,
              id,
              name: m.name || existing.name || 'Unknown',
              status: m.status,
              last_action: m.last_action
            };
            this.memberDataCache.set(id, merged);
            storageUpdates[`member_${id}`] = merged;
            this.memberStatusCache.set(id, currentStatusStr);
            hasChanges = true;
          }
        }

        // 6. Queue Individual Polls (Action-Driven)
        const activeMemberKeys = new Map((dbMembers || []).map((m: any) => [m.torn_id.toString(), m.api_key]));
        const membersToUpdate = Object.keys(membersData).filter(id => {
          if (!activeMemberKeys.get(id)) return false;
          const m = membersData[id];
          const status = m.status?.state;
          if (status === 'Hospital' || status === 'Jail' || status === 'Traveling') return false;
          
          const pendingKey = `${id}_${m.last_action?.timestamp}`;
          if (this.pendingPolls.has(pendingKey)) return false;
          this.pendingPolls.set(pendingKey, Date.now());
          return true;
        });

        if (membersToUpdate.length > 0) {
          const batch = membersToUpdate.map(id => ({
            body: { tornId: id, apiKey: activeMemberKeys.get(id), factionId: this.factionId, ts: Date.now() }
          }));
          await this.env.MEMBER_QUEUE.sendBatch(batch);
          console.log(`[DO] Queued ${batch.length} member polls.`);
        }

        // 7. Persistence
        if (hasChanges) {
          storageUpdates['system_state'] = {
            micro_logs: this.microLogs,
            hpm_history: this.hpmHistory,
            last_rtt: this.lastRTT,
            member_status_cache: Object.fromEntries(this.memberStatusCache),
          };
          await this.state.storage.put(storageUpdates);
        }

        // 8. Final Broadcast
        this.lastUpdatedAt = Date.now();
        const fullSnapshot = await this.getFullSnapshot();

        // 🚀 添加心跳日誌到 Ops Stream，讓用戶看到引擎在動
        this.microLogs.push({ ts: Date.now(), msg: `Scan cycle complete: ${Object.keys(membersData).length} members synced.` });
        if (this.microLogs.length > 20) this.microLogs.shift();

        this.broadcastToWebSockets({
          type: 'HEARTBEAT',
          data: fullSnapshot
        });
        console.log(`[DO] Alarm: Cycle complete. Broadcasted snapshot.`);

      } catch (err: any) {
        console.error(`[DO] Alarm Error: ${err.message}`);
      }
    } catch (outerErr: any) {
      console.error(`[DO] Alarm outer failure: ${outerErr.message}`);
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
      const isDonator = data.is_donator ?? (data.energy_max || 100) > 100;
      const lastUpdated = data.last_updated || 0;

      const isOffline = data.last_action?.status === 'Offline' ||
        data.status?.state === 'Traveling' ||
        ((data.status?.state === 'Hospital' || data.status?.state === 'Jail') &&
          (data.status?.until || 0) > Date.now() / 1000 + 3600);

      // --- Energy prediction: OFFLINE only (if energy exists) ---
      let currentEnergy = data.energy;
      let energyPredicted = false;

      if (data.energy !== undefined && isOffline && lastUpdated > 0) {
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
        cdNeedsRefresh = cdResult.needsRefresh;
      }

      members[id] = {
        ...data,
        energy: currentEnergy,
        energy_predicted: energyPredicted,
        cooldowns: currentCooldowns || { drug: 0, booster: 0, medical: 0 },
        needs_refresh: cdNeedsRefresh
      };
    }

    // 🚀 NEW: Merge members from DB who haven't been polled yet
    for (const member of this.dbMembersCache) {
      const id = member.torn_id.toString();
      if (!members[id]) {
        members[id] = {
          id,
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

    return { members, predictedCount };
  }

  private async syncDbMembers() {
    const nowTs = Date.now();
    // Cache for 1 hour instead of 24h to be more responsive to new members
    if (this.dbMembersCache.length === 0 || (nowTs - this.lastDbMembersTs > 3600000)) {
      if (!this.factionId) return;
      const dbResult = await this.env.DB.prepare('SELECT torn_id, name, api_key FROM Members WHERE faction_id = ? AND api_key IS NOT NULL').bind(this.factionId).all();
      this.dbMembersCache = dbResult.results as any[];
      this.lastDbMembersTs = nowTs;
      console.log(`[DO] DB Sync: Found ${this.dbMembersCache.length} members for faction ${this.factionId}`);
    }
  }

  private broadcastToWebSockets(payload: any) {
    const websockets = this.state.getWebSockets();
    const message = JSON.stringify(payload);
    websockets.forEach(ws => {
      try { ws.send(message); } catch (e) { }
    });
  }

  private dispatchAlert(msg: string) {
    this.microLogs.push({ ts: Date.now(), msg: `⚠️ ${msg}` });
    if (this.microLogs.length > 20) this.microLogs.shift();
    this.broadcastToWebSockets({ type: 'LOG_UPDATE', microLogs: this.microLogs });
  }
}
