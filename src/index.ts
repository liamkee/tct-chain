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
    ANALYTICS: AnalyticsEngineDataset;
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

import { producer } from './jobs/faction_poller'
import { consumer } from './jobs/member_consumer'

export default {
  fetch: app.fetch,
  async scheduled(event: any, env: Env['Bindings'], ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(producer(event, env));
  },
  async queue(batch: MessageBatch<any>, env: Env['Bindings'], ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(consumer(batch, env));
  }
}
