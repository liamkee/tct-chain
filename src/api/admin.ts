import { Hono } from 'hono'
import { verify } from 'hono/jwt'
import { getCookie } from 'hono/cookie'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import { members } from '../db/schema'
import type { Env } from './index'

const admin = new Hono<Env>()

// Admin Role Middleware
admin.use('*', async (c, next) => {
  const token = getCookie(c, 'tct_session')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)

  try {
    const payload = await verify(token, c.env.JWT_SECRET, 'HS256') as any
    if (payload.role !== 'admin') {
      return c.json({ error: 'Forbidden: Admin access required' }, 403)
    }
    c.set('jwtPayload', payload)
    await next()
  } catch (e) {
    return c.json({ error: 'Invalid Session' }, 401)
  }
})

// Toggle Master Switch
admin.post('/toggle', async (c) => {
  const { state } = await c.req.json() as { state: 'ON' | 'OFF' }
  
  if (state !== 'ON' && state !== 'OFF') {
    return c.json({ error: 'Invalid state' }, 400)
  }

  const payload = c.get('jwtPayload') as any
  let operator = `Unknown (${payload?.torn_id})`
  if (payload?.torn_id) {
    try {
      const db = drizzle(c.env.DB)
      const member = await db.select().from(members).where(eq(members.torn_id, payload.torn_id)).limit(1)
      if (member.length > 0) {
        operator = `${member[0].name} (${payload.torn_id})`
      }
    } catch (e) {
      console.error('[Admin API] Failed to fetch operator name:', e)
    }
  }

  // Use a singleton DO instance for the global switch
  const id = c.env.CHAIN_MONITOR.idFromName('GLOBAL_MONITOR')
  const obj = c.env.CHAIN_MONITOR.get(id)

  // Pass command to DO (Transparent Proxy)
  const res = await obj.fetch(new Request(`${new URL(c.req.url).origin}/toggle`, {
    method: 'POST',
    body: JSON.stringify({ state, operator }),
    headers: { 'Content-Type': 'application/json' }
  }))

  if (!res.ok) {
    return c.json({ error: 'Failed to update Master Switch' }, 500)
  }

  const result = await res.json()
  return c.json(result)
})

export default admin
