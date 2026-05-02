import type { Env } from '../index'
import { TacticalCalculator } from './calculator'

export class ChainMonitor implements DurableObject {
  private state: DurableObjectState;
  private env: Env['Bindings'];
  private microLogs: Array<{ts: number, msg: string}> = [];
  
  // 内存态缓存 (用于去重)
  private commanderKeyCache: string | null = null;
  private lastChainCurrent: number = -1;
  private lastChainTimeout: number = -1;
  private memberStatusCache: Map<string, string> = new Map(); // id -> stringified status
  private memberMinutesCache: Map<string, number> = new Map(); // id -> last reported minute
  private memberBuffer: Map<string, any> = new Map(); // id -> latest updates (In-memory buffer)
  public lastUpdatedAt: number = 0; // 纯内存心跳

  constructor(state: DurableObjectState, env: Env['Bindings']) {
    this.state = state;
    this.env = env;

    // 🚀 Hibernation Recovery: 从存储恢复关键内存状态
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<any>([
        'chain_current', 
        'chain_timeout', 
        'micro_logs',
        'member_status_cache'
      ]);
      
      // Durable Object storage get() returns a Map when requesting multiple keys
      const storedMap = stored as Map<string, any>;
      this.lastChainCurrent = storedMap.get('chain_current') ?? -1;
      this.lastChainTimeout = storedMap.get('chain_timeout') ?? -1;
      this.microLogs = storedMap.get('micro_logs') ?? [];
      
      const statusMap = storedMap.get('member_status_cache');
      if (statusMap) {
        this.memberStatusCache = new Map(Object.entries(statusMap));
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // 🚀 WebSocket 升级握手 (仅由 Hono 转发而来)
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected Upgrade: websocket', { status: 426 });
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      // 使用 Hibernation API 接管
      const userId = url.searchParams.get('userId') || 'anonymous';
      this.state.acceptWebSocket(server, [userId]);

      return new Response(null, { status: 101, webSocket: client });
    }

    // 暴露状态查询给 Dashboard
    if (url.pathname === '/status') {
      return new Response(JSON.stringify({ 
        lastUpdatedAt: this.lastUpdatedAt,
        chainCurrent: this.lastChainCurrent,
        chainTimeout: this.lastChainTimeout
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/toggle') {
      const { state } = await request.json() as { state: 'ON' | 'OFF' };
      
      await this.state.storage.put('master_switch', state);
      await this.env.TCT_KV.put('SYSTEM_MASTER_SWITCH', state);

      if (state === 'ON') {
        const currentAlarm = await this.state.storage.getAlarm();
        if (currentAlarm === null) {
          await this.state.storage.setAlarm(Date.now());
        }
      }

      return new Response(JSON.stringify({ success: true, state }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } else if (url.pathname === '/start') {
      await this.state.storage.put('master_switch', 'ON');
      await this.env.TCT_KV.put('SYSTEM_MASTER_SWITCH', 'ON');
      
      const currentAlarm = await this.state.storage.getAlarm();
      if (currentAlarm === null) {
        await this.state.storage.setAlarm(Date.now());
      }
      return new Response(JSON.stringify({ success: true, state: 'ON' }), {
        headers: { 'Content-Type': 'application/json' }
      });
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

    // 内部数据写入接口 (Consumer 调用，写入抓取到的高频战术数据)
    if (url.pathname === '/internal/update-member') {
       if (request.method === 'POST') {
          const payload = await request.json() as any;
          
          // 🚀 必须同步写入 Storage，否则 DO 休眠后数据会丢失
          const storageUpdates: Record<string, any> = {};
          for (const [field, value] of Object.entries(payload.updates)) {
             storageUpdates[`member_${payload.id}_${field}`] = value;
          }
          await this.state.storage.put(storageUpdates);
          
          // 🚀 修正：字段名必须与前端 useDashboardStore 匹配 (updates 而不是 data)
          this.broadcastToWebSockets({ 
            type: 'MEMBER_SOFT_UPDATE', 
            id: payload.id, 
            data: payload.updates // 🚀 统一改为 data
          });

          return new Response('OK');
       }
    }

    if (url.pathname === '/internal/log') {
       if (request.method === 'POST') {
          const { msg } = await request.json() as any;
          this.microLogs.push({ ts: Date.now(), msg });
          if (this.microLogs.length > 20) this.microLogs.shift();
          this.broadcastToWebSockets({ type: 'LOG_UPDATE', microLogs: this.microLogs });
          return new Response('OK');
       }
    }

    if (url.pathname === '/snapshot') {
       const allStorage = await this.state.storage.list();
       const members: Record<string, any> = {};
       const logs = this.microLogs;
       
       for (const [key, value] of allStorage.entries()) {
          // 🚀 这里的逻辑要极其严密，确保所有字段都被导出
          if (key.startsWith('member_')) {
            members[key] = value;
          }
       }

       return new Response(JSON.stringify({
         members,
         microLogs: logs,
         chain_current: await this.state.storage.get('chain_current') || 0,
         chain_timeout: await this.state.storage.get('chain_timeout') || 0,
         chain_max: await this.state.storage.get('chain_max') || 10,
         lastUpdatedAt: this.lastUpdatedAt
       }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/internal/members') {
       const allStorage = await this.state.storage.list();
       const res: Record<string, any> = {};
       for (const [key, value] of allStorage.entries()) {
          if (key.startsWith('member_')) {
             res[key] = value;
          }
       }
       return new Response(JSON.stringify(res), { headers: { 'Content-Type': 'application/json' }});
    }

    if (url.pathname === '/internal/stop') {
       await this.state.storage.put('master_switch', 'OFF');
       console.log('[DO] Master Switch turned OFF. Stopping alarm...');
       return new Response('System Stopped');
    }

    if (url.pathname === '/internal/start') {
       await this.state.storage.setAlarm(Date.now() + 100);
       await this.state.storage.put('master_switch', 'ON');
       console.log('[DO] Alarm manually triggered and started.');
       return new Response('System Started');
    }

    if (url.pathname === '/internal/clear') {
       await this.state.storage.deleteAll();
       this.memberStatusCache.clear(); // 🚀 同时清空内存缓存
       console.log('[DO] Storage and memory cache cleared successfully.');
       return new Response('Storage Cleared');
    }

    return new Response('Not Found', { status: 404 });
  }

  // 🚀 Hibernation 强制要求的 Handler
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
      // 🚀 包含所有 member_ 相关的战术数据
      if (key.startsWith('member_') || key.startsWith('chain_') || key === 'global_selected_members') {
        data[key] = value;
      }
    }
    return {
      ...data,
      lastUpdatedAt: this.lastUpdatedAt,
      microLogs: this.microLogs
    };
  }

  async alarm() {
    try {
      let switchState = await this.state.storage.get<string>('master_switch');
      if (!switchState) {
        switchState = 'ON'; 
        await this.state.storage.put('master_switch', 'ON');
      }

      // 🚀 如果开关关闭，直接退出，不设置下一次闹钟
      if (switchState === 'OFF') {
        console.log('[DO] Master Switch is OFF. Alarm stopped.');
        return;
      }

      // 只有开启时才设置下一次闹钟 (10秒后)
      await this.state.storage.setAlarm(Date.now() + 10000);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      let chainData: any = null;
      let membersData: any = null;

      try {
        if (!this.commanderKeyCache) {
          // 优先级：环境变量 (本地 .dev.vars) > KV 存储 > 默认值
          this.commanderKeyCache = this.env.COMMANDER_API_KEY || (await this.env.TCT_KV.get('COMMANDER_API_KEY')) || 'MOCK_KEY';
        }

        const res = await fetch(`https://api.torn.com/faction/${this.env.FACTION_ID}?selections=basic&key=${this.commanderKeyCache}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        
        const data = await res.json() as any;
        if (data.error) throw new Error(`Torn API Error: ${data.error.error}`);
        
        const factionName = data.name || 'Unknown Faction';
        console.log(`[DO] Polling Faction: ${factionName} (ID: ${this.env.FACTION_ID}). Members: ${Object.keys(data.members || {}).length}`);
        
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

      if (chainData) {
        const { timeout, current, max } = chainData;
        if (current !== this.lastChainCurrent || timeout !== this.lastChainTimeout) {
          storageUpdates['chain_timeout'] = timeout;
          storageUpdates['chain_current'] = current;
          storageUpdates['chain_max'] = max;
          this.lastChainCurrent = current;
          this.lastChainTimeout = timeout;
          hasChanges = true;
        }
      }

      if (membersData) {
        const now = Math.floor(Date.now() / 1000);
        for (const [id, member] of Object.entries(membersData) as [string, any][]) {
          // 仅在有时间戳时计算（兼容未来可能的 key 扩展）
          if (member.last_action?.timestamp && member.last_action?.seconds === undefined) {
            member.last_action.seconds = now - member.last_action.timestamp;
          }

          const currentStatusStr = `${member.status?.state}_${member.last_action?.status}`;
          const currentMinutes = Math.floor((member.last_action?.seconds || 0) / 60);
            
            const cachedStatusStr = this.memberStatusCache.get(id);
            const cachedMinutes = this.memberMinutesCache.get(id); // 需要新增这个 cache

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
          
          // 🚀 按照成员 ID 进行分组广播，方便前端解析
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
            this.broadcastToWebSockets({
              type: 'MEMBER_SOFT_UPDATE',
              id,
              data // 🚀 已经是 data 了，保持一致
            });
          }
        }

        // 🚀 核心调度逻辑
        const dbMembers = await this.env.DB.prepare('SELECT torn_id, api_key FROM Members WHERE api_key IS NOT NULL').all();
        const activeMemberKeys = new Map(dbMembers.results.map((m: any) => [m.torn_id.toString(), m.api_key]));

        const allFactionIds = Object.keys(membersData);
        const membersToUpdate = allFactionIds.filter(id => activeMemberKeys.has(id));

        if (membersToUpdate.length > 0) {
          console.log(`[DO] Tactical match: Sending ${membersToUpdate.length} members to Queue for analysis.`);
        }

        const memberMessages = membersToUpdate.map(id => {
            return {
              body: {
                 tornId: id,
                 apiKey: activeMemberKeys.get(id),
                 ts: Date.now()
              }
            };
          });

        if (memberMessages.length > 0) {
          console.log(`[DO] Enqueueing ${memberMessages.length} members for tactical update...`);
          for (let i = 0; i < memberMessages.length; i += 100) {
             await this.env.MEMBER_QUEUE.sendBatch(memberMessages.slice(i, i + 100));
          }
        }
      }

      this.lastUpdatedAt = Date.now();
      
      // 🚀 计算战术聚合数据
      const storage = await this.state.storage.list();
      const allMembersData: Record<string, any> = {};
      const selectedIds: string[] = (await this.state.storage.get('global_selected_members')) || [];

      for (const [key, value] of storage.entries()) {
        if (key.startsWith('member_') && key.endsWith('_energy')) {
           const id = key.split('_')[1];
           const energyMax = await this.state.storage.get<number>(`member_${id}_energy_max`) || 100;
           allMembersData[id] = {
              energy: { current: value, max: energyMax },
              cooldowns: await this.state.storage.get(`member_${id}_cooldowns`),
              status: await this.state.storage.get(`member_${id}_status`),
              last_action: await this.state.storage.get(`member_${id}_last_action`),
              refill_used: await this.state.storage.get(`member_${id}_refill_used`),
              is_donator: energyMax > 100
           };
        }
      }

      const aggregate = TacticalCalculator.aggregate(allMembersData, selectedIds);
      await this.state.storage.put('tactical_aggregate', aggregate);

      if (hasChanges) {
        await this.state.storage.put('member_status_cache', Object.fromEntries(this.memberStatusCache));
      }

      if (this.memberBuffer.size > 0) {
        const batchUpdates: Record<string, any> = {};
        for (const [id, updates] of this.memberBuffer.entries()) {
          for (const [k, v] of Object.entries(updates)) {
            batchUpdates[`member_${id}_${k}`] = v;
          }
        }
        await this.state.storage.put(batchUpdates);
        this.memberBuffer.clear();
      }

      await this.state.storage.put('micro_logs', this.microLogs);
      await this.state.storage.put('chain_current', this.lastChainCurrent);
      await this.state.storage.put('chain_timeout', this.lastChainTimeout);
      


      this.broadcastToWebSockets({ type: 'HEARTBEAT', lastUpdatedAt: this.lastUpdatedAt, microLogs: this.microLogs });

    } catch (err: any) {
      this.microLogs.push({ ts: Date.now(), msg: `alarm error: ${err.message}` });
      if (this.microLogs.length > 20) this.microLogs.shift();
      console.error('[ChainMonitor] Swallowed alarm error:', err.message);
    }
  }

  private broadcastToWebSockets(payload: any) {
    const websockets = this.state.getWebSockets();
    const message = JSON.stringify(payload);
    websockets.forEach(ws => {
      try {
        ws.send(message);
      } catch (e) {}
    });
  }
}
