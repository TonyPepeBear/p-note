import { createBackup, checksum } from '../src/worker/backups';
import { handle, ProbeRoom, SyncRoom as AppSyncRoom, RestoreCoordinator as AppRestoreCoordinator } from '../src/worker/app';
import probe from '../src/worker/index';
import keysMigration from '../migrations/0005_api_keys.sql';
import mcpMigration from '../migrations/0008_mcp_grants.sql';
import databaseMigration from '../migrations/0006_note_databases.sql';
import linksMigration from '../migrations/0007_note_links.sql';
import migration from '../migrations/0001.sql';
import pagesMigration from '../migrations/0002.sql';
import backupsMigration from '../migrations/0003.sql';
import restoreMigration from '../migrations/0004.sql';
import { roomName } from '../src/shared/room';
import * as Y from 'yjs';
import { toBase64 } from 'lib0/buffer';

export { ProbeRoom };
export class RestoreCoordinator extends AppRestoreCoordinator {
  protected async now(): Promise<number> {
    return await this.env.DB.prepare('SELECT now FROM test_control WHERE id = 1').first<number>('now') ?? Date.now();
  }
}
export class SyncRoom extends AppSyncRoom {
  protected async now(): Promise<number> {
    return await this.env.DB.prepare('SELECT now FROM test_control WHERE id = 1').first<number>('now') ?? Date.now();
  }
  async onRequest(request?: Request): Promise<Response> {
    if (request && new URL(request.url).pathname === '/__test/storage-failure' && request.method === 'POST') {
      await this.setName(this.ctx.id.name!);
      const { fail } = await request.json<{ fail: boolean }>();
      if (typeof fail !== 'boolean') return new Response('無效故障設定', { status: 400 });
      this.ctx.storage.sql.exec('DROP TRIGGER IF EXISTS __test_fail_update');
      if (fail) this.ctx.storage.sql.exec("CREATE TRIGGER __test_fail_update BEFORE INSERT ON updates BEGIN SELECT RAISE(ABORT, '測試 SQLite 寫入失敗'); END");
      const doc = await this.onLoad();
      try { return Response.json({ state: toBase64(Y.encodeStateAsUpdate(doc)) }); } finally { doc.destroy(); }
    }
    if (request && new URL(request.url).pathname === '/__test/clear-storage') {
      for (const connection of this.getConnections()) connection.close(1012, '測試清空產品儲存');
      await this.ctx.storage.deleteAll(); await this.ctx.storage.sync();
      this.ctx.abort('測試清空產品儲存');
    }
    if (request && new URL(request.url).pathname === '/__test/drop-connections') {
      for (const connection of this.getConnections()) connection.close(1012, '測試服務重啟');
      return Response.json({ ok: true });
    }
    return super.onRequest();
  }
}

