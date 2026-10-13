import { handle, ProbeRoom, SyncRoom as AppSyncRoom } from '../src/worker/app';
import probe from '../src/worker/index';
import migration from '../migrations/0001.sql';

export { ProbeRoom };
export class SyncRoom extends AppSyncRoom {
  protected async now(): Promise<number> {
    return await this.env.DB.prepare('SELECT now FROM test_control WHERE id = 1').first<number>('now') ?? Date.now();
  }
}

async function setup(env: Env) {
  for (const sql of migration.split(';').map(sql => sql.trim()).filter(sql => sql && !/^--[^\n]*$/.test(sql))) {
    await env.DB.prepare(sql).run();
  }
  await env.DB.exec('CREATE TABLE IF NOT EXISTS test_control (id INTEGER PRIMARY KEY, now INTEGER, fail INTEGER); CREATE TABLE IF NOT EXISTS test_mailbox (email TEXT, url TEXT)');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!['127.0.0.1', 'localhost'].includes(new URL(request.url).hostname)) return new Response('僅本機測試', { status: 403 });
    await setup(env);
    const path = new URL(request.url).pathname;
    if (path.startsWith('/__test/')) {
      if (path === '/__test/control' && request.method === 'POST') {
        const { now, fail } = await request.json<{ now?: number; fail?: boolean }>();
        await env.DB.prepare('INSERT OR REPLACE INTO test_control VALUES (1, ?, ?)').bind(now ?? Date.now(), fail ? 1 : 0).run();
        return Response.json({ ok: true });
      }
      if (path === '/__test/mailbox') return Response.json((await env.DB.prepare('SELECT * FROM test_mailbox').all()).results);
      if (path === '/__test/reset' && request.method === 'POST') {
        const tables = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all<{ name: string }>()).results;
        await env.DB.batch(tables.map(({ name }) => env.DB.prepare(`DELETE FROM "${name}"`)).reverse());
        return Response.json({ ok: true });
      }
      return new Response('Not found', { status: 404 });
    }
    if (path.startsWith('/parties/rooms/') || path === '/health') return probe.fetch(request, env);
    const control = await env.DB.prepare('SELECT now, fail FROM test_control WHERE id = 1').first<{ now: number; fail: number }>();
    return handle(request, { ...env, OWNER_EMAIL: 'owner@example.test', BETTER_AUTH_URL: 'http://127.0.0.1:5173', BETTER_AUTH_SECRET: 'test-only-secret-with-at-least-32-characters' }, {
      now: () => control?.now ?? Date.now(),
      sendMail: async (email, url) => {
        if (control?.fail) throw new Error('測試寄信故障');
        await env.DB.prepare('INSERT INTO test_mailbox VALUES (?, ?)').bind(email, url).run();
      },
    });
  },
} satisfies ExportedHandler<Env>;
