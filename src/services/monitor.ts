// Tactical Engine - v1.3.2 - Stable Sync
import type { Env } from '../index'
import { DiscordWebhookService } from './discord_webhook'
import { TacticalCalculator } from './calculator'
import { ApiManager } from './api_manager'
import { SecurityService } from './security'

export class ChainMonitor implements DurableObject {
  private state: DurableObjectState;
  private env: Env['Bindings'];
  private microLogs: Array<{ ts: number, msg: string }> = [];

  // 内存态缓存 (用于去重)
  private factionId: string | null = null;
  private commanderKeyCache: string | null = null;
  private lastChainCurrent: number = 0;
  private lastChainTimeout: number = 300;
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
  private rankedWarCache: any = null; // 内存态 Ranked War 数据
  private tokenBuckets: Map<string, { tokens: number, resetAt: number }> = new Map(); // 纯内存 Token bucket
  private pendingPolls: Map<string, number> = new Map(); // Action-Driven Polling 追踪
  private masterSwitch: 'ON' | 'OFF' = 'OFF';
  private calcSettings: { excludeXanax: boolean, excludeFHC: boolean, excludeRefill: boolean } = {
    excludeXanax: false,
    excludeFHC: false,
    excludeRefill: false
  };
  private chainTarget: number = 100;
  private queueDisabledUntil: number = 0; // Timestamp until which queue is bypassed
  
  

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
        'calc_settings',
        'chain_target',
      ]);

      const storedMap = stored as Map<string, any>;
      this.factionId = storedMap.get('faction_id') ?? null;
      this.manualOffset = storedMap.get('manual_offset') ?? 0;
      this.masterSwitch = storedMap.get('master_switch') ?? 'OFF';
      this.chainTarget = storedMap.get('chain_target') ?? 100;
      const defaultSettings = { 
        excludeXanax: false, 
        excludeFHC: false, 
        excludeRefill: false,
        hideOffline: false,
        hideHospital: false,
        hideTraveling: false
      };
      this.calcSettings = { ...defaultSettings, ...(storedMap.get('calc_settings') || {}) };

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
      this.rankedWarCache = sys.ranked_war_cache ?? null;

      // Restore chain state (1 key instead of 4)
      const chain = storedMap.get('chain_state') ?? {};
      this.lastChainCurrent = Math.max(0, chain.current ?? 0);
      this.lastChainTimeout = Math.max(0, chain.timeout ?? 300);
      this.lastChainMax = Math.max(10, chain.max ?? 10);
      this.lastChainDeadlineMs = chain.deadline_ms ?? 0;

      // 🚀 Load all members from consolidated single-key-per-member storage
      const allStorage = await this.state.storage.list({ prefix: 'member_' });
      for (const [key, value] of allStorage.entries()) {
        const id = key.replace('member_', '');
        const memberData = value as any;
        if (!memberData.id) memberData.id = id;
        this.memberDataCache.set(id, memberData);
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
        chainTimeout: this.lastChainTimeout,
        membersDebug: Object.fromEntries(this.memberDataCache.entries())
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/toggle') {
      const { state } = await request.json() as { state: 'ON' | 'OFF' };

      await this.state.storage.put('master_switch', state);
      this.masterSwitch = state;
      console.log(`[DO] Master Switch toggled to: ${state}`);

      // 🚀 NEW: Sync state to KV for Queue Consumer and Edge Middleware (Resilient to KV write limits)
      if (this.env.TCT_KV) {
        try {
          await this.env.TCT_KV.put('SYSTEM_MASTER_SWITCH', state);
        } catch (e: any) {
          console.warn(`[DO] KV master switch sync failed (likely daily limit exceeded), proceeding: ${e.message}`);
        }
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
      if (request.method === 'POST') {
        const { factionId, tornId } = await request.json() as { factionId?: string, tornId?: string };
        if (factionId && factionId !== this.factionId) {
          this.factionId = factionId;
          this.lastDbMembersTs = 0; // Force DB sync
        }
        if (tornId) {
          const stringId = tornId.toString();
          this.pendingPolls.delete(stringId);
          const existing = this.memberDataCache.get(stringId);
          if (existing) {
            existing.api_key_invalid = false;
            existing.last_failed_key = undefined;
            // Force re-fetching battlestats immediately using the new key
            existing.real_stats_updated = 0; 
            this.memberDataCache.set(stringId, existing);
          } else {
            this.lastDbMembersTs = 0;
          }
        }
        return new Response(JSON.stringify({ success: true, factionId }));
      }
      return new Response(JSON.stringify({ success: true }));
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
          // 关键变化：状态改变、能量大幅波动(>20)、冷却时间大幅改变(吃药/用助推器等)、API key 有效状态改变
          const oldCd = oldData.cooldowns || { drug: 0, medical: 0, booster: 0 };
          const newCd = newData.cooldowns || { drug: 0, medical: 0, booster: 0 };
          const cdChanged = Math.abs(oldCd.drug - newCd.drug) > 300 ||
            Math.abs(oldCd.booster - newCd.booster) > 300 ||
            Math.abs(oldCd.medical - newCd.medical) > 300;

          const isCritical = !oldData || Object.keys(oldData).length === 0 ||
            oldData.status?.state !== newData.status?.state ||
            oldData.api_key_invalid !== newData.api_key_invalid ||
            Math.abs((oldData.energy || 0) - (newData.energy || 0)) > 20 ||
            cdChanged;

          if (isCritical) {
            // Store entire member as 1 key (not per-field)
            storageUpdates[`member_${stringId}`] = newData;
            needsStoragePut = true;
          }
        }

        if (needsStoragePut) {
          await this.state.storage.put(storageUpdates);
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
      const currentAlarm = await this.state.storage.getAlarm();
      if (currentAlarm === null) {
        await this.state.storage.setAlarm(Date.now() + 100);
      }
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
      if (data.type === 'UPDATE_CALC_SETTINGS') {
        this.calcSettings = { ...this.calcSettings, ...data.settings };
        await this.state.storage.put('calc_settings', this.calcSettings);
        // Force a recalculation and broadcast
        const snapshot = await this.getFullSnapshot();
        this.broadcastToWebSockets({ type: 'HEARTBEAT', data: snapshot });
      }
      if (data.type === 'UPDATE_CHAIN_TARGET') {
        this.chainTarget = data.target || 100;
        await this.state.storage.put('chain_target', this.chainTarget);
        const snapshot = await this.getFullSnapshot();
        this.broadcastToWebSockets({ type: 'HEARTBEAT', data: snapshot });
      }
      if (data.type === 'REQ_SYNC') {
        console.log('[DO] Manual Sync Requested');
        this.microLogs.push({ ts: Date.now(), msg: 'Manual Sync Requested by Admin' });
        await this.state.storage.setAlarm(Date.now());
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

    // Get target from memory cache
    const chainTarget = this.chainTarget;

    // --- HPM & Metrics ---
    let currentHPM = 0;
    let recentHPM = 0;
    
    if (this.hpmHistory.length >= 6) {
      const last6 = this.hpmHistory.slice(-6);
      const sumLast6 = last6.reduce((a, b) => a + b, 0);
      recentHPM = (sumLast6 / last6.length) * 2;
    } else if (this.hpmHistory.length > 0) {
      const sum = this.hpmHistory.reduce((a, b) => a + b, 0);
      recentHPM = (sum / this.hpmHistory.length) * 2;
    }

    if (this.hpmHistory.length >= 6) {
      const sorted = [...this.hpmHistory].sort((a, b) => a - b);
      const trimmed = sorted.slice(1, -1);
      if (trimmed.length > 0) {
        const sum = trimmed.reduce((a, b) => a + b, 0);
        currentHPM = (sum / trimmed.length) * 2;
      }
    } else if (this.hpmHistory.length > 0) {
      const sum = this.hpmHistory.reduce((a, b) => a + b, 0);
      currentHPM = (sum / this.hpmHistory.length) * 2;
    }

    // --- Tactical Aggregate ---
    const aggregate = TacticalCalculator.aggregate(predicted.members, Object.keys(predicted.members), this.calcSettings);
  

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
      rankedWar: this.rankedWarCache,
      lastUpdatedAt: this.lastUpdatedAt,
      microLogs: this.microLogs,
      master_switch: this.masterSwitch,
      calc_settings: this.calcSettings,
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
        const res = await fetch(`https://api.torn.com/faction/${this.factionId}?selections=basic,chain&key=${apiKey}`, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        const data = await res.json() as any;
        if (data.error) throw new Error(`Torn API Error: ${data.error.error}`);

        const chainData = data.chain;
        const membersData = data.members || {};
        const rankedWarsData = data.ranked_wars || {};

        this.microLogs.push({ ts: Date.now(), msg: `Faction sync: ${Object.keys(membersData).length} members status updated.` });
        if (this.microLogs.length > 20) this.microLogs.shift();
        const storageUpdates: Record<string, any> = {};
        let hasChanges = false;

        // Cleanup stale members who are no longer in the faction
        if (Object.keys(membersData).length > 0) {
          const keysToDelete: string[] = [];
          for (const id of this.memberDataCache.keys()) {
            if (!membersData[id]) {
              keysToDelete.push(id);
            }
          }
          if (keysToDelete.length > 0) {
            console.log(`[DO] Cleanup: Removing ${keysToDelete.length} stale members who left the faction: ${keysToDelete.join(', ')}`);
            this.microLogs.push({ ts: Date.now(), msg: `DO Cleanup: Removed ${keysToDelete.length} stale members` });
            while (this.microLogs.length > 20) this.microLogs.shift();

            for (const id of keysToDelete) {
              this.memberDataCache.delete(id);
              this.memberStatusCache.delete(id);
              this.memberMinutesCache.delete(id);
              this.pendingPolls.delete(id);
              await this.state.storage.delete(`member_${id}`);
            }
            hasChanges = true;
          }
        }

        // Process Ranked Wars
        const activeWarIds = Object.keys(rankedWarsData);
        if (activeWarIds.length > 0) {
          const warId = activeWarIds[0];
          const warDetails = rankedWarsData[warId];
          if (JSON.stringify(this.rankedWarCache) !== JSON.stringify(warDetails)) {
            this.rankedWarCache = warDetails;
            hasChanges = true;
          }
        } else if (this.rankedWarCache !== null) {
          this.rankedWarCache = null;
          hasChanges = true;
        }

        // 4. Process Chain
        if (chainData) {
          const { timeout, current, max } = chainData;
          
          if (this.lastChainCurrent > 0) {
            if (current < this.lastChainCurrent) {
               // Chain reset or broke
               this.hpmHistory = [];
            } else {
               const increment = current - this.lastChainCurrent;
               this.hpmHistory.push(increment);
               if (this.hpmHistory.length > 10) {
                 this.hpmHistory.shift();
               }
            }
          }

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

        // 5. Process Members basic status & 6. Queue Individual Polls (Action-Driven)
        const activeMemberKeys = new Map((dbMembers || []).map((m: any) => [m.torn_id.toString(), m.api_key]));
        const batch: any[] = [];

        for (const [id, m] of Object.entries(membersData) as [string, any][]) {
          const existing = this.memberDataCache.get(id);
          const apiKey = activeMemberKeys.get(id);

          if (apiKey && (!existing || !(existing.api_key_invalid && existing.last_failed_key === apiKey))) {
            const isInitial = !existing || !existing.last_updated;
            const statusChanged = !existing ||
              existing.status?.state !== m.status?.state ||
              existing.status?.until !== m.status?.until;
            const actionStatusChanged = !existing || 
              existing.last_action?.status !== m.last_action?.status;
            const actionTimestampChanged = !existing || 
              existing.last_action?.timestamp !== m.last_action?.timestamp;
            
            // Stale check changed to 30 minutes
            const isStale = existing && (Math.floor(Date.now() / 1000) - (existing.last_updated || 0)) > 1800;

            let shouldPoll = false;
            let throttleMs = 600000; // default 10 minutes

            const isOffline = m.last_action?.status === 'Offline';

            if (isOffline) {
              // 🚀 Offline members never get polled aggressively! Throttle is at least 30 minutes
              if (isInitial || isStale) {
                shouldPoll = true;
                throttleMs = 1800000;
              }
            } else {
              // Online or Idle members maintain responsive polling strategies
              if (isInitial || statusChanged || actionStatusChanged) {
                shouldPoll = true;
                throttleMs = 60000; // 1 min throttle for critical state changes
              } else if (actionTimestampChanged) {
                shouldPoll = true;
                throttleMs = 600000; // 10 min throttle for just routine activity
              } else if (isStale) {
                shouldPoll = true;
                throttleMs = 1800000; // 30 min throttle for idle staleness
              }
            }

            if (shouldPoll) {
              const lastPoll = this.pendingPolls.get(id) || 0;
              if (Date.now() - lastPoll >= throttleMs) {
                const fetchStats = true; // FORCE FETCH STATS
                batch.push({
                  body: { 
                    tornId: id, 
                    apiKey, 
                    factionId: this.factionId, 
                    ts: Date.now(), 
                    fetchStats,
                    existingRealStats: existing?.real_stats,
                    existingRealStatsUpdated: existing?.real_stats_updated,
                    existingRealStatsSource: existing?.real_stats_source
                  }
                });
                this.pendingPolls.set(id, Date.now());
              }
            }
          } else if (!apiKey) {
            // Member has no API key, let's still poll FFScouter stats if missing or older than 12 hours
            const isInitial = !existing || !existing.real_stats;
            const isStale = !existing || !existing.real_stats_updated || (Date.now() - (existing.real_stats_updated || 0) > 12 * 60 * 60 * 1000);

            if (isInitial || isStale) {
              const lastPoll = this.pendingPolls.get(id) || 0;
              // Throttle to 30 minutes to avoid spamming
              if (Date.now() - lastPoll >= 1800000) {
                batch.push({
                  body: {
                    tornId: id,
                    apiKey: null, // No key
                    factionId: this.factionId,
                    ts: Date.now(),
                    fetchStats: true,
                    existingRealStats: existing?.real_stats,
                    existingRealStatsUpdated: existing?.real_stats_updated,
                    existingRealStatsSource: existing?.real_stats_source
                  }
                });
                this.pendingPolls.set(id, Date.now());
              }
            }
          }

          const currentStatusStr = `${m.status?.state}_${m.last_action?.status}`;
          const needsPersist = !existing || !existing.name ||
            existing.status?.state !== m.status?.state ||
            existing.status?.until !== m.status?.until;

          const merged = {
            ...(existing || {}),
            id,
            name: m.name || existing?.name || 'Unknown',
            status: m.status,
            last_action: m.last_action
          };
          this.memberDataCache.set(id, merged);

          if (needsPersist) {
            storageUpdates[`member_${id}`] = merged;
            this.memberStatusCache.set(id, currentStatusStr);
            hasChanges = true;
          }
        }

        if (batch.length > 0) {
          const isQueueBypassed = this.env.BYPASS_QUEUE === 'true' || Date.now() < this.queueDisabledUntil;
          if (isQueueBypassed) {
            console.log(`[DO] Queue is temporarily or permanently bypassed. Running ${batch.length} polls directly.`);
            await this.processDirectPolls(batch);
          } else {
            try {
              // Send all member polls bundled into a single Queue message
              await this.env.MEMBER_QUEUE.send({
                factionId: this.factionId,
                polls: batch.map(m => m.body)
              });
              console.log(`[DO] Bundled and sent ${batch.length} member polls in a single Queue message.`);
            } catch (queueErr: any) {
              console.warn(`[DO] Queue send failed (likely daily limit exceeded), running polls directly: ${queueErr.message}`);
              this.queueDisabledUntil = Date.now() + 3600000; // Bypass queue for 1 hour on failure
              this.microLogs.push({ ts: Date.now(), msg: '⚠️ Cloudflare Queues limit exceeded. Running polls directly.' });
              if (this.microLogs.length > 20) this.microLogs.shift();
              await this.processDirectPolls(batch);
            }
          }
        }

        // 7. Persistence
        if (hasChanges) {
          storageUpdates['system_state'] = {
            micro_logs: this.microLogs,
            hpm_history: this.hpmHistory,
            last_rtt: this.lastRTT,
            member_status_cache: Object.fromEntries(this.memberStatusCache),
            ranked_war_cache: this.rankedWarCache,
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
        this.dispatchAlert(`API Sync Failure: ${err.message}`);
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
    const apiMemberIds = new Set(this.dbMembersCache.map(m => m.torn_id.toString()));

    for (const [id, data] of this.memberDataCache.entries()) {
      const hasApi = apiMemberIds.has(id);

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
          data.energy, data.energy_max || 100, lastUpdated, (data.energy_max || 100) > 100
        );
        currentEnergy = energyPred.energy;
        energyPredicted = energyPred.isPredicted;
        if (energyPred.isPredicted) predictedCount++;
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
        needs_refresh: cdNeedsRefresh,
        has_api: hasApi
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

          is_pending: true // Mark as pending first poll
        };
      }
    }

    return { members, predictedCount };
  }

  private async processDirectPolls(batch: any[]) {
    if (batch.length === 0) return;

    console.log(`[DO] Processing ${batch.length} member polls directly (Bypassing Queue)...`);
    const apiManager = new ApiManager(this.env);
    const security = new SecurityService(this.env.ENCRYPTION_SECRET);

    // Group by API key to apply rate limits
    const keysCount: Record<string, number> = {};
    for (const msg of batch) {
      if (msg.body.apiKey) {
        keysCount[msg.body.apiKey] = (keysCount[msg.body.apiKey] || 0) + 1;
      }
    }

    // Check rate limits in-memory
    const keyTokens: Record<string, boolean> = {};
    const now = Date.now();
    for (const [key, count] of Object.entries(keysCount)) {
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
      const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
      const bucketKey = `token_${hashHex}`;

      let bucket = this.tokenBuckets.get(bucketKey) || { tokens: 90, resetAt: now + 60000 };
      if (now > bucket.resetAt) {
        bucket = { tokens: 90, resetAt: now + 60000 };
      }

      if (bucket.tokens >= count) {
        bucket.tokens -= count;
        this.tokenBuckets.set(bucketKey, bucket);
        keyTokens[key] = true;
      } else {
        keyTokens[key] = false;
        console.warn(`[DO Limit] Rate limit hit for API Key (hash: ${hashHex.substring(0, 8)}). Skipping in this cycle.`);
      }
    }

    const updatesBatch: any[] = [];
    const logBatch: string[] = [];

    // Process all polls concurrently using Promise.allSettled
    await Promise.allSettled(batch.map(async (msg) => {
      const { 
        tornId, 
        apiKey, 
        fetchStats,
        existingRealStats,
        existingRealStatsUpdated,
        existingRealStatsSource
      } = msg.body;

      if (!tornId) return;

      if (apiKey && !keyTokens[apiKey]) {
        // Rate limited, skip this poll
        return;
      }

      let rawApiKey = apiKey;
      if (apiKey && apiKey.includes(':')) {
         const decrypted = await security.decrypt(apiKey);
         if (decrypted) rawApiKey = decrypted;
      }

      try {
        let selections = 'bars,cooldowns,refills';
        if (fetchStats) selections += ',battlestats';

        let data: any = {};

        if (rawApiKey) {
          let res = await apiManager.fetchWithBackoff(`https://api.torn.com/user/?selections=${selections}&key=${rawApiKey}`);
          data = await res.json() as any;
          
          if (data.error && data.error.code === 16 && fetchStats) {
             selections = 'bars,cooldowns,refills';
             res = await apiManager.fetchWithBackoff(`https://api.torn.com/user/?selections=${selections}&key=${rawApiKey}`);
             data = await res.json() as any;
          }

          if (data.error) {
            const errorCode = data.error.code;
            const isPermanentKeyError = [1, 2, 3, 10, 13, 16, 18].includes(errorCode);

            if (isPermanentKeyError) {
               console.warn(`[DO] Permanent API Key Error (Code ${errorCode}) for member ${tornId}`);
               updatesBatch.push({
                  id: tornId.toString(),
                  updates: {
                     api_key_invalid: true,
                     last_failed_key: apiKey
                  }
               });
               logBatch.push(`[ERROR] Member [${tornId}] API key invalid (Code ${errorCode}): ${data.error.error}`);
               return;
            } else {
               throw new Error(`Torn Error (Code ${errorCode}): ${data.error.error}`);
            }
          }
        }

        const updates: any = {
          id: tornId.toString()
        };

        if (rawApiKey && data.name) {
          const energyMax = data.energy?.maximum || 100;
          const isDonator = energyMax > 100;

          updates.name = data.name;
          updates.energy = data.energy?.current;
          updates.energy_max = data.energy?.maximum || (isDonator ? 150 : 100);
          updates.cooldowns = data.cooldowns;
          updates.refill_used = data.refills ? !!data.refills.energy_refill_used : false;
          updates.last_updated = Math.floor(Date.now() / 1000);
          updates.api_key_invalid = false;
        }

        let realStats = undefined;
        let realStatsUpdated = undefined;
        let realStatsSource = undefined;

        if (data.strength !== undefined) {
          realStats = Math.floor(
            (data.strength || 0) * (1 + (data.strength_modifier || 0) / 100) +
            (data.defense || 0) * (1 + (data.defense_modifier || 0) / 100) +
            (data.speed || 0) * (1 + (data.speed_modifier || 0) / 100) +
            (data.dexterity || 0) * (1 + (data.dexterity_modifier || 0) / 100)
          );
          realStatsUpdated = Date.now();
          realStatsSource = 'torn';
        } else if (fetchStats) {
          const isTornSource = existingRealStatsSource === 'torn';
          const isFresh = existingRealStatsUpdated && (Date.now() - existingRealStatsUpdated < 12 * 60 * 60 * 1000);

          if (isTornSource) {
            realStats = existingRealStats;
            realStatsUpdated = existingRealStatsUpdated;
            realStatsSource = 'torn';
          } else if (isFresh) {
            realStats = existingRealStats;
            realStatsUpdated = existingRealStatsUpdated;
            realStatsSource = 'ffscouter';
          } else {
            const ffscouterApiKey = this.env.FFSCOUTER_API_KEY || 'ptlgbJYXcXtqtPlO';
            try {
              const ffRes = await apiManager.fetchWithBackoff(
                `https://ffscouter.com/api/v1/get-stats?key=${ffscouterApiKey}&targets=${tornId}`
              );
              if (ffRes.ok) {
                const ffData = await ffRes.json() as any[];
                if (ffData && ffData[0] && ffData[0].bs_estimate) {
                  realStats = ffData[0].bs_estimate;
                  realStatsUpdated = Date.now();
                  realStatsSource = 'ffscouter';
                } else {
                  realStats = existingRealStats;
                  realStatsUpdated = existingRealStatsUpdated || Date.now();
                  realStatsSource = existingRealStatsSource || 'ffscouter';
                }
              } else {
                realStats = existingRealStats;
                realStatsUpdated = existingRealStatsUpdated || Date.now();
                realStatsSource = existingRealStatsSource || 'ffscouter';
              }
            } catch (ffErr: any) {
              realStats = existingRealStats;
              realStatsUpdated = existingRealStatsUpdated || Date.now();
              realStatsSource = existingRealStatsSource || 'ffscouter';
            }
          }
        }

        if (realStats !== undefined) {
          updates.real_stats = realStats;
          updates.real_stats_updated = realStatsUpdated;
          updates.real_stats_source = realStatsSource;
        }

        updatesBatch.push({
           id: tornId.toString(),
           updates
        });

        logBatch.push(`Sync [${tornId}] ${data.name || 'Unknown'}: E:${data.energy?.current || 0} CD:${updates.cooldowns?.drug || 0}`);

      } catch (err: any) {
        console.error(`[DO] Direct poll error for ${tornId}:`, err);
      }
    }));

    if (updatesBatch.length > 0) {
      const storageUpdates: Record<string, any> = {};
      let needsStoragePut = false;

      for (const item of updatesBatch) {
        const stringId = item.id.toString();
        const oldData = this.memberDataCache.get(stringId) || {};

        const successState = `${oldData.last_action?.timestamp || 0}_${oldData.status?.state || 'Unknown'}`;
        const newData = {
          ...oldData,
          ...item.updates,
          last_successful_state: successState
        };

        const hasChanged = JSON.stringify({ e: oldData.energy, c: oldData.cooldowns }) !==
          JSON.stringify({ e: newData.energy, c: newData.cooldowns });

        if (hasChanged) {
          this.broadcastToWebSockets({
            type: 'MEMBER_SOFT_UPDATE',
            id: stringId,
            data: newData
          });
        }

        this.memberDataCache.set(stringId, newData);

        const oldCd = oldData.cooldowns || { drug: 0, medical: 0, booster: 0 };
        const newCd = newData.cooldowns || { drug: 0, medical: 0, booster: 0 };
        const cdChanged = Math.abs(oldCd.drug - newCd.drug) > 300 ||
          Math.abs(oldCd.booster - newCd.booster) > 300 ||
          Math.abs(oldCd.medical - newCd.medical) > 300;

        const isCritical = !oldData || Object.keys(oldData).length === 0 ||
          oldData.status?.state !== newData.status?.state ||
          oldData.api_key_invalid !== newData.api_key_invalid ||
          Math.abs((oldData.energy || 0) - (newData.energy || 0)) > 20 ||
          cdChanged;

        if (isCritical) {
          storageUpdates[`member_${stringId}`] = newData;
          needsStoragePut = true;
        }
      }

      if (needsStoragePut) {
        await this.state.storage.put(storageUpdates);
      }
    }

    if (logBatch.length > 0) {
      for (const msg of logBatch) {
        this.microLogs.push({ ts: Date.now(), msg });
      }
      while (this.microLogs.length > 20) this.microLogs.shift();
      this.broadcastToWebSockets({ type: 'LOG_UPDATE', microLogs: this.microLogs, do_server_time_ms: Date.now() });
    }
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
