import { Hono } from 'hono'
import { DurableObject } from 'cloudflare:workers'
import api from './api'

type Env = {
  Bindings: {
    ASSETS: Fetcher;
    TCT_CACHE: KVNamespace;
    DB: D1Database;
    MEMBER_QUEUE: Queue;
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
export class ChainMonitor extends DurableObject {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }
  
  async fetch(request: Request) {
    return new Response('ChainMonitor initialized');
  }
}

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<any>, env: Env['Bindings']): Promise<void> {
    console.log(`[Queue] 🚀 Received batch of ${batch.messages.length} messages.`);
    for (const message of batch.messages) {
      console.log(`[Queue] 📨 Processing payload:`, message.body);
    }
  }
}
