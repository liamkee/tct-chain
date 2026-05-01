import type { Env } from '../api/index'

export class ChainMonitor implements DurableObject {
  private state: DurableObjectState;
  private env: Env['Bindings'];
  private microLogs: Array<{ts: number, msg: string}> = [];
  
  // 内存态缓存 (用于去重)
  private commanderKeyCache: string | null = null;
  private lastChainCurrent: number = -1;
  private lastChainTimeout: number = -1;
  private memberStatusCache: Map<string, string> = new Map(); // id -> stringified status
  private memberBuffer: Map<string, any> = new Map(); // id -> latest updates (In-memory buffer)
  public lastUpdatedAt: number = 0; // 纯内存心跳

  constructor(state: DurableObjectState, env: Env['Bindings']) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

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
      
      let bucket = await this.state.storage.get<{tokens: number, resetAt: number}>(bucketKey) || { tokens: 100, resetAt: now + 60000 };
      
      if (now > bucket.resetAt) {
        bucket = { tokens: 100, resetAt: now + 60000 };
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
          // 🚀 优化：暂存在内存 buffer 中，由 alarm 循环统一落盘
          const existing = this.memberBuffer.get(payload.id) || {};
          this.memberBuffer.set(payload.id, { ...existing, ...payload.updates });
          
          // 实时广播最新的内存数据，确保 Dashboard 零延迟
          this.broadcastToWebSockets({ 
            type: 'MEMBER_SOFT_UPDATE', 
            id: payload.id, 
            data: payload.updates 
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

    if (url.pathname === '/internal/members') {
       // Return all cached statuses
       const res: Record<string, any> = {};
       for (const [id, _] of this.memberStatusCache.entries()) {
          res[`member_${id}_status`] = await this.state.storage.get(`member_${id}_status`);
       }
       return new Response(JSON.stringify(res), { headers: { 'Content-Type': 'application/json' }});
    }

    return new Response('Not Found', { status: 404 });
  }

  async alarm(): Promise<void> {
    await this.state.storage.setAlarm(Date.now() + 10000);
    
    try {
      const switchState = await this.state.storage.get<string>('master_switch');
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      let chainData: any = null;
      let membersData: any = null;

      try {
        // KV 去重：只在初始化或缓存为空时读取 KV
        if (!this.commanderKeyCache) {
          this.commanderKeyCache = await this.env.TCT_KV.get('COMMANDER_API_KEY') || 'MOCK_KEY';
        }

        const res = await fetch(`https://api.torn.com/faction/${this.env.FACTION_ID}?selections=basic&key=${this.commanderKeyCache}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        
        const data = await res.json() as any;
        if (data.error) {
           // 如果 Key 无效，清除缓存以便下次重试
           if (data.error.code === 2) this.commanderKeyCache = null;
           throw new Error(`Torn API Error: ${data.error.error}`);
        }
        
        chainData = data.chain;
        membersData = data.members;
        
      } catch (fetchErr: any) {
        if (fetchErr.name === 'AbortError') throw new Error('Torn API timeout (5s)');
        throw fetchErr;
      } finally {
        clearTimeout(timeoutId);
      }

      // DO Storage 与 WebSocket 去重逻辑
      let hasChanges = false;
      const storageUpdates: Record<string, any> = {};

      if (chainData) {
        const { timeout, current, max } = chainData;
        // 只有数据发生变化才触发落盘和广播
        if (current !== this.lastChainCurrent || timeout !== this.lastChainTimeout) {
          storageUpdates['chain_timeout'] = timeout;
          storageUpdates['chain_current'] = current;
          storageUpdates['chain_max'] = max;
          
          this.lastChainCurrent = current;
          this.lastChainTimeout = timeout;
          hasChanges = true;
          
          if (timeout > 0 && timeout <= 300) {
              console.log(`[ALARM] ⚠️ Chain Timeout Critical: ${timeout}s! Triggering Discord Warning...`);
          }
        }
      }

      if (membersData) {
        for (const [id, member] of Object.entries(membersData) as [string, any][]) {
            const currentStatusStr = `${member.status.state}_${member.last_action.status}`;
            const cachedStatusStr = this.memberStatusCache.get(id);
            
            // 只有成员状态改变时才更新
            if (currentStatusStr !== cachedStatusStr) {
              storageUpdates[`member_${id}_status`] = member.status;
              storageUpdates[`member_${id}_last_action`] = member.last_action;
              this.memberStatusCache.set(id, currentStatusStr);
              hasChanges = true;
            }
        }
      }

      // 纯内存更新心跳，去重磁盘写入 (每10秒写盘极易爆费)
      this.lastUpdatedAt = Date.now();
      
      if (hasChanges) {
        await this.state.storage.put(storageUpdates);
      }

      // 🚀 批量落盘：将 Consumer 攒下的内存 buffer 统一写入磁盘
      if (this.memberBuffer.size > 0) {
        const batchUpdates: Record<string, any> = {};
        for (const [id, updates] of this.memberBuffer.entries()) {
          for (const [k, v] of Object.entries(updates)) {
            batchUpdates[`member_${id}_${k}`] = v;
          }
        }
        await this.state.storage.put(batchUpdates);
        this.memberBuffer.clear(); // 清空 buffer
        console.log(`[ChainMonitor] Flushed ${Object.keys(batchUpdates).length} updates to storage.`);
      }
      
      const chainTimeout = chainData?.timeout ?? (await this.state.storage.get<number>('chain_timeout')) ?? 0;

      if (switchState === 'OFF') {
        if (chainTimeout === 0) {
          console.log('[ChainMonitor] Switch OFF & Chain Dead. Sleeping...');
          await this.state.storage.deleteAlarm();
          return;
        }
      } else {
        if (chainTimeout === 0) {
          console.log('[ChainMonitor] Chain Dead but Switch ON. Low-freq polling (60s)...');
          await this.state.storage.setAlarm(Date.now() + 60000);
        } else if (hasChanges) {
          // 只在有真实变化时才广播，避免前端被无用 Socket 消息淹没
          this.broadcastToWebSockets({ type: 'CHAIN_UPDATE', data: storageUpdates });
        }
      }

      // 永远推送心跳包，用于前端的 Stale Data Policy 检测
      this.broadcastToWebSockets({ type: 'HEARTBEAT', lastUpdatedAt: this.lastUpdatedAt, microLogs: this.microLogs });

    } catch (err: any) {
      this.microLogs.push({ ts: Date.now(), msg: `alarm error: ${err.message}` });
      if (this.microLogs.length > 20) this.microLogs.shift();
      console.error('[ChainMonitor] Swallowed alarm error:', err.message);
    }
  }

  private broadcastToWebSockets(payload: any) {
    // console.log('[WebSocket] Broadcasting payload:', payload.type);
  }
}

