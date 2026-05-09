import type { Env } from '../index'
import { DiscordWebhookService } from './discord_webhook'

export class ChainMonitor implements DurableObject {
  private state: DurableObjectState;
  private env: Env['Bindings'];
  private microLogs: Array<{ ts: number, msg: string }> = [];

  // 内存态缓存 (用于去重)
  private factionId: string | null = null;
  private commanderKeyCache: string | null = null;
  private lastChainCurrent: number = -1;
  private lastChainTimeout: number = -1;
  private memberStatusCache: Map<string, string> = new Map(); // id -> stringified status
  private memberMinutesCache: Map<string, number> = new Map(); // id -> last reported minute
  private hpmHistory: number[] = []; // 存储每 10 秒的击数增量，最大长度 30 (5分钟)
  private lastRTT: number = 0; // 最近一次 API 往返延迟 (ms)
  private manualOffset: number = 0; // 指挥官手动微调 (ms)
  public lastUpdatedAt: number = 0; // 纯内存心跳
  private lastEmergencyAlertTs: number = 0; // Discord 防骚扰限流 (内存态)

  constructor(state: DurableObjectState, env: Env['Bindings']) {
    this.state = state;
    this.env = env;

    // 🚀 Hibernation Recovery: 从存储恢复关键内存状态
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<any>([
        'faction_id',
        'chain_current',
        'chain_timeout',
        'micro_logs',
        'member_status_cache',
        'member_minutes_cache',
        'hpm_history',
        'last_rtt',
        'manual_offset',
        'interval_counter',
        'chain_deadline_ms'
      ]);

      const storedMap = stored as Map<string, any>;
      this.factionId = storedMap.get('faction_id') ?? null;
      this.lastChainCurrent = storedMap.get('chain_current') ?? -1;
      this.lastChainTimeout = storedMap.get('chain_timeout') ?? -1;
      this.microLogs = storedMap.get('micro_logs') ?? [];

      const statusMap = storedMap.get('member_status_cache');
      if (statusMap) {
        this.memberStatusCache = new Map(Object.entries(statusMap));
      }

      const minutesMap = storedMap.get('member_minutes_cache');
      if (minutesMap) {
        this.memberMinutesCache = new Map(Object.entries(minutesMap));
      }

      this.hpmHistory = storedMap.get('hpm_history') ?? [];
      this.lastRTT = storedMap.get('last_rtt') ?? 0;
      this.manualOffset = storedMap.get('manual_offset') ?? 0;
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
    } else if (url.pathname === '/internal/token-bucket') {
      const apiKey = url.searchParams.get('key') || 'UNKNOWN';
      const count = parseInt(url.searchParams.get('count') || '1', 10);

      const bucketKey = `rate_limit_${apiKey}`;
      const now = Date.now();

      let bucket = await this.state.storage.get<{ tokens: number, resetAt: number }>(bucketKey) || { tokens: 90, resetAt: now + 60000 };

      if (now > bucket.resetAt) {
        bucket = { tokens: 90, resetAt: now + 60000 };
      }

      if (bucket.tokens >= count) {
        bucket.tokens -= count;
        await this.state.storage.put(bucketKey, bucket);
        return new Response(JSON.stringify({ allowed: true, remaining: bucket.tokens }), { headers: { 'Content-Type': 'application/json' } });
      } else {
        return new Response(JSON.stringify({ allowed: false, remaining: bucket.tokens, resetIn: bucket.resetAt - now }), { status: 429, headers: { 'Content-Type': 'application/json' } });
      }
    }

