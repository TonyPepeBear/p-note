import { env, exports } from 'cloudflare:workers';
import { reset } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { authenticated, origin } from './helpers';
import { initialView, readConfig, type DatabaseConfig, type DatabaseData } from '../../src/shared/databases';
import type { PageRow } from '../../src/shared/pages';
import { handleDatabases } from '../../src/worker/databases';

let client: Awaited<ReturnType<typeof authenticated>>;
const get = (id: string, etag?: string) => exports.default.fetch(`${origin}/api/databases/${id}`, {
  headers: { Cookie: client.cookie, ...(etag ? { 'If-None-Match': etag } : {}) },
});
async function page(response: Promise<Response>) {
  const result = await response;
  expect(result.status, await result.clone().text()).toBe(200);
  return result.json<PageRow>();
}
const create = (parent_id: string | null = null) => page(client.post('/api/databases', { title: '測試資料庫', parent_id }));
const row = (parent_id: string) => page(client.post('/api/pages', { title: '測試資料列', parent_id }));
const save = (database: PageRow, previous: string, config: DatabaseConfig) => client.post(`/api/databases/${database.id}/config`, {
  generation: database.sync_generation, previous, config,
});
async function data(id: string, previous?: string) {
  const response = await get(id, previous);
  expect(response.status, await response.clone().text()).toBe(200);
  const etag = response.headers.get('ETag');
  expect(etag).toBeTruthy();
  if (previous) expect(etag).not.toBe(previous);
  return { ...(await response.json<DatabaseData>()), etag: etag! };
}

beforeEach(async () => { client = await authenticated(); });
afterEach(async () => { vi.restoreAllMocks(); await reset(); });

it('DB-11：資料庫條件讀取：未變更回傳空的 304，弱標籤與標籤清單也可驗證', async () => {
  const database = await create();
  const first = await data(database.id);
  for (const validator of [first.etag, `"other", W/${first.etag}`, '*']) {
    const response = await get(database.id, validator);
    expect(response.status).toBe(304);
    expect(response.headers.get('ETag')).toBe(first.etag);
    expect(response.headers.get('Cache-Control')).toContain('private');
    expect(await response.text()).toBe('');
  }
});

it('DB-11：資料庫條件讀取：直系列新增、標題、屬性、正文時間、移動、刪還原與世代均失效', async () => {
  const database = await create();
  let current = await data(database.id);
  const record = await row(database.id);
  current = await data(database.id, current.etag);
  expect(current.rows.map(item => item.id)).toEqual([record.id]);
  const owner = record.owner_id;
  for (const [sql, value] of [
    ['UPDATE pages SET title = ? WHERE id = ?', '新的標題'],
    ['UPDATE pages SET property_values = ? WHERE id = ?', '{"text":"內容"}'],
    ['UPDATE pages SET updated_at = ? WHERE id = ?', record.updated_at + 1000],
    ['UPDATE pages SET sync_generation = ? WHERE id = ?', 'new-row-generation'],
  ] as const) {
    await env.DB.prepare(sql).bind(value, record.id).run();
    current = await data(database.id, current.etag);
  }
  await env.DB.prepare('UPDATE pages SET updated_at = updated_at WHERE id = ?').bind(record.id).run();
  expect((await get(database.id, current.etag)).status).toBe(304);
  await client.post(`/api/pages/${record.id}/move`, { parent_id: null });
  current = await data(database.id, current.etag);
  expect(current.rows).toEqual([]);
  await client.post(`/api/pages/${record.id}/move`, { parent_id: database.id });
  current = await data(database.id, current.etag);
  await client.post(`/api/pages/${record.id}/delete`, {});
  current = await data(database.id, current.etag);
  expect(current.rows).toEqual([]);
  await client.post(`/api/pages/${record.id}/restore`, {});
  current = await data(database.id, current.etag);
  expect(current.rows).toHaveLength(1);
  await env.DB.prepare('UPDATE pages SET sync_generation = ?, metadata_revision = 0 WHERE id = ? AND owner_id = ?')
    .bind('new-database-generation', database.id, owner).run();
  current = await data(database.id, current.etag);
  expect(current.page.sync_generation).toBe('new-database-generation');
  await env.DB.prepare('DELETE FROM pages WHERE id = ?').bind(record.id).run();
  expect((await data(database.id, current.etag)).rows).toEqual([]);
});

it('DB-11：資料庫條件讀取：先驗證祖先可見性，操作中隱藏子列也會失效', async () => {
  const parent = await page(client.post('/api/pages', { title: '上層' }));
  const database = await create(parent.id);
  const record = await row(database.id);
  let current = await data(database.id);
  await env.DB.prepare("INSERT INTO page_operations VALUES ('test-operation', ?, ?, 'delete', ?)")
    .bind(record.owner_id, record.id, record.updated_at).run();
  await env.DB.prepare("INSERT INTO page_operation_members VALUES ('test-operation', ?, ?, ?)")
    .bind(record.id, record.owner_id, record.sync_generation).run();
  current = await data(database.id, current.etag);
  expect(current.rows).toEqual([]);
  await env.DB.prepare("DELETE FROM page_operations WHERE id = 'test-operation'").run();
  current = await data(database.id, current.etag);
  expect(current.rows).toHaveLength(1);
  await client.post(`/api/pages/${parent.id}/delete`, {});
  expect((await get(database.id, current.etag)).status).toBe(404);
  await client.post(`/api/pages/${parent.id}/restore`, {});
  expect((await get(database.id)).status).toBe(200);
  await env.DB.prepare('UPDATE pages SET parent_id = ? WHERE id = ?').bind(database.id, parent.id).run();
  expect((await get(database.id, current.etag)).status).toBe(404);
});

