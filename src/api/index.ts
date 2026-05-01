import { Hono } from 'hono'
import { drizzle } from 'drizzle-orm/d1'
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
