import type { Env } from '../index'
import { ApiManager } from '../services/api_manager'
import { SecurityService } from '../services/security'

export async function consumer(batch: MessageBatch<any>, env: Env['Bindings']): Promise<void> {
  const switchState = await env.TCT_KV.get('SYSTEM_MASTER_SWITCH');
  if (switchState !== 'ON') {
    console.log('[Queue] Master Switch is OFF. Dropping batch.');
    return;
  }

  const apiManager = new ApiManager(env);
  const security = new SecurityService(env.ENCRYPTION_SECRET);

  // Group messages by factionId to handle DO updates correctly
  const factionsMap = new Map<string, any[]>();
  for (const msg of batch.messages) {
    const factionId = msg.body.factionId || 'GLOBAL_MONITOR';
    if (!factionsMap.has(factionId)) factionsMap.set(factionId, []);
    factionsMap.get(factionId)!.push(msg);
  }

  for (const [factionId, factionMessages] of factionsMap.entries()) {
    const id = env.CHAIN_MONITOR.idFromName(factionId.toString());
    const monitor = env.CHAIN_MONITOR.get(id);

    const keysCount: Record<string, number> = {};
    for (const msg of factionMessages) {
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

    await Promise.allSettled(factionMessages.map(async (message) => {
      const { tornId, apiKey, ts, test } = message.body;
      
      if (test === 'Ping from health check!') {
        message.ack();
        return;
      }

      console.log(`[Queue] Received task for ${tornId || 'UNKNOWN'} (Faction: ${factionId}). Attempts: ${message.attempts}`);

      if (!tornId) {
        message.ack();
        return;
      }

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
        console.log(`[Queue] ⚠️ Poison message for ${tornId}. Max retries exceeded.`);
        apiManager.logAnalytics('poison_message', tornId);
        logBatch.push(`[ALERT] Member ${tornId} failed multiple times.`);
        return;
      }

      let rawApiKey = apiKey;
      if (apiKey && apiKey.includes(':')) {
        const decrypted = await security.decrypt(apiKey);
        if (decrypted) rawApiKey = decrypted;
      }

      try {
        const res = await apiManager.fetchWithBackoff(`https://api.torn.com/user/?selections=bars,cooldowns,icons,basic,refills&key=${rawApiKey}`);
        const data = await res.json() as any;
        
        if (data.error) {
          throw new Error(`Torn Error: ${data.error.error}`);
        }

        updatesBatch.push({
          id: tornId.toString(),
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

    if (updatesBatch.length > 0) {
      await monitor.fetch('http://do/internal/update-members-batch', {
        method: 'POST',
        body: JSON.stringify(updatesBatch)
      });
      console.log(`[Queue] Pushed ${updatesBatch.length} updates to Faction DO: ${factionId}`);
    }

    if (logBatch.length > 0) {
      await monitor.fetch('http://do/internal/log-batch', {
        method: 'POST',
        body: JSON.stringify({ msgs: logBatch })
      });
    }
  }
}