it('DB-12：資料庫設定：不同檢視可併發合併，同檢視的競爭仍回傳 409', async () => {
  const database = await create();
  const config: DatabaseConfig = { properties: [], views: [initialView('a', '甲'), initialView('b', '乙')] };
  const prepared = await page(save(database, database.database_config!, config));
  const previous = prepared.database_config!;
  const a = structuredClone(config), b = structuredClone(config);
  a.views[0].name = '甲修改'; b.views[1].name = '乙修改';
  expect((await Promise.all([save(database, previous, a), save(database, previous, b)])).map(response => response.status)).toEqual([200, 200]);
  const merged = await data(database.id);
  expect(merged.config.views.map(view => view.name)).toEqual(['甲修改', '乙修改']);
  const sameA = structuredClone(merged.config), sameB = structuredClone(merged.config);
  sameA.views[0].name = '再次修改甲'; sameB.views[0].name = '另一裝置修改甲';
  expect((await Promise.all([
    save(database, merged.page.database_config!, sameA), save(database, merged.page.database_config!, sameB),
  ])).map(response => response.status).sort()).toEqual([200, 409]);
});

it('DB-12：資料庫設定：保留檢視排序，合併不能重新引用已刪除欄位', async () => {
  const database = await create();
  const config: DatabaseConfig = {
    properties: [{ id: 'text', name: '摘要', type: 'text', options: [] }],
    views: [initialView('a', '甲'), initialView('b', '乙')],
  };
  const prepared = await page(save(database, database.database_config!, config));
  const addition = structuredClone(config), removal = structuredClone(config);
  addition.views.push({ ...initialView('c', '丙'), columns: ['title', 'text'] });
  removal.properties = [];
  expect((await Promise.all([
    save(database, prepared.database_config!, addition), save(database, prepared.database_config!, removal),
  ])).map(response => response.status).sort()).toEqual([200, 409]);
  const current = await data(database.id);
  const reordered = structuredClone(current.config);
  reordered.views.reverse();
  const saved = await page(save(database, current.page.database_config!, reordered));
  expect(readConfig(saved.database_config!).views.map(view => view.id)).toEqual(reordered.views.map(view => view.id));
});

it('DB-12：資料庫設定：純檢視儲存不受子列修改阻擋，已刪除列仍保護欄位相容性', async () => {
  const database = await create();
  const record = await row(database.id);
  const config: DatabaseConfig = {
    properties: [{ id: 'text', name: '摘要', type: 'text', options: [] }],
    views: [initialView('a')],
  };
  const prepared = await page(save(database, database.database_config!, config));
  await client.post(`/api/pages/${record.id}/properties`, { property: 'text', value: '已保存', generation: record.sync_generation });
  const renamed = readConfig(prepared.database_config!);
  renamed.views[0].name = '更改檢視';
  const changed = await page(save(database, prepared.database_config!, renamed));
  await client.post(`/api/pages/${record.id}/delete`, {});
  renamed.properties[0].type = 'number';
  expect((await save(database, changed.database_config!, renamed)).status).toBe(409);
});

it('DB-11：資料庫輪詢：304 只查祖先與版本，純檢視更新也不讀取全部子列', async () => {
  const database = await create();
  await row(database.id);
  const current = await data(database.id);
  const prepare = env.DB.prepare.bind(env.DB);
  const queries: string[] = [];
  vi.spyOn(env.DB, 'prepare').mockImplementation(sql => { queries.push(sql); return prepare(sql); });
  const response = await handleDatabases(new Request(`${origin}/api/databases/${database.id}`, {
    headers: { 'If-None-Match': current.etag },
  }), env, database.owner_id, client.now);
  expect(response!.status).toBe(304);
  expect(queries).toHaveLength(1);
  expect(queries[0]).toContain('ancestors');
  expect(queries[0]).not.toContain('FROM pages child');
  queries.splice(0);
  const requested = structuredClone(current.config);
  requested.views[0].name = '純檢視變更';
  const saved = await handleDatabases(new Request(`${origin}/api/databases/${database.id}/config`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ generation: database.sync_generation, previous: database.database_config, config: requested }),
  }), env, database.owner_id, client.now);
  expect(saved!.status).toBe(200);
  expect(queries.some(sql => sql.includes('SELECT id, property_values FROM pages'))).toBe(false);
  expect(queries.some(sql => sql.includes('json_each(?) expected'))).toBe(false);
});

