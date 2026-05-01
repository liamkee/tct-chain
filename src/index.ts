import { Hono } from 'hono'
import api from './api'

type Env = {
  Bindings: {
    ASSETS: Fetcher;
    TCT_CACHE: KVNamespace;
    DB: D1Database;
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
export class ChainMonitor {
  state: DurableObjectState;
  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
  }
  
  async fetch(request: Request) {
    return new Response('ChainMonitor initialized');
  }
}

export default app
