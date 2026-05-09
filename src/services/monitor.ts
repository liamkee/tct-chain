import type { Env } from '../index'
import { DiscordWebhookService } from './discord_webhook'

export class ChainMonitor implements DurableObject {
  private state: DurableObjectState;
  private env: Env['Bindings'];
  private microLogs: Array<{ts: number, msg: string}> = [];
  
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
  private memberDataCache: Map<string, any> = new Map(); // 完整的成员内存缓存 (用于对比)
  private lastPersistenceTs: number = 0; // 上次强制存盘时间

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

      // 🚀 核心優化：啟動時將所有成員數據加載到內存緩存中
      const allStorage = await this.state.storage.list();
      for (const [key, value] of allStorage.entries()) {
         if (key.startsWith('member_')) {
            const parts = key.split('_');
            const id = parts[1];
            const field = parts.slice(2).join('_');
            
            if (!this.memberDataCache.has(id)) {
               this.memberDataCache.set(id, {});
            }
            const memberData = this.memberDataCache.get(id);
            memberData[field] = value;
         }
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
    } else if (url.pathname === '/internal/token-bucket') {
      const apiKey = url.searchParams.get('key') || 'UNKNOWN';
      const count = parseInt(url.searchParams.get('count') || '1', 10);
      
      const bucketKey = `rate_limit_${apiKey}`;
      const now = Date.now();
      
      let bucket = await this.state.storage.get<{tokens: number, resetAt: number}>(bucketKey) || { tokens: 90, resetAt: now + 60000 };
      
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
             const oldData = this.memberDataCache.get(stringId);
             const newData = item.updates;

             // 1. WebSocket 广播永远是实时的 (只要内存里不一样就发)
             const hasChanged = JSON.stringify(oldData) !== JSON.stringify(newData);
             
             if (hasChanged) {
                this.broadcastToWebSockets({ 
                  type: 'MEMBER_SOFT_UPDATE', 
                  id: stringId, 
                  data: newData 
                });
                
                // 更新内存缓存
                this.memberDataCache.set(stringId, newData);

                // 2. 只有关键变化才立即存盘，否则只更新内存
                // 关键变化：状态改变、能量大幅波动(>20)、或者距离上次存盘超过 5 分钟
                const isCritical = !oldData || 
                                 oldData.status?.state !== newData.status?.state || 
                                 Math.abs((oldData.energy || 0) - (newData.energy || 0)) > 20 ||
                                 Date.now() - this.lastPersistenceTs > 300000;

                if (isCritical) {
                   for (const [field, value] of Object.entries(newData)) {
                      storageUpdates[`member_${stringId}_${field}`] = value;
                   }
                   needsStoragePut = true;
                }
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
       const logs = this.microLogs;
       
       // 從內存緩存中直接提取所有成員
       const members: Record<string, any> = {};
       for (const [id, data] of this.memberDataCache.entries()) {
          members[`member_${id}`] = data;
       }

       return new Response(JSON.stringify({
         factionId: this.factionId,
         members,
         microLogs: logs,
         chain_current: this.lastChainCurrent,
         chain_timeout: this.lastChainTimeout,
         chain_deadline_ms: await this.state.storage.get('chain_deadline_ms') || 0,
         chain_max: await this.state.storage.get('chain_max') || 10,
         current_hpm: this.hpmHistory.length > 0 ? (this.hpmHistory.reduce((a, b) => a + b, 0) / this.hpmHistory.length) * 2 : 0,
         lastUpdatedAt: this.lastUpdatedAt,
         do_server_time_ms: Date.now()
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
      microLogs: this.microLogs
    };
  }

  async alarm() {
    try {
      if (!this.factionId) {
        console.error('[DO] No factionId set. Alarm stopping.');
        return;
      }

      // Fetch DB members once to avoid scope issues and redundant calls
      const dbMembers = await this.env.DB.prepare('SELECT torn_id, name, api_key FROM Members WHERE faction_id = ? AND api_key IS NOT NULL').bind(this.factionId).all();

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
          const firstWithKey = dbMembers.results[0] as any;
          if (firstWithKey?.api_key) {
             const security = new (await import('../services/security')).SecurityService(this.env.ENCRYPTION_SECRET);
             this.commanderKeyCache = await security.decrypt(firstWithKey.api_key);
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

        const memberMessages = membersToUpdate.map(id => ({ body: { tornId: id, apiKey: activeMemberKeys.get(id), ts: Date.now() }}));

        if (memberMessages.length > 0) {
          for (let i = 0; i < memberMessages.length; i += 100) {
             await this.env.MEMBER_QUEUE.sendBatch(memberMessages.slice(i, i + 100));
          }
        }
      }

      this.lastUpdatedAt = Date.now();
      
      const allMembersData: Record<string, any> = {};
      const selectedIds: string[] = (await this.state.storage.get('global_selected_members')) || [];
      
      // 🚀 直接使用內存緩存中的數據，移除 storage.list()
      for (const [id, data] of this.memberDataCache.entries()) {
         if (data.energy !== undefined) {
            allMembersData[id] = {
               id,
               name: data.name,
               energy: data.energy,
               energy_max: data.energy_max || 100,
               cooldowns: data.cooldowns,
               status: data.status,
               last_action: data.last_action,
               refill_used: data.refill_used,
               is_donator: (data.energy_max || 100) > 100
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
      
      this.broadcastToWebSockets({ 
        type: 'HEARTBEAT', 
        lastUpdatedAt: this.lastUpdatedAt, 
        do_server_time_ms: Date.now(),
        microLogs: this.microLogs,
        hpm: currentHPM,
        recentHPM,
        trend: recentHPM > currentHPM ? 'UP' : (recentHPM < currentHPM ? 'DOWN' : 'STABLE'),
        eta: currentHPM > 0 ? Math.max(0, (await this.state.storage.get<number>('chain_max') || 10) - this.lastChainCurrent) / currentHPM : -1,
        aggregate
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
      try { ws.send(message); } catch (e) {}
    });
  }

  private dispatchAlert(msg: string) {
    this.microLogs.push({ ts: Date.now(), msg: `⚠️ ${msg}` });
    if (this.microLogs.length > 20) this.microLogs.shift();
    this.broadcastToWebSockets({ type: 'LOG_UPDATE', microLogs: this.microLogs });
  }
}
