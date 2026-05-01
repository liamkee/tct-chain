import { Hono } from 'hono'
import { verify } from 'hono/jwt'
import { getCookie } from 'hono/cookie'
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

  // Use a singleton DO instance for the global switch
  const id = c.env.CHAIN_MONITOR.idFromName('GLOBAL_MONITOR')
  const obj = c.env.CHAIN_MONITOR.get(id)

  // Pass command to DO (Transparent Proxy)
  const res = await obj.fetch(new Request(`${new URL(c.req.url).origin}/toggle`, {
    method: 'POST',
    body: JSON.stringify({ state }),
    headers: { 'Content-Type': 'application/json' }
  }))

  if (!res.ok) {
    return c.json({ error: 'Failed to update Master Switch' }, 500)
  }

  const result = await res.json()
  return c.json(result)
})

export default admin
