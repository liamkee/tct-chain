import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { verify } from 'hono/jwt'
import type { Env } from '../index'

const dashboard = new Hono<Env>()

// 获取全量快照 (Initial Snapshot)
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

// 清空存储 (用于调试和切换帮派)
dashboard.get('/clear', async (c) => {
  const id = c.env.CHAIN_MONITOR.idFromName('GLOBAL_MONITOR');
  const stub = c.env.CHAIN_MONITOR.get(id);
  await stub.fetch('http://do/internal/clear');
  return c.text('Dashboard Cache Cleared! Please refresh your main page.');
});

dashboard.get('/start', async (c) => {
  const id = c.env.CHAIN_MONITOR.idFromName('GLOBAL_MONITOR');
  const stub = c.env.CHAIN_MONITOR.get(id);
  await stub.fetch('http://do/internal/start');
  return c.text('Tactical Engine Started!');
});

dashboard.get('/stop', async (c) => {
  const id = c.env.CHAIN_MONITOR.idFromName('GLOBAL_MONITOR');
  const stub = c.env.CHAIN_MONITOR.get(id);
  await stub.fetch('http://do/internal/stop');
  return c.text('Tactical Engine Stopped!');
});

export default dashboard;
