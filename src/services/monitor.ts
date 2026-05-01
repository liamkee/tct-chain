import type { Env } from '../api/index'

export class ChainMonitor implements DurableObject {
  private state: DurableObjectState;
  private env: Env['Bindings'];

  constructor(state: DurableObjectState, env: Env['Bindings']) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/toggle') {
      const { state } = await request.json() as { state: 'ON' | 'OFF' };
      
      // 1. Update Internal Storage (SSOT)
      await this.state.storage.put('master_switch', state);

      // 2. Sync to KV (Edge Mirror) - Awaiting for robustness
      await this.env.TCT_KV.put('SYSTEM_MASTER_SWITCH', state);

      // 3. Ignition Check
      if (state === 'ON') {
        const currentAlarm = await this.state.storage.getAlarm();
        if (currentAlarm === null) {
          // Ignition! Start the cycle immediately.
          await this.state.storage.setAlarm(Date.now());
        }
      }
      // Note: If OFF, we don't cancel existing alarm. 
      // The alarm handler will self-terminate on next wake.

      return new Response(JSON.stringify({ success: true, state }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('Not Found', { status: 404 });
  }

  async alarm(): Promise<void> {
    // 1. Primary check (Self-Correction / SSOT)
    const switchState = await this.state.storage.get<string>('master_switch');
    
    if (switchState !== 'ON') {
      console.log('[ChainMonitor] Master Switch is OFF. Sleeping...');
      // Silent termination: No setAlarm called here.
      return;
    }

    try {
      // 2. Perform Monitoring Task (PHASE 1 Logic will go here)
      console.log('[ChainMonitor] Performing collection task...');
      
      // MOCK: Simulation of work
      // await this.performCollection();

      // 3. Schedule Next Wake (Zero-Waste: Exactly 1 minute or dynamic interval)
      const interval = 60 * 1000; // 1 minute
      await this.state.storage.setAlarm(Date.now() + interval);
      
    } catch (error) {
      console.error('[ChainMonitor] Alarm execution failed:', error);
      // Even on error, we might want to retry in 1 minute
      await this.state.storage.setAlarm(Date.now() + 60 * 1000);
    }
  }
}