    if (url.pathname === '/internal/offset') {
      const { offset } = await request.json() as { offset: number };
      this.manualOffset = Math.max(0, offset);
      await this.state.storage.put('manual_offset', this.manualOffset);
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

        for (const item of items) {
          for (const [field, value] of Object.entries(item.updates)) {
            storageUpdates[`member_${item.id}_${field}`] = value;
          }
          const stringId = item.id.toString();
          this.broadcastToWebSockets({
            type: 'MEMBER_SOFT_UPDATE',
            id: stringId,
            data: item.updates
          });
        }

        await this.state.storage.put(storageUpdates);
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
      const allStorage = await this.state.storage.list();
      const members: Record<string, any> = {};
      const logs = this.microLogs;

      for (const [key, value] of allStorage.entries()) {
        if (key.startsWith('member_')) {
          members[key] = value;
        }
      }

      return new Response(JSON.stringify({
        factionId: this.factionId,
        members,
        microLogs: logs,
        chain_current: await this.state.storage.get('chain_current') || 0,
        chain_timeout: await this.state.storage.get('chain_timeout') || 0,
        chain_deadline_ms: await this.state.storage.get('chain_deadline_ms') || 0,
        chain_max: await this.state.storage.get('chain_max') || 10,
        current_hpm: this.hpmHistory.length > 0 ? (this.hpmHistory.reduce((a, b) => a + b, 0) / this.hpmHistory.length) * 6 : 0,
        lastUpdatedAt: this.lastUpdatedAt,
        do_server_time_ms: Date.now(),
        master_switch: await this.state.storage.get('master_switch') || 'OFF'
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
    const storage = await this.state.storage.list();
    const data: Record<string, any> = {};
    for (const [key, value] of storage.entries()) {
      if (key.startsWith('member_') || key.startsWith('chain_') || key === 'global_selected_members') {
        data[key] = value;
      }
    }
    return {
      ...data,
      factionId: this.factionId,
      lastUpdatedAt: this.lastUpdatedAt,
      microLogs: this.microLogs,
      master_switch: await this.state.storage.get('master_switch') || 'OFF'
    };
  }

  async alarm() {
    try {
      if (!this.factionId) {
        console.error('[DO] No factionId set. Alarm stopping.');
        return;
      }

      let switchState = await this.state.storage.get<string>('master_switch');
      if (!switchState) {
        switchState = 'ON';
        await this.state.storage.put('master_switch', 'ON');
      }

      if (switchState === 'OFF') {
        return;
      }

      await this.state.storage.setAlarm(Date.now() + 10000);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      let chainData: any = null;
      let membersData: any = null;

      try {
        if (!this.commanderKeyCache) {
          // 在多租户模式下，如果没有 Faction 表，我们可以尝试从 DB 里的成员中随便选一个有效 Key
          // 或者要求每个 Faction 必须有一个 Commander Key
          const dbMembers = await this.env.DB.prepare('SELECT api_key FROM Members WHERE faction_id = ? AND api_key IS NOT NULL LIMIT 1').bind(this.factionId).first() as any;
          if (dbMembers?.api_key) {
            const security = new (await import('../services/security')).SecurityService(this.env.ENCRYPTION_SECRET);
            this.commanderKeyCache = await security.decrypt(dbMembers.api_key);
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
          currentHPM = (sum / trimmed.length) * 6;
        } else {
          const sum = this.hpmHistory.reduce((a, b) => a + b, 0);
          currentHPM = (sum / (this.hpmHistory.length || 1)) * 6;
        }

        if (current !== this.lastChainCurrent || timeout !== this.lastChainTimeout) {
          if (this.lastChainCurrent !== -1) {
            const hitsDelta = Math.max(0, current - this.lastChainCurrent);
            this.hpmHistory.push(hitsDelta);
            if (this.hpmHistory.length > 30) this.hpmHistory.shift();
          }

          storageUpdates['chain_timeout'] = adjustedTimeout;
          storageUpdates['chain_deadline_ms'] = Math.floor(Date.now() - (this.lastRTT / 2) + (timeout * 1000) + this.manualOffset);
          storageUpdates['chain_current'] = current;
          storageUpdates['chain_max'] = max;
          this.lastChainCurrent = current;
          this.lastChainTimeout = timeout;
          hasChanges = true;
        } else {
          this.hpmHistory.push(0);
          if (this.hpmHistory.length > 30) this.hpmHistory.shift();
        }

        // 🚨 Phase 3: 脱管防御 (Risk Alert)
        if (adjustedTimeout > 0 && adjustedTimeout < 30) {
          const now = Date.now();
          if (now - this.lastEmergencyAlertTs > 60000) { // 1 min throttle
            this.dispatchAlert(`CRITICAL: Chain at risk! Timeout: ${Math.floor(adjustedTimeout)}s. HPM: ${currentHPM.toFixed(1)}`);
            this.lastEmergencyAlertTs = now;

            // Proactively try to alert via Discord if configured
            try {
              const service = new DiscordWebhookService(this.env);
              await service.sendChainAlert(this.factionId || 'Unknown', current, Math.floor(adjustedTimeout), currentHPM);
            } catch (e) {
              console.error('[DO] Discord alert failed:', e);
            }
          }
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
            storageUpdates[`member_${id}_name`] = member.name;
            storageUpdates[`member_${id}_status`] = member.status;
            storageUpdates[`member_${id}_last_action`] = member.last_action;

            this.memberStatusCache.set(id, currentStatusStr);
            this.memberMinutesCache.set(id, currentMinutes);
            hasChanges = true;
          }
        }

        if (hasChanges) {
          await this.state.storage.put(storageUpdates);
          const updatesByMember: Record<string, any> = {};
          Object.entries(storageUpdates).forEach(([key, value]) => {
            if (key.startsWith('member_')) {
              const parts = key.split('_');
              const id = parts[1];
              const field = parts.slice(2).join('_');
              if (!updatesByMember[id]) updatesByMember[id] = {};
              updatesByMember[id][field] = value;
            }
          });

          for (const [id, data] of Object.entries(updatesByMember)) {
            this.broadcastToWebSockets({ type: 'MEMBER_SOFT_UPDATE', id, data, do_server_time_ms: Date.now() });
          }
        }

        // 🚀 核心调度逻辑 (仅本帮派成员)
        const dbMembers = await this.env.DB.prepare('SELECT torn_id, api_key FROM Members WHERE faction_id = ? AND api_key IS NOT NULL').bind(this.factionId).all();
        const activeMemberKeys = new Map(dbMembers.results.map((m: any) => [m.torn_id.toString(), m.api_key]));

        const membersToUpdate = Object.keys(membersData).filter(id => {
          if (!activeMemberKeys.has(id)) return false;
          const member = membersData[id];
          const status = member.status;
          if (status) {
            if ((status.state === 'Hospital' || status.state === 'Jail') && (status.until || 0) > Date.now() / 1000 + 3600) return false;
            if (status.state === 'Traveling') return false;
          }
          return true;
        });

        const memberMessages = membersToUpdate.map(id => ({
          body: {
            tornId: id,
            apiKey: activeMemberKeys.get(id),
            ts: Date.now(),
            factionId: this.factionId
          }
        }));

        if (memberMessages.length > 0) {
          for (let i = 0; i < memberMessages.length; i += 100) {
            await this.env.MEMBER_QUEUE.sendBatch(memberMessages.slice(i, i + 100));
          }
        }
      }

      this.lastUpdatedAt = Date.now();

      const storage = await this.state.storage.list();
      const allMembersData: Record<string, any> = {};
      const selectedIds: string[] = (await this.state.storage.get('global_selected_members')) || [];

      // 🚀 Include all registered members from DB in the snapshot
      const dbMembers = await this.env.DB.prepare('SELECT torn_id, name FROM Members WHERE faction_id = ?').bind(this.factionId).all();
      const registeredIds = new Set(dbMembers.results.map((m: any) => m.torn_id.toString()));

      for (const [key, value] of storage.entries()) {
        if (key.startsWith('member_') && key.endsWith('_energy')) {
          const id = key.split('_')[1];
          const energyMax = await this.state.storage.get<number>(`member_${id}_energy_max`) || 100;
          allMembersData[id] = {
            id: id,
            name: await this.state.storage.get(`member_${id}_name`),
            energy: value,
            energy_max: energyMax,
            cooldowns: await this.state.storage.get(`member_${id}_cooldowns`),
            status: await this.state.storage.get(`member_${id}_status`),
            last_action: await this.state.storage.get(`member_${id}_last_action`),
            refill_used: await this.state.storage.get(`member_${id}_refill_used`),
            is_donator: energyMax > 100
          };
        }
      }

      // Fill in members who are in DB but not yet in DO storage
      for (const member of dbMembers.results as any[]) {
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

      const aggregate = (await import('./calculator')).TacticalCalculator.aggregate(allMembersData, selectedIds);
      await this.state.storage.put('tactical_aggregate', aggregate);

      if (hasChanges) {
        await this.state.storage.put('member_status_cache', Object.fromEntries(this.memberStatusCache));
        await this.state.storage.put('member_minutes_cache', Object.fromEntries(this.memberMinutesCache));
      }

      await this.state.storage.put('micro_logs', this.microLogs);
      await this.state.storage.put('chain_current', this.lastChainCurrent);
      await this.state.storage.put('chain_timeout', this.lastChainTimeout);
      await this.state.storage.put('hpm_history', this.hpmHistory);
      await this.state.storage.put('last_rtt', this.lastRTT);

      // 🚀 连锁复盘数据生成 (每 5 分钟转存一次 D1)
      let intervalCounter = (await this.state.storage.get<number>('interval_counter')) || 0;
      intervalCounter++;

      if (intervalCounter >= 30) { // 30 * 10s = 300s = 5m
        try {
          await this.env.DB.prepare(`
            INSERT INTO ChainHistory (faction_id, timestamp, chain_count, hpm, eta, recent_hpm, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).bind(
            this.factionId,
            Date.now(),
            this.lastChainCurrent,
            currentHPM,
            currentHPM > 0 ? Math.max(0, (await this.state.storage.get<number>('chain_max') || 10) - this.lastChainCurrent) / currentHPM : -1,
            recentHPM,
            JSON.stringify({ hpmHistory: this.hpmHistory })
          ).run();

          intervalCounter = 0;
          this.microLogs.push({ ts: Date.now(), msg: '📊 Snapshot persisted to history' });
        } catch (dbErr: any) {
          console.error('[DO] DB Persistence failed:', dbErr);
        }
      }
      await this.state.storage.put('interval_counter', intervalCounter);

      this.broadcastToWebSockets({
        type: 'HEARTBEAT',
        lastUpdatedAt: this.lastUpdatedAt,
        do_server_time_ms: Date.now(),
        microLogs: this.microLogs,
        hpm: currentHPM,
        recentHPM,
        trend: recentHPM > currentHPM ? 'UP' : (recentHPM < currentHPM ? 'DOWN' : 'STABLE'),
        eta: currentHPM > 0 ? Math.max(0, (await this.state.storage.get<number>('chain_max') || 10) - this.lastChainCurrent) / currentHPM : -1,
        aggregate,
        master_switch: await this.state.storage.get('master_switch') || 'OFF'
      });

    } catch (err: any) {
      this.microLogs.push({ ts: Date.now(), msg: `alarm error: ${err.message}` });
      if (this.microLogs.length > 20) this.microLogs.shift();
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
