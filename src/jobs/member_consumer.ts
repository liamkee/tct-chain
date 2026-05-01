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
    const { tornId, apiKey, ts } = message.body;

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

    // 使用 bars 获取 Energy/Life/Happy, 使用 cooldowns 获取全套 CD
    let selections = 'bars,cooldowns';

    try {
      const res = await apiManager.fetchWithBackoff(`https://api.torn.com/user/?selections=${selections}&key=${apiKey}`);
      
      const data = await res.json() as any;
      if (data.error) {
         apiManager.logAnalytics('api_error', tornId, data.error.error);
         if (data.error.code === 2) {
             console.log(`[Queue] ⚠️ Key invalid for ${tornId}.`);
             await env.DB.prepare('UPDATE members SET api_key = NULL WHERE torn_id = ?').bind(tornId).run();
             return;
         }
         throw new Error(`Torn Error: ${data.error.error}`);
      }

      await monitor.fetch('http://do/internal/update-member', {
         method: 'POST',
         body: JSON.stringify({
            id: tornId,
            updates: {
               // 精确映射：bars 包含 energy, nerve, happy, life
               energy: data.bars?.energy?.current,
               energy_max: data.bars?.energy?.maximum,
               // CD 包含 drug, medical, booster
               cooldowns: data.cooldowns,
               last_updated: Math.floor(Date.now() / 1000)
            }
         })
      });
    } catch (err: any) {
      console.error(`[Queue] Error processing ${tornId}:`, err);
      // throw to trigger generic retry logic if needed, but since it's Promise.allSettled, it will just fail this single promise
      // Wait, if it fails, we should retry the message!
      message.retry();
    }
  }));
}
