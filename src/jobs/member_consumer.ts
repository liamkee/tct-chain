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

  const updatesBatch: any[] = [];
  const logBatch: string[] = [];

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
    if (ts && Date.now() - ts > 60000) {
       console.log(`[Queue] Dropping stale message for ${tornId} (Age: ${Math.round((Date.now() - ts)/1000)}s)`);
       message.ack();
       return;
    }

    if (!keyTokens[apiKey]) {
       apiManager.logAnalytics('rate_limit_block', tornId);
       logBatch.push(`[LIMIT] Rate limit hit for ${tornId}. Re-queuing...`);
       message.retry();
       return;
    }

    if (message.attempts > 3) {
       console.log(`[Queue] ⚠️ Poison message for ${tornId}. Max retries exceeded. Marking key invalid.`);
       apiManager.logAnalytics('poison_message', tornId);
       logBatch.push(`[ALERT] Member ${tornId} failed multiple times. Key marked invalid.`);
       await env.DB.prepare('UPDATE members SET api_key = NULL WHERE torn_id = ?').bind(tornId).run();
       return;
    }

    let selections = 'bars,cooldowns,icons,basic,refills';

    try {
      const res = await apiManager.fetchWithBackoff(`https://api.torn.com/user/?selections=${selections}&key=${apiKey}`);
      
      const data = await res.json() as any;
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

      updatesBatch.push({
         id: tornId,
         updates: {
            energy: data.energy?.current,
            energy_max: data.energy?.maximum,
            cooldowns: data.cooldowns,
            status: data.status,
            last_action: data.last_action,
            refill_used: data.refills ? data.refills.energy === false : !data.icons?.icon70,
            last_updated: Math.floor(Date.now() / 1000)
         }
      });

    } catch (err: any) {
      console.error(`[Queue] Critical Error processing ${tornId}:`, err);
      message.retry();
    }
  }));

  // 🚀 发送批量更新到 DO (极大地节省 Request 数量)
  if (updatesBatch.length > 0) {
     const updateRes = await monitor.fetch('http://do/internal/update-members-batch', {
        method: 'POST',
        body: JSON.stringify(updatesBatch)
     });
     if (updateRes.ok) {
        console.log(`[Queue] Successfully pushed ${updatesBatch.length} updates to DO.`);
     } else {
        console.error(`[Queue] Batch DO Update Failed: ${updateRes.status}`);
     }
  }

  // 🚀 发送批量日志
  if (logBatch.length > 0) {
     await monitor.fetch('http://do/internal/log-batch', {
        method: 'POST',
        body: JSON.stringify({ msgs: logBatch })
     });
  }
}