async function setup(env: Env) {
  for (const sql of (migration + pagesMigration + backupsMigration + restoreMigration + keysMigration + mcpMigration).split(';').map(sql => sql.trim()).filter(sql => sql && !/^--[^\n]*$/.test(sql))) {
    await env.DB.prepare(sql).run();
  }
  await env.DB.exec('CREATE TABLE IF NOT EXISTS test_control (id INTEGER PRIMARY KEY, now INTEGER, fail INTEGER); CREATE TABLE IF NOT EXISTS test_mailbox (email TEXT, url TEXT)');
  if (!await env.DB.prepare("SELECT 1 FROM pragma_table_info('pages') WHERE name = 'database_config'").first()) {
    for (const sql of databaseMigration.split(';').map(s => s.trim()).filter(Boolean)) await env.DB.prepare(sql).run();
  }
  await env.DB.exec('CREATE TABLE IF NOT EXISTS test_asset_control (id INTEGER PRIMARY KEY, fail INTEGER)');
  if (!await env.DB.prepare("SELECT 1 FROM pragma_table_info('page_search') WHERE name = 'linked_pages'").first()) {
    await env.DB.prepare(linksMigration.trim().replace(/;$/, '')).run();
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (!['127.0.0.1', 'localhost'].includes(new URL(request.url).hostname)) return new Response('僅本機測試', { status: 403 });
    await setup(env);
    const path = new URL(request.url).pathname;
    if (path.startsWith('/__test/')) {
      if (path === '/__test/storage-failure' && request.method === 'POST') {
        const { room, fail } = await request.json<{ room: string; fail: boolean }>();
        if (!/^[a-f0-9]{64}$/.test(room) || typeof fail !== 'boolean') return new Response('無效測試故障', { status: 400 });
        return env.SYNC.getByName(room).fetch('http://127.0.0.1/__test/storage-failure', { method: 'POST', body: JSON.stringify({ fail }) });
      }
      if (path === '/__test/clear-product' && request.method === 'POST') {
        const pages = (await env.DB.prepare('SELECT id, owner_id, sync_generation FROM pages').all<{ id: string; owner_id: string; sync_generation: string }>()).results;
        await env.DB.batch(['page_search', 'pages', 'assets'].map(table => env.DB.prepare(`DELETE FROM ${table}`)));
        for (const page of pages) {
          const room = await roomName(page.owner_id, page.id, page.sync_generation);
          await env.SYNC.getByName(room).fetch('http://127.0.0.1/__test/clear-storage').catch(() => {});
        }
        for (;;) {
          const objects = await env.ASSETS.list({ limit: 1000 });
          if (!objects.objects.length) break;
          await env.ASSETS.delete(objects.objects.map(object => object.key));
        }
        return Response.json({ ok: true });
      }
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
      if (path === '/__test/change-owner' && request.method === 'POST') {
        await env.DB.prepare('UPDATE user SET email = ?').bind('other@example.test').run();
        return Response.json({ ok: true });
      }
      if (path === '/__test/database-backup' && request.method === 'POST') {
        const input = await request.json<{ legacy?: boolean; invalid?: boolean }>();
        const owner = (await env.DB.prepare('SELECT id FROM user LIMIT 1').first<{ id: string }>())!.id;
        if (input.invalid) {
          const page = (await env.DB.prepare("SELECT id, database_config FROM pages WHERE kind = 'note' LIMIT 1").first<{ id: string; database_config: string | null }>())!;
          await env.DB.prepare("UPDATE pages SET database_config = '{}' WHERE id = ?").bind(page.id).run();
          try { await createBackup(env, owner, Date.now); return Response.json({ unexpected: true }); } catch { return Response.json({ rejected: true }, { status: 503 }); }
          finally { await env.DB.prepare('UPDATE pages SET database_config = ? WHERE id = ?').bind(page.database_config, page.id).run(); }
        }
        const backup = await createBackup(env, owner, Date.now);
        if (input.legacy) {
          const key = owner + '/' + backup.id + '/manifest.json'; const object = (await env.BACKUPS.get(key))!;
          const manifest = await object.json<{ pages: { metadata: Record<string, unknown> }[] }>();
          for (const page of manifest.pages) { delete page.metadata.database_config; delete page.metadata.property_values; }
          const bytes = new TextEncoder().encode(JSON.stringify(manifest)); await env.BACKUPS.put(key, bytes);
          await env.DB.prepare('UPDATE backups SET manifest_checksum = ?, manifest_size = ? WHERE id = ?').bind(await checksum(bytes), bytes.length, backup.id).run();
        }
        return Response.json(backup);
      }
      if (path === '/__test/reset' && request.method === 'POST') {
        let cursor: string | undefined;
        do {
          const batch = await env.OAUTH_KV.list({ cursor });
          await Promise.all(batch.keys.map(key => env.OAUTH_KV.delete(key.name)));
          cursor = batch.list_complete ? undefined : batch.cursor;
        } while (cursor);
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
    return handle(request, { ...env, ASSETS: assets, OWNER_EMAIL: 'owner@example.test', BETTER_AUTH_URL: env.BETTER_AUTH_URL, BETTER_AUTH_SECRET: 'test-only-secret-with-at-least-32-characters' }, {
      now: () => control?.now ?? Date.now(),
      sendMail: async (email, url) => {
        if (control?.fail) throw new Error('測試寄信故障');
        await env.DB.prepare('INSERT INTO test_mailbox VALUES (?, ?)').bind(email, url).run();
      },
    }, ctx);
  },
} satisfies ExportedHandler<Env>;
