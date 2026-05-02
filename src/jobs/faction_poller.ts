import type { Env } from '../index'
import { ApiManager } from '../services/api_manager'

export async function producer(event: any, env: Env['Bindings']): Promise<void> {
  // 🚀 Watchdog: Ensure the Durable Object alarm is active if the master switch is ON
  const switchState = await env.TCT_KV.get('SYSTEM_MASTER_SWITCH');
  if (switchState !== 'ON') return;

  const id = env.CHAIN_MONITOR.idFromName('GLOBAL_MONITOR');
  const monitor = env.CHAIN_MONITOR.get(id);
  
  // Calling /internal/start ensures the DO is awake and its alarm is scheduled
  await monitor.fetch('http://do/internal/start');
  console.log('[Producer] Watchdog pinged Durable Object.');
}
