import { Hono } from 'hono'
import { drizzle } from 'drizzle-orm/d1'
import { members } from '../db/schema'

type Env = {
  Bindings: {
    DB: D1Database;
    TCT_CACHE: KVNamespace;
    MEMBER_QUEUE: Queue;
  }
}

const api = new Hono<Env>()

api.get('/health', async (c) => {
  try {
    // 1. Test KV
    await c.env.TCT_CACHE.put('ping', 'pong');
    const kvTest = await c.env.TCT_CACHE.get('ping');

    // 2. Test D1
    const db = drizzle(c.env.DB);
    const dbTest = await db.select().from(members).limit(1);

    // 3. Test Queue binding
    const queueExists = !!c.env.MEMBER_QUEUE;

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
