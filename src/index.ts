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

const app = new Hono<Env>()

// 🚀 WebSocket Auth Gateway
app.get('/ws', async (c) => {
  const token = getCookie(c, 'tct_session')
  if (!token) return c.text('Unauthorized', 401)

  try {
    const payload = await verify(token, c.env.JWT_SECRET, 'HS256')
    const id = c.env.CHAIN_MONITOR.idFromName(c.env.FACTION_ID)
    const stub = c.env.CHAIN_MONITOR.get(id)

    // 转发给 DO 处理 (包含 userId 方便 DO 做定向推送)
    const url = new URL(c.req.url)
    url.pathname = '/ws'
    url.searchParams.set('userId', payload.torn_id as string)
    
    return stub.fetch(new Request(url, c.req.raw))
  } catch (e) {
    return c.text('Invalid Session', 401)
  }
})

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