it('DB-12：資料庫設定：欄位驗證與原子寫入之間出現新值時拒絕不相容變更', async () => {
  const database = await create();
  const record = await row(database.id);
  const config: DatabaseConfig = { properties: [{ id: 'text', name: '摘要', type: 'text', options: [] }], views: [initialView('a')] };
  const prepared = await page(save(database, database.database_config!, config));
  const prepare = env.DB.prepare.bind(env.DB);
  let injected = false;
  vi.spyOn(env.DB, 'prepare').mockImplementation(sql => {
    const statement = prepare(sql);
    if (!sql.includes('UPDATE pages SET database_config')) return statement;
    return new Proxy(statement, { get(target, property) {
      if (property === 'bind') return (...values: unknown[]) => {
        const bound = Reflect.apply(target.bind, target, values);
        return new Proxy(bound, { get(value, key) {
          if (key === 'run') return async () => {
            if (!injected) {
              injected = true;
              await prepare('UPDATE pages SET property_values = ? WHERE id = ?').bind('{"text":"競爭寫入"}', record.id).run();
            }
            return value.run();
          };
          const method = Reflect.get(value, key, value);
          return typeof method === 'function' ? method.bind(value) : method;
        } });
      };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  });
  const requested = structuredClone(config);
  requested.properties[0].type = 'number';
  await expect(handleDatabases(new Request(`${origin}/api/databases/${database.id}/config`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ generation: database.sync_generation, previous: prepared.database_config, config: requested }),
  }), env, database.owner_id, client.now)).rejects.toMatchObject({ status: 409 });
  expect(injected).toBe(true);
  const saved = await prepare('SELECT database_config FROM pages WHERE id = ?').bind(database.id).first<string>('database_config');
  expect(readConfig(saved!).properties[0].type).toBe('text');
});

it('DB-11：資料庫條件讀取：版本檢查後發生變更，200 本文與 ETag 使用同一快照', async () => {
  const database = await create();
  const record = await row(database.id);
  const current = await data(database.id);
  const batch = env.DB.batch.bind(env.DB);
  let injected = false;
  vi.spyOn(env.DB, 'batch').mockImplementation(async statements => {
    if (!injected) {
      injected = true;
      await env.DB.prepare('UPDATE pages SET title = ? WHERE id = ?').bind('檢查後的標題', record.id).run();
    }
    return batch(statements);
  });
  const response = await handleDatabases(new Request(`${origin}/api/databases/${database.id}`, {
    headers: { 'If-None-Match': '"stale"' },
  }), env, database.owner_id, client.now);
  expect(response!.status).toBe(200);
  expect(response!.headers.get('ETag')).not.toBe(current.etag);
  expect((await response!.json<DatabaseData>()).rows[0].title).toBe('檢查後的標題');
  expect((await get(database.id, response!.headers.get('ETag')!)).status).toBe(304);
});

it('DB-16：複製保留持久正文、圖示與屬性，拒絕越權、舊世代及垃圾桶', async () => {
  const database = await create(); const record = await row(database.id);
  const config = readConfig(database.database_config!);
  config.properties.push({ id: 'score', name: '分數', type: 'number', options: [] });
  await page(save(database, database.database_config!, config));
  await page(client.post(`/api/pages/${record.id}/properties`, { property: 'score', value: 42, generation: record.sync_generation }));
  await page(client.post(`/api/pages/${record.id}/icon`, { icon: '📚' }));
  const { connect, commit, persisted } = await import('./helpers');
  const { roomName } = await import('../../src/shared/room');
  const Y = await import('yjs');
  const info = await client.result(client.get(`/api/pages/${record.id}`));
  const connection = await connect(info, client.cookie); const doc = new Y.Doc();
  doc.getXmlFragment('body').insert(0, [new Y.XmlText('複製的持久正文')]);
  expect((await commit(connection, doc, crypto.randomUUID())).type).toBe('persisted');
  const copy = await page(client.post(`/api/pages/${record.id}/duplicate`, { generation: record.sync_generation }));
  expect(copy.parent_id).toBe(database.id); expect(copy.icon).toBe('📚');
  expect(JSON.parse(copy.property_values!)).toEqual({ score: 42 }); expect(copy.sync_generation).not.toBe(record.sync_generation);
  const copied = await persisted({ stub: env.SYNC.getByName(await roomName(copy.owner_id, copy.id, copy.sync_generation)) });
  expect(copied.getXmlFragment('body').toString()).toContain('複製的持久正文');
  expect((await client.post(`/api/pages/${record.id}/duplicate`, { generation: 'old' })).status).toBe(409);
  expect((await exports.default.fetch(`${origin}/api/pages/${record.id}/duplicate`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ generation: record.sync_generation }) })).status).toBe(401);
  await page(client.post(`/api/pages/${record.id}/delete`, {}));
  expect((await client.post(`/api/pages/${record.id}/duplicate`, { generation: record.sync_generation })).status).toBe(404);
  connection.socket.close(); doc.destroy(); copied.destroy();
});
