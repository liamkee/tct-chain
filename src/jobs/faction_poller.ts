import type { Env } from '../index'

export async function producer(event: any, env: Env['Bindings']): Promise<void> {
  const switchState = await env.TCT_KV.get('SYSTEM_MASTER_SWITCH');
  if (switchState !== 'ON') return;

  // Query all active factions from the database
  const factions = await env.DB.prepare('SELECT id FROM Factions WHERE status = "active"').all();
  
  console.log(`[Producer] Found ${factions.results.length} active factions to ping.`);

  for (const faction of factions.results as any[]) {
    const factionId = faction.id.toString();
    const id = env.CHAIN_MONITOR.idFromName(factionId);
    const monitor = env.CHAIN_MONITOR.get(id);
    
    // Initialize and start the DO
    await monitor.fetch('http://do/internal/init', {
      method: 'POST',
      body: JSON.stringify({ factionId })
    });
    await monitor.fetch('http://do/internal/start');
    
    console.log(`[Producer] Pinged faction DO: ${factionId}`);
  }
}
