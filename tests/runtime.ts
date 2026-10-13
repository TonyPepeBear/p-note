import { handle, ProbeRoom, SyncRoom as AppSyncRoom } from '../src/worker/app';
import probe from '../src/worker/index';
import migration from '../migrations/0001.sql';
import pagesMigration from '../migrations/0002.sql';
import backupsMigration from '../migrations/0003.sql';

export { ProbeRoom };
export class SyncRoom extends AppSyncRoom {
  protected async now(): Promise<number> {
    return await this.env.DB.prepare('SELECT now FROM test_control WHERE id = 1').first<number>('now') ?? Date.now();
  }
  async onRequest(request?: Request): Promise<Response> {
    if (request && new URL(request.url).pathname === '/__test/drop-connections') {
      for (const connection of this.getConnections()) connection.close(1012, '測試服務重啟');
      return Response.json({ ok: true });
    }
    return super.onRequest();
  }
}

async function setup(env: Env) {
  for (const sql of (migration + pagesMigration + backupsMigration).split(';').map(sql => sql.trim()).filter(sql => sql && !/^--[^\n]*$/.test(sql))) {
    await env.DB.prepare(sql).run();
  }
  await env.DB.exec('CREATE TABLE IF NOT EXISTS test_control (id INTEGER PRIMARY KEY, now INTEGER, fail INTEGER); CREATE TABLE IF NOT EXISTS test_mailbox (email TEXT, url TEXT)');
  await env.DB.exec('CREATE TABLE IF NOT EXISTS test_asset_control (id INTEGER PRIMARY KEY, fail INTEGER)');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!['127.0.0.1', 'localhost'].includes(new URL(request.url).hostname)) return new Response('僅本機測試', { status: 403 });
    await setup(env);
    const path = new URL(request.url).pathname;
    if (path.startsWith('/__test/')) {
      if (path === '/__test/drop-connections' && request.method === 'POST') {
        const { room } = await request.json<{ room: string }>();
        if (!/^[a-f0-9]{64}$/.test(room)) return new Response('無效測試房間', { status: 400 });
        return env.SYNC.getByName(room).fetch('http://127.0.0.1/__test/drop-connections');
      }
      if (path === '/__test/asset-failure' && request.method === 'POST') {
        const { fail } = await request.json<{ fail: boolean }>();
        await env.DB.prepare('INSERT OR REPLACE INTO test_asset_control VALUES (1, ?)').bind(fail ? 1 : 0).run();
        return Response.json({ ok: true });
      }
      if (path.startsWith('/__test/assets/')) {
        const key = path.slice('/__test/assets/'.length);
        if (request.method === 'POST') { await env.ASSETS.put(key, await request.arrayBuffer()); return Response.json({ ok: true }); }
        const object = await env.ASSETS.get(key);
        return object ? new Response(object.body) : new Response('Not found', { status: 404 });
      }
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
    const failAsset = await env.DB.prepare('SELECT fail FROM test_asset_control WHERE id = 1').first<number>('fail');
    const assets = failAsset ? new Proxy(env.ASSETS, { get(target, key) {
      if (key === 'put') return async () => { throw new Error('測試 R2 寫入故障'); };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } }) : env.ASSETS;
    return handle(request, { ...env, ASSETS: assets, OWNER_EMAIL: 'owner@example.test', BETTER_AUTH_URL: 'http://127.0.0.1:5173', BETTER_AUTH_SECRET: 'test-only-secret-with-at-least-32-characters' }, {
      now: () => control?.now ?? Date.now(),
      sendMail: async (email, url) => {
        if (control?.fail) throw new Error('測試寄信故障');
        await env.DB.prepare('INSERT INTO test_mailbox VALUES (?, ?)').bind(email, url).run();
      },
    });
  },
} satisfies ExportedHandler<Env>;
