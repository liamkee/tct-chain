import { Hono } from 'hono'
import { DurableObject } from 'cloudflare:workers'
import api from './api'

import { ChainMonitor } from './services/monitor'

export type Env = {
  Bindings: {
    ASSETS: Fetcher;
    TCT_CACHE: KVNamespace;
    TCT_KV: KVNamespace;
    DB: D1Database;
    MEMBER_QUEUE: Queue;
    CHAIN_MONITOR: DurableObjectNamespace;
    JWT_SECRET: string;
    ENCRYPTION_SECRET: string;
    DISCORD_CLIENT_ID: string;
    DISCORD_CLIENT_SECRET: string;
    FACTION_ID: string;
  }
}

const app = new Hono<Env>()

app.route('/api', api)

// SPA fallback in production
app.get('*', async (c, next) => {
  if (c.env?.ASSETS) {
    return await c.env.ASSETS.fetch(new Request(new URL('/', c.req.url)))
  }
  await next()
})

// Durable Object: ChainMonitor
export { ChainMonitor }

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<any>, env: Env['Bindings']): Promise<void> {
    // Zero-Waste check for Queue
    const switchState = await env.TCT_KV.get('SYSTEM_MASTER_SWITCH');
    if (switchState === 'OFF') {
      console.log('[Queue] 🛑 Master Switch is OFF. Dropping batch to save execution time.');
      return;
    }

    console.log(`[Queue] 🚀 Received batch of ${batch.messages.length} messages.`);
    for (const message of batch.messages) {
      console.log(`[Queue] 📨 Processing payload:`, message.body);
    }
  }
}
