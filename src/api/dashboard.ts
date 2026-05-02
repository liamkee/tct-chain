import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { verify } from 'hono/jwt'
import type { Env } from '../index'

const dashboard = new Hono<Env>()

// Auth middleware - all dashboard routes require authenticated session
dashboard.use('*', async (c, next) => {
  const token = getCookie(c, 'tct_session')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)

  try {
    const payload = await verify(token, c.env.JWT_SECRET, 'HS256') as any
    c.set('jwtPayload', payload) // Store payload for later use
    await next()
  } catch (e) {
    return c.json({ error: 'Invalid Session' }, 401)
  }
})

// Admin-only protection for destructive routes
const adminOnly = async (c: any, next: any) => {
  const payload = c.get('jwtPayload')
  if (payload?.role !== 'admin') {
    return c.json({ error: 'Forbidden: Admin access required' }, 403)
  }
  await next()
}

dashboard.use('/start', adminOnly)
dashboard.use('/stop', adminOnly)
dashboard.use('/clear', adminOnly)

// Initial snapshot (any authenticated user)
dashboard.get('/snapshot', async (c) => {
  const id = c.env.CHAIN_MONITOR.idFromName('GLOBAL_MONITOR');
  const stub = c.env.CHAIN_MONITOR.get(id);
  
  const res = await stub.fetch('http://do/internal/members');
  const members = await res.json();
  
  return c.json({
    success: true,
    data: {
      members,
      lastUpdatedAt: Date.now()
    }
  });
});

// Clear storage (admin only, enforced by middleware)
dashboard.get('/clear', async (c) => {
  const id = c.env.CHAIN_MONITOR.idFromName('GLOBAL_MONITOR');
  const stub = c.env.CHAIN_MONITOR.get(id);
  await stub.fetch('http://do/internal/clear');
  return c.text('Dashboard Cache Cleared! Please refresh your main page.');
});

// Start engine (admin only)
dashboard.get('/start', async (c) => {
  const id = c.env.CHAIN_MONITOR.idFromName('GLOBAL_MONITOR');
  const stub = c.env.CHAIN_MONITOR.get(id);
  await stub.fetch('http://do/internal/start');
  return c.text('Tactical Engine Started!');
});

// Stop engine (admin only)
dashboard.get('/stop', async (c) => {
  const id = c.env.CHAIN_MONITOR.idFromName('GLOBAL_MONITOR');
  const stub = c.env.CHAIN_MONITOR.get(id);
  await stub.fetch('http://do/internal/stop');
  return c.text('Tactical Engine Stopped!');
});

export default dashboard;
