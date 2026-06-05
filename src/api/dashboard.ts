import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { verify } from 'hono/jwt'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import { members } from '../db/schema'
import type { Env } from '../index'

const dashboard = new Hono<Env>()

// Auth middleware - all dashboard routes require authenticated session
dashboard.use('*', async (c, next) => {
  const token = getCookie(c, 'tct_session')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)

  try {
    const payload = await verify(token, c.env.JWT_SECRET, 'HS256') as any
    if (!payload.faction_id) return c.json({ error: 'No faction associated with session' }, 400)
    c.set('jwtPayload', payload)
    await next()
  } catch (e) {
    return c.json({ error: 'Invalid Session' }, 401)
  }
})

// Helper to get Faction-specific DO
const getFactionDO = (c: any) => {
  const payload = c.get('jwtPayload')
  const factionId = payload.faction_id
  const id = c.env.CHAIN_MONITOR.idFromName(factionId.toString())
  return c.env.CHAIN_MONITOR.get(id)
}

// Admin-only protection
const adminOnly = async (c: any, next: any) => {
  const payload = c.get('jwtPayload')
  if (payload?.role !== 'admin') {
    return c.json({ error: 'Forbidden: Admin access required' }, 403)
  }
  await next()
}

dashboard.use('/clear', adminOnly)

// Initial snapshot
dashboard.get('/snapshot', async (c) => {
  const stub = getFactionDO(c)
  const res = await stub.fetch(new URL('/snapshot', c.req.url).toString())
  return c.json(await res.json())
})

// Clear storage (admin only)
dashboard.get('/clear', async (c) => {
  const stub = getFactionDO(c)
  await stub.fetch(new URL('/internal/clear', c.req.url).toString())
  return c.text('Dashboard Cache Cleared!')
})

// Start engine (all logged-in users)
dashboard.get('/start', async (c) => {
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
      console.error('[Dashboard API] Failed to fetch operator name:', e)
    }
  }

  const stub = getFactionDO(c)
  const url = new URL('/internal/start', c.req.url)
  url.searchParams.set('operator', operator)
  await stub.fetch(url.toString())
  return c.text('Tactical Engine Started!')
})

// Stop engine (all logged-in users)
dashboard.get('/stop', async (c) => {
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
      console.error('[Dashboard API] Failed to fetch operator name:', e)
    }
  }

  const stub = getFactionDO(c)
  const url = new URL('/internal/stop', c.req.url)
  url.searchParams.set('operator', operator)
  await stub.fetch(url.toString())
  return c.text('Tactical Engine Stopped!')
})

// Update sync offset (admin only)
dashboard.post('/offset', adminOnly, async (c) => {
  const body = await c.req.json()
  const stub = getFactionDO(c)
  const res = await stub.fetch(new URL('/internal/offset', c.req.url).toString(), {
    method: 'POST',
    body: JSON.stringify(body)
  })
  return c.json(await res.json())
})

export default dashboard
