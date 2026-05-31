import type { Env } from '../index'
import { ApiManager } from '../services/api_manager'
import { SecurityService } from '../services/security'

export async function consumer(batch: MessageBatch<any>, env: Env['Bindings']): Promise<void> {
  // 🚀 FORCE UPDATE: No more master switch check here.
  // We trust the messages coming from the Durable Object.
  console.log(`[Queue] 🔥 BOOTING CONSUMER - Processing batch of ${batch.messages.length} messages. No more gatekeeping!`);

  const apiManager = new ApiManager(env);
  const security = new SecurityService(env.ENCRYPTION_SECRET);

  // Unpack individual and bundled message formats
  const polls: { message: any; body: any }[] = [];
  for (const msg of batch.messages) {
    if (msg.body && msg.body.polls && Array.isArray(msg.body.polls)) {
      // Bundled format: unpack multiple member polls from a single Queue message
      for (const poll of msg.body.polls) {
        polls.push({
          message: msg,
          body: {
            ...poll,
            factionId: msg.body.factionId || 'GLOBAL_MONITOR'
          }
        });
      }
    } else {
      // Original format: single member poll per message
      polls.push({
        message: msg,
        body: msg.body
      });
    }
  }

  // Safe deduplicated ack/retry helper to prevent duplicate calls on shared bundled messages
  const retriedMessages = new Set<any>();
  const acknowledgedMessages = new Set<any>();

  const safeRetry = (msg: any) => {
    if (!retriedMessages.has(msg)) {
      retriedMessages.add(msg);
      try { msg.retry(); } catch (e) {}
    }
  };

  const safeAck = (msg: any) => {
    if (!acknowledgedMessages.has(msg) && !retriedMessages.has(msg)) {
      acknowledgedMessages.add(msg);
      try { msg.ack(); } catch (e) {}
    }
  };

  // Group polls by factionId to handle DO updates correctly
  const factionsMap = new Map<string, typeof polls>();
  for (const poll of polls) {
    const factionId = poll.body.factionId || 'GLOBAL_MONITOR';
    if (!factionsMap.has(factionId)) factionsMap.set(factionId, []);
    factionsMap.get(factionId)!.push(poll);
  }

  for (const [factionId, factionPolls] of factionsMap.entries()) {
    const id = env.CHAIN_MONITOR.idFromName(factionId.toString());
    const monitor = env.CHAIN_MONITOR.get(id);

    const keysCount: Record<string, number> = {};
    for (const poll of factionPolls) {
      if (poll.body.apiKey) {
        keysCount[poll.body.apiKey] = (keysCount[poll.body.apiKey] || 0) + 1;
      }
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

    await Promise.allSettled(factionPolls.map(async (poll) => {
      const { 
        tornId, 
        apiKey, 
        ts, 
        test, 
        fetchStats,
        existingRealStats,
        existingRealStatsUpdated,
        existingRealStatsSource
      } = poll.body;
      
      if (test === 'Ping from health check!') {
        safeAck(poll.message);
        return;
      }

      if (!tornId) {
         console.error('[Queue] Error: Message body is empty or missing tornId:', poll.body);
         safeAck(poll.message);
         return;
      }

      // 🚀 Old Request Elimination (Max 2 mins age)
      if (ts && Date.now() - ts > 120000) {
         console.log(`[Queue] Dropping stale message for ${tornId} (Age: ${Math.round((Date.now() - ts)/1000)}s)`);
         safeAck(poll.message);
         return;
      }

      if (apiKey && !keyTokens[apiKey]) {
         logBatch.push(`[LIMIT] Rate limit hit for ${tornId}.`);
         safeRetry(poll.message);
         return;
      }

      if (apiKey && poll.message.attempts > 3) {
         console.log(`[Queue] ⚠️ Poison message for ${tornId}. Max retries exceeded.`);
         updatesBatch.push({
            id: tornId.toString(),
            updates: {
               api_key_invalid: true,
               last_failed_key: apiKey
            }
         });
         logBatch.push(`[ALERT] Member ${tornId} API failed multiple times. Polling suspended.`);
         safeAck(poll.message); // Avoid endless loop
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

        try {
          if (rawApiKey) {
            let res = await apiManager.fetchWithBackoff(`https://api.torn.com/user/?selections=${selections}&key=${rawApiKey}`);
            data = await res.json() as any;
            
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
                 safeAck(poll.message); // Acknowledge to prevent endless queue retries!
                 return;
              } else {
                 throw new Error(`Torn Error (Code ${errorCode}): ${data.error.error}`);
              }
            }
          }
        } catch (fetchErr: any) {
          console.error(`[Queue] Torn API fetch failed for ${tornId}:`, fetchErr);
          // Throw if it is a transient error with rawApiKey
          if (rawApiKey) throw fetchErr;
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
          updates.api_key_invalid = false; // Reset flag on successful sync
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
          console.log(`[Queue] 📊 Parsed real_stats for ${tornId}: ${realStats} (source=torn)`);
        } else if (fetchStats) {
          const isTornSource = existingRealStatsSource === 'torn';
          const isFresh = existingRealStatsUpdated && (Date.now() - existingRealStatsUpdated < 12 * 60 * 60 * 1000);

          if (isTornSource) {
            // Keep direct Torn API stats (always prioritised)
            realStats = existingRealStats;
            realStatsUpdated = existingRealStatsUpdated;
            realStatsSource = 'torn';
            console.log(`[Queue] 📊 Keeping direct Torn stats for ${tornId} (prioritised)`);
          } else if (isFresh) {
            // Keep fresh FFScouter estimate
            realStats = existingRealStats;
            realStatsUpdated = existingRealStatsUpdated;
            realStatsSource = 'ffscouter';
            console.log(`[Queue] 📊 Keeping fresh FFScouter stats for ${tornId} (Age: ${Math.round((Date.now() - existingRealStatsUpdated)/3600000)}h)`);
          } else {
            // Stale or empty, call FFScouter API
            const ffscouterApiKey = env.FFSCOUTER_API_KEY || 'ptlgbJYXcXtqtPlO';
            console.log(`[Queue] 🔍 Calling FFScouter API for ${tornId} stats...`);
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
                  console.log(`[Queue] 📊 Retrieved FFScouter stat estimate for ${tornId}: ${realStats}`);
                } else {
                  console.warn(`[Queue] ⚠️ FFScouter returned no estimate for ${tornId}`);
                  // Keep existing
                  realStats = existingRealStats;
                  realStatsUpdated = existingRealStatsUpdated || Date.now();
                  realStatsSource = existingRealStatsSource || 'ffscouter';
                }
              } else {
                console.error(`[Queue] ❌ FFScouter API returned status ${ffRes.status}`);
                // Keep existing
                realStats = existingRealStats;
                realStatsUpdated = existingRealStatsUpdated || Date.now();
                realStatsSource = existingRealStatsSource || 'ffscouter';
              }
            } catch (ffErr: any) {
              console.error(`[Queue] ❌ FFScouter API Error for ${tornId}:`, ffErr);
              // Keep existing
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
        safeAck(poll.message);

      } catch (err: any) {
        console.error(`[Queue] Critical Error processing ${tornId}:`, err);
        safeRetry(poll.message);
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
