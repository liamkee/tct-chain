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
    CHAIN_MONITOR: DurableObjectNamespace;
    JWT_SECRET: string;
    ENCRYPTION_SECRET: string;
    COMMANDER_API_KEY: string;
    DISCORD_CLIENT_ID: string;
    DISCORD_CLIENT_SECRET: string;
    FACTION_ID: string;
    DISCORD_PUBLIC_KEY: string;
    ALERTS_WEBHOOK_URL: string;
    FFSCOUTER_API_KEY?: string;
    ANALYTICS?: AnalyticsEngineDataset;
  },
  Variables: {
    parsedBody: any;
  }
}

import { getCookie } from 'hono/cookie'
import { verify } from 'hono/jwt'

const app = new Hono<Env>();

// 🚀 API 路由必须挂载
app.route('/api', api);

// 🚀 WebSocket 网关
app.all('/ws', async (c) => {
  const token = getCookie(c, 'tct_session')
  if (!token) return new Response('Unauthorized', { status: 401 })

  try {
    const payload = await verify(token, c.env.JWT_SECRET, 'HS256') as any
    const factionId = payload.faction_id
    if (!factionId) return new Response('No faction associated with session', { status: 400 })

    const id = c.env.CHAIN_MONITOR.idFromName(factionId.toString())
    const stub = c.env.CHAIN_MONITOR.get(id)
    return stub.fetch(c.req.raw)
  } catch (e) {
    return new Response('Invalid Session', { status: 401 })
  }
})

// Debug Route
app.get('/api/debug', async (c) => {
    const factionId = c.env.FACTION_ID || '53822';
    const id = c.env.CHAIN_MONITOR.idFromName(factionId.toString())
    const stub = c.env.CHAIN_MONITOR.get(id)
    return stub.fetch(new Request('http://do/status'));
})

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

export default {
  fetch: app.fetch,
  async scheduled(event: any, env: Env['Bindings'], ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(producer(event, env));
  }
}
