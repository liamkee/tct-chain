import type { Env } from '../index'
import { ApiManager } from '../services/api_manager'

export async function consumer(batch: MessageBatch<any>, env: Env['Bindings']): Promise<void> {
  const switchState = await env.TCT_KV.get('SYSTEM_MASTER_SWITCH');
  if (switchState !== 'ON') {
    console.log('[Queue] Master Switch is OFF. Dropping batch.');
    return;
  }

  const apiManager = new ApiManager(env);
  const id = env.CHAIN_MONITOR.idFromName('GLOBAL_MONITOR');
  const monitor = env.CHAIN_MONITOR.get(id);

  const keysCount: Record<string, number> = {};
  for (const msg of batch.messages) {
     keysCount[msg.body.apiKey] = (keysCount[msg.body.apiKey] || 0) + 1;
  }

  const keyTokens: Record<string, boolean> = {};
  for (const [key, count] of Object.entries(keysCount)) {
     const tokenRes = await monitor.fetch(`http://do/internal/token-bucket?key=${key}&count=${count}`);
     if (tokenRes.ok) {
        const { allowed } = await tokenRes.json() as any;
        keyTokens[key] = allowed;
     } else {
        keyTokens[key] = false;
     }
  }

  await Promise.allSettled(batch.messages.map(async (message) => {
    const { tornId, apiKey, ts, test } = message.body;
    
    // 🚀 静默过滤健康检查产生的垃圾消息
    if (test === 'Ping from health check!') {
      message.ack();
      return;
    }

    console.log(`[Queue] Received task for ${tornId || 'UNKNOWN'}. Attempts: ${message.attempts}`);

    if (!tornId) {
       console.error('[Queue] Error: Message body is empty or missing tornId:', message.body);
       message.ack();
       return;
    }

    // 🚀 核心防护：旧请求消除逻辑 (Old Request Elimination)
    // 如果消息在队列中积压超过 60 秒，说明 Producer 已经发出了更鲜活的数据，旧的直接丢弃。
    if (ts && Date.now() - ts > 60000) {
       console.log(`[Queue] Dropping stale message for ${tornId} (Age: ${Math.round((Date.now() - ts)/1000)}s)`);
       message.ack(); // 标记成功但不再处理
       return;
    }

    if (!keyTokens[apiKey]) {
       apiManager.logAnalytics('rate_limit_block', tornId);
       await monitor.fetch('http://do/internal/log', { method: 'POST', body: JSON.stringify({ msg: `[LIMIT] Rate limit hit for ${tornId}. Re-queuing...` }) });
       message.retry();
       return;
    }

    if (message.attempts > 3) {
       console.log(`[Queue] ⚠️ Poison message for ${tornId}. Max retries exceeded. Marking key invalid.`);
       apiManager.logAnalytics('poison_message', tornId);
       await monitor.fetch('http://do/internal/log', { method: 'POST', body: JSON.stringify({ msg: `[ALERT] Member ${tornId} failed multiple times. Key marked invalid.` }) });
       await env.DB.prepare('UPDATE members SET api_key = NULL WHERE torn_id = ?').bind(tornId).run();
       return;
    }

    // 使用 bars 获取 Energy, cooldowns 获取 CD, icons 用于检测 Refill 是否可用, basic 获取状态
    // 🚀 升级：加入 refills 接口，获取更精确的补给数据
    let selections = 'bars,cooldowns,icons,basic,refills';

    try {
      const res = await apiManager.fetchWithBackoff(`https://api.torn.com/user/?selections=${selections}&key=${apiKey}`);
      
      const data = await res.json() as any;
      // 🚀 修正：Torn API 的 bars 数据通常直接平铺在根部
      console.log(`[Queue] Raw data for ${tornId}: Energy=${data.energy?.current}, Refill=${data.refills?.energy}`);
      
      if (data.error) {
         apiManager.logAnalytics('api_error', tornId, data.error.error);
         if (data.error.code === 2) {
             console.log(`[Queue] ⚠️ Key invalid for ${tornId}.`);
             await env.DB.prepare('UPDATE members SET api_key = NULL WHERE torn_id = ?').bind(tornId).run();
             return;
         }
         throw new Error(`Torn Error: ${data.error.error}`);
      }

      const updateRes = await monitor.fetch('http://do/internal/update-member', {
         method: 'POST',
         body: JSON.stringify({
            id: tornId,
            updates: {
               energy: data.energy?.current,
               energy_max: data.energy?.maximum,
               cooldowns: data.cooldowns,
               status: data.status,
               last_action: data.last_action,
               // 显式逻辑：如果 energy 是 false，才代表 USED
               refill_used: data.refills ? data.refills.energy === false : !data.icons?.icon70,
               last_updated: Math.floor(Date.now() / 1000)
            }
         })
      });

      if (!updateRes.ok) {
        const errText = await updateRes.text();
        console.error(`[Queue] DO Update Failed for ${tornId}: ${updateRes.status} ${errText}`);
      } else {
        console.log(`[Queue] Successfully pushed updates for ${tornId} to DO.`);
      }
    } catch (err: any) {
      console.error(`[Queue] Critical Error processing ${tornId}:`, err);
      message.retry();
    }
  }));
}
