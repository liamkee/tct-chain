import type { Env } from '../index'
import { ApiManager } from '../services/api_manager'
import { SecurityService } from '../services/security'

export async function consumer(batch: MessageBatch<any>, env: Env['Bindings']): Promise<void> {
  // 🚀 FORCE UPDATE: No more master switch check here.
  // We trust the messages coming from the Durable Object.
  console.log(`[Queue] 🔥 BOOTING CONSUMER - Processing batch of ${batch.messages.length} messages. No more gatekeeping!`);

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
       const tokenRes = await monitor.fetch(`http://do/internal/token`, {
          method: 'POST',
          body: JSON.stringify({ apiKey: key, count })
       });
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
      const { tornId, apiKey, ts, test, fetchStats } = message.body;
      
      if (test === 'Ping from health check!') {
        message.ack();
        return;
      }

      if (!tornId) {
         console.error('[Queue] Error: Message body is empty or missing tornId:', message.body);
         message.ack();
         return;
      }

      // 🚀 Old Request Elimination (Max 2 mins age)
      if (ts && Date.now() - ts > 120000) {
         console.log(`[Queue] Dropping stale message for ${tornId} (Age: ${Math.round((Date.now() - ts)/1000)}s)`);
         message.ack();
         return;
      }

      if (!keyTokens[apiKey]) {
         logBatch.push(`[LIMIT] Rate limit hit for ${tornId}.`);
         message.retry();
         return;
      }

      if (message.attempts > 3) {
         console.log(`[Queue] ⚠️ Poison message for ${tornId}. Max retries exceeded.`);
         updatesBatch.push({
            id: tornId.toString(),
            updates: {
               api_key_invalid: true,
               last_failed_key: apiKey
            }
         });
         logBatch.push(`[ALERT] Member ${tornId} API failed multiple times. Polling suspended.`);
         message.ack(); // Avoid endless loop
         return;
      }

      let rawApiKey = apiKey;
      if (apiKey && apiKey.includes(':')) {
         const decrypted = await security.decrypt(apiKey);
         if (decrypted) rawApiKey = decrypted;
      }

      let selections = 'bars,cooldowns,refills';
      if (fetchStats) selections += ',battlestats';

      try {
        let res = await apiManager.fetchWithBackoff(`https://api.torn.com/user/?selections=${selections}&key=${rawApiKey}`);
        let data = await res.json() as any;
        
        // Fallback if battlestats requires higher access level than what the key provides
        if (data.error && data.error.code === 16 && fetchStats) {
           console.warn(`[Queue] Member ${tornId} denied battlestats (Code 16). Retrying without it.`);
           selections = 'bars,cooldowns,refills';
           res = await apiManager.fetchWithBackoff(`https://api.torn.com/user/?selections=${selections}&key=${rawApiKey}`);
           data = await res.json() as any;
        }

        if (data.error) {
          const errorCode = data.error.code;
          // Permanent API Key Errors in Torn:
          // 1: Key is empty, 2: Incorrect key, 3: Wrong type, 10: Fed jail, 13: Inactive, 16: Access level, 18: Account suspended
          const isPermanentKeyError = [1, 2, 3, 10, 13, 16, 18].includes(errorCode);

          if (isPermanentKeyError) {
             console.warn(`[Queue] Permanent API Key Error (Code ${errorCode}) for member ${tornId}: ${data.error.error}`);
             updatesBatch.push({
                id: tornId.toString(),
                updates: {
                   api_key_invalid: true,
                   last_failed_key: apiKey
                }
             });
             logBatch.push(`[ERROR] Member [${tornId}] API key invalid (Code ${errorCode}): ${data.error.error}`);
             message.ack(); // Acknowledge to prevent endless queue retries!
             return;
          } else {
             throw new Error(`Torn Error (Code ${errorCode}): ${data.error.error}`);
          }
        }

        const energyMax = data.energy?.maximum || 100;
        const isDonator = energyMax > 100;

        const updates: any = {
          id: tornId.toString(),
          name: data.name,
          energy: data.energy?.current,
          energy_max: data.energy?.maximum || (isDonator ? 150 : 100),
          cooldowns: data.cooldowns,
          refill_used: data.refills ? !!data.refills.energy_refill_used : false,
          last_updated: Math.floor(Date.now() / 1000),
          api_key_invalid: false // Reset flag on successful sync
        };

        if (data.strength !== undefined) {
          const real_stats = Math.floor(
            (data.strength || 0) * (1 + (data.strength_modifier || 0) / 100) +
            (data.defense || 0) * (1 + (data.defense_modifier || 0) / 100) +
            (data.speed || 0) * (1 + (data.speed_modifier || 0) / 100) +
            (data.dexterity || 0) * (1 + (data.dexterity_modifier || 0) / 100)
          );
          updates.real_stats = real_stats;
          updates.real_stats_updated = Date.now();
          console.log(`[Queue] 📊 Parsed real_stats for ${tornId}: ${real_stats} (strength=${data.strength}, mod=${data.strength_modifier})`);
        } else if (fetchStats) {
          // Mark it as updated so we don't try again for 24h if it was denied (Code 16)
          updates.real_stats_updated = Date.now();
          console.log(`[Queue] ⚠️ Stats requested for ${tornId} but 'strength' is undefined. Response keys: ${Object.keys(data).join(',')}`);
        }

        updatesBatch.push({
           id: tornId.toString(),
           updates
        });

        logBatch.push(`Sync [${tornId}] ${data.name}: E:${data.energy?.current} CD:${data.cooldowns?.drug || 0}`);
        message.ack();

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
