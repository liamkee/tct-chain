
import type { Env } from './index';

export default {
  async fetch(request: Request, env: Env['Bindings']): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/test/early-stop') {
      const id = env.CHAIN_MONITOR.idFromName('GLOBAL_MONITOR');
      const monitor = env.CHAIN_MONITOR.get(id);

      // 1. 设置 Master Switch 为 OFF
      await monitor.fetch('http://do/toggle', {
        method: 'POST',
        body: JSON.stringify({ state: 'OFF' }),
        headers: { 'Content-Type': 'application/json' }
      });

      // 2. 模拟触发一次 Alarm (由于我们在代码里写了死循环 Alarm，需要检查其逻辑)
      // 在 monitor.ts 中，如果 switchState === 'OFF' && chainTimeout === 0，会 deleteAlarm
      // 我们模拟这种状态
      return new Response('Triggered OFF state. Check console/logs for "Sleeping..."');
    }

    if (url.pathname === '/test/concurrency') {
      const count = parseInt(url.searchParams.get('count') || '10', 10);
      const batch: any[] = [];
      for (let i = 0; i < count; i++) {
        batch.push({
          body: { tornId: `TEST_${i}`, apiKey: 'MOCK_KEY' }
        });
        if (batch.length === 10) {
          await env.MEMBER_QUEUE.sendBatch(batch);
          batch.length = 0;
        }
      }
      if (batch.length > 0) {
        await env.MEMBER_QUEUE.sendBatch(batch);
      }
      return new Response(`Queued ${count} test messages`);
    }

    if (url.pathname === '/test/invalid-key') {
       // 插入一个带无效 Key 的用户到 D1
       await env.DB.prepare('INSERT OR REPLACE INTO Members (torn_id, name, api_key) VALUES (?, ?, ?)')
         .bind(999999, 'InvalidUser', 'WRONG_KEY')
         .run();
       
       return new Response('Injected invalid user. Run poller to verify handling.');
    }

    return new Response('Test Runner Ready');
  }
}
