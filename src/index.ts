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

import { getCookie } from 'hono/cookie'
import { verify } from 'hono/jwt'

const app = new Hono<Env>();

// 🚀 API 路由必须挂载
app.route('/api', api);

// 🚀 WebSocket 网关
app.all('/ws', async (c) => {
  console.log('[WS] Incoming connection attempt...');
  const id = c.env.CHAIN_MONITOR.idFromName('GLOBAL_MONITOR');
  const stub = c.env.CHAIN_MONITOR.get(id);
  return stub.fetch(c.req.raw);
});

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
