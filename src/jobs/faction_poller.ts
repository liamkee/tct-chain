import type { Env } from '../index'
import { ApiManager } from '../services/api_manager'

export async function producer(event: any, env: Env['Bindings']): Promise<void> {
  const switchState = await env.TCT_KV.get('SYSTEM_MASTER_SWITCH');
  if (switchState !== 'ON') {
    console.log('[Producer] Master Switch is OFF. Skipping.');
    return;
  }

  const apiManager = new ApiManager(env);
  const id = env.CHAIN_MONITOR.idFromName('GLOBAL_MONITOR');
  const monitor = env.CHAIN_MONITOR.get(id);
  const statusRes = await monitor.fetch('http://do/internal/members');
  const doMembers = statusRes.ok ? await statusRes.json() as any : {};

  const { results } = await env.DB.prepare('SELECT torn_id, api_key FROM members WHERE api_key IS NOT NULL').all();
  if (!results || results.length === 0) return;

  const batch: any[] = [];
  let skipped = 0;

  for (const user of results) {
    const tornId = String(user.torn_id);
    const apiKey = String(user.api_key);
    const status = doMembers[`member_${tornId}_status`];
    
    // 按需熔断
    if (status) {
        if ((status.state === 'Hospital' || status.state === 'Jail') && status.until > Date.now() / 1000 + 3600) {
          skipped++;
          apiManager.logAnalytics('circuit_breaker', tornId, 'hospital_or_jail_long');
          await monitor.fetch('http://do/internal/log', { method: 'POST', body: JSON.stringify({ msg: `[BREAKER] Skipped member ${tornId} (${status.state} > 1h)` }) });
          continue;
       }
       if (status.state === 'Traveling') {
          skipped++;
          apiManager.logAnalytics('circuit_breaker', tornId, 'traveling');
          await monitor.fetch('http://do/internal/log', { method: 'POST', body: JSON.stringify({ msg: `[BREAKER] Skipped member ${tornId} (Traveling)` }) });
          continue;
       }
    }
    
    batch.push({
      body: { tornId, apiKey, ts: Date.now() }
    });

    if (batch.length === 20) {
      await env.MEMBER_QUEUE.sendBatch(batch);
      batch.length = 0;
    }
  }

  if (batch.length > 0) {
    await env.MEMBER_QUEUE.sendBatch(batch);
  }

  console.log(`[Producer] Queued ${results.length - skipped} members. Skipped ${skipped} due to circuit breaker.`);
}
