import { Hono } from 'hono'
import { drizzle } from 'drizzle-orm/d1'
import { sign } from 'hono/jwt'
import { setCookie } from 'hono/cookie'
import { members } from '../db/schema'
import auth from './auth'
import admin from './admin'

export type Env = {
  Bindings: {
    DB: D1Database;
    TCT_CACHE: KVNamespace;
    TCT_KV: KVNamespace; // Master Switch KV
    CHAIN_MONITOR: DurableObjectNamespace;
    MEMBER_QUEUE: Queue;
    DISCORD_CLIENT_ID: string;
    DISCORD_CLIENT_SECRET: string;
    JWT_SECRET: string;
    ENCRYPTION_SECRET: string;
    FACTION_ID: string;
  }
}

const api = new Hono<Env>()

api.route('/auth', auth)
api.route('/admin', admin)

// Development/Test Routes (Restricted)
api.use('/test/*', async (c, next) => {
  // In Cloudflare Workers, we can check for a specific dev flag or check hostname
  // For local development with wrangler, it usually has specific headers or environment
  // We'll use a custom ENVIRONMENT var or check if it's running on localhost
  const isLocal = new URL(c.req.url).hostname === '127.0.0.1' || new URL(c.req.url).hostname === 'localhost';
  if (!isLocal) {
    return c.json({ error: 'Test routes are only available in local development' }, 403);
  }
  await next();
});

api.post('/test/invalid-key', async (c) => {
  const db = drizzle(c.env.DB);
  await c.env.DB.prepare('INSERT OR REPLACE INTO members (torn_id, name, api_key) VALUES (?, ?, ?)')
    .bind(999999, 'InvalidUser', 'WRONG_KEY')
    .run();
  return c.json({ success: true, msg: 'Injected invalid user 999999' });
})

api.post('/test/mock-login', async (c) => {
  const { role } = await c.req.json() as { role: string };
  const token = await sign({
    torn_id: 1,
    discord_id: '123',
    role: role || 'admin',
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24
  }, c.env.JWT_SECRET, 'HS256');
  
  setCookie(c, 'tct_session', token, {
    httpOnly: true,
    secure: false, // Local testing doesn't always have HTTPS
    sameSite: 'Lax',
    path: '/'
  });
  
  return c.json({ success: true, token });
})

api.post('/test/concurrency', async (c) => {
  const { count } = await c.req.json() as { count: number };
  const batch: any[] = [];
  for (let i = 0; i < count; i++) {
    batch.push({
      body: { tornId: `TEST_${i}`, apiKey: 'MOCK_KEY' }
    });
    if (batch.length === 10) {
      await c.env.MEMBER_QUEUE.sendBatch(batch);
      batch.length = 0;
    }
  }
  if (batch.length > 0) {
    await c.env.MEMBER_QUEUE.sendBatch(batch);
  }
  return c.json({ success: true, queued: count });
})

// Global Master Switch Middleware (Edge Interception)
export const checkMasterSwitch = async (c: any, next: any) => {
  // Cloudflare KV requirement: cacheTtl must be at least 30s
  const state = await c.env.TCT_KV.get('SYSTEM_MASTER_SWITCH', { cacheTtl: 30 });
  
  if (state === 'OFF') {
    return c.json({ 
      error: 'System is currently maintenance mode (Master Switch OFF)',
      status: 'stopped'
    }, 503);
  }
  await next();
};

api.get('/health', checkMasterSwitch, async (c) => {
  try {
    // 1. Test KV
    await c.env.TCT_CACHE.put('ping', 'pong');
    const kvTest = await c.env.TCT_CACHE.get('ping');

    // 2. Test D1
    const db = drizzle(c.env.DB);
    const dbTest = await db.select().from(members).limit(1);

    // 3. Test Queue binding
    const queueExists = !!c.env.MEMBER_QUEUE;
    if (queueExists) {
      await c.env.MEMBER_QUEUE.send({ test: 'Ping from health check!', time: Date.now() });
    }

    return c.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      tests: {
        kv: kvTest === 'pong' ? 'Passed ✅' : 'Failed ❌',
        db: Array.isArray(dbTest) ? 'Passed ✅' : 'Failed ❌',
        queue: queueExists ? 'Passed ✅' : 'Failed ❌'
      }
    })
  } catch (error: any) {
    return c.json({ status: 'error', message: error.message, stack: error.stack }, 500)
  }
})

export default api
