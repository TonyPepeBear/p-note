import { env } from 'cloudflare:workers';
import { reset } from 'cloudflare:test';
import { afterEach, expect, it } from 'vitest';
import * as Y from 'yjs';
import { authenticated } from './helpers';
import { currentHistoryPage, saveVersion } from '../../src/worker/history';
import { queueCleanup, cleanupStorage, prepareRoom } from '../../src/worker/storage-cleanup';
import { roomName } from '../../src/shared/room';
import { images } from '../fixtures/images';
import { checksum, createBackup } from '../../src/worker/backups';

afterEach(async () => { await reset(); });
it('HIST-01：其他頁面刪除進行中仍能建立首個版本', async () => {
  const auth = await authenticated(); const a = await auth.note('刪除中'); const b = await auth.note('仍可編輯');
  await env.DB.batch([
    env.DB.prepare("INSERT INTO page_operations VALUES ('operation', ?, ?, 'delete', ?)").bind(a.owner_id, a.id, auth.now),
    env.DB.prepare("INSERT INTO page_operation_members VALUES ('operation', ?, ?, ?)").bind(a.id, a.owner_id, a.sync_generation),
  ]);
  const page = await currentHistoryPage(env, { owner: b.owner_id, page: b.id, generation: b.sync_generation });
  const doc = new Y.Doc();
  try { expect((await saveVersion(env, page, Y.encodeStateAsUpdate(doc), 0, 'auto', auth.now)).page_id).toBe(b.id); }
  finally { doc.destroy(); }
  await expect(currentHistoryPage(env, { owner: a.owner_id, page: a.id, generation: a.sync_generation })).rejects.toThrow();
});
it('HIST-06：D1 寫入失敗後未引用版本可回收，已引用版本保留', async () => {
  const auth = await authenticated(); const page = await auth.note('版本清理'); const doc = new Y.Doc();
  try {
    const data = Y.encodeStateAsUpdate(doc);
    await saveVersion(env, page, data, 0, 'manual', auth.now);
    await env.DB.exec("CREATE TRIGGER fail_version BEFORE INSERT ON page_versions BEGIN SELECT RAISE(ABORT, '測試版本寫入失敗'); END");
    doc.getText('test').insert(0, '更新');
    await expect(saveVersion(env, page, Y.encodeStateAsUpdate(doc), 1, 'manual', auth.now)).rejects.toThrow();
    expect((await env.BACKUPS.list({ prefix: 'versions/' })).objects).toHaveLength(2);
    await cleanupStorage(env, Date.now() + 3600001);
    expect((await env.BACKUPS.list({ prefix: 'versions/' })).objects).toHaveLength(1);
  } finally { doc.destroy(); }
});
it('BACKUP-06：還原後回收舊資產與孤兒歷史，保留新資產和有效文件', async () => {
  const auth = await authenticated(); const page = await auth.note('還原');
  const oldKey = page.owner_id + '/asset';
  await env.ASSETS.put(oldKey, images.png);
  await env.DB.prepare("INSERT INTO assets VALUES ('asset', ?, ?, 'test.png', 'image/png', ?, ?, ?)").bind(page.owner_id, oldKey, images.png.length, await checksum(images.png), auth.now).run();
  const doc = new Y.Doc();
  try { await saveVersion(env, page, Y.encodeStateAsUpdate(doc), 0, 'manual', auth.now); } finally { doc.destroy(); }
  const backup = await createBackup(env, page.owner_id, () => auth.now);
  const orphan = await auth.note('備份後新增');
  const orphanDoc = new Y.Doc();
  try { await saveVersion(env, orphan, Y.encodeStateAsUpdate(orphanDoc), 0, 'manual', auth.now); } finally { orphanDoc.destroy(); }
  const response = await auth.post(`/api/backups/${backup.id}/restore`, { request_id: 'restore-cleanup' });
  expect(response.status).toBe(200);
  await cleanupStorage(env, Date.now() + 3600001);
  expect(await env.ASSETS.get(oldKey)).toBeNull();
  const restored = await env.DB.prepare("SELECT object_key FROM assets WHERE id = 'asset'").first<string>('object_key');
  expect(restored).toBeTruthy(); expect(await env.ASSETS.get(restored!)).not.toBeNull();
  expect((await env.BACKUPS.list({ prefix: 'versions/' })).objects).toHaveLength(1);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM page_versions').first('n')).toBe(1);
});
it('SYNC-06：未發布候選房間可回收，已發布房間不可清空', async () => {
  const auth = await authenticated(); const page = await auth.note('活躍');
  const scope = { owner: page.owner_id, page: 'unpublished', generation: 'generation' };
  const doc = new Y.Doc(); doc.getText('text').insert(0, '候選');
  try { await prepareRoom(env, scope, Y.encodeStateAsUpdate(doc), 0); } finally { doc.destroy(); }
  await queueCleanup(env, page.owner_id, 'room', JSON.stringify({ owner: page.owner_id, page: page.id, generation: page.sync_generation }));
  await cleanupStorage(env, Date.now() + 3600001);
  const room = env.SYNC.getByName(await roomName(scope.owner, scope.page, scope.generation));
  const { runInDurableObject } = await import('cloudflare:test');
  expect(await runInDurableObject(room, async (_instance, state) => (await state.storage.list()).size)).toBe(0);
  expect((await auth.get('/api/pages/' + page.id)).status).toBe(200);
});

it('BACKUP-08：超過 2 MiB metadata 分段還原，保留已完成單頁還原的冪等紀錄', async () => {
  const auth = await authenticated();
  const container = await auth.result(auth.post('/api/databases', { title: '大型備份' }));
  const { initialView } = await import('../../src/shared/databases');
  const properties = Array.from({ length: 50 }, (_, i) => ({ id: 'p' + i, name: '欄位' + i, type: 'text', options: [] }));
  const config = { properties, views: [initialView('view')] };
  expect((await auth.post('/api/databases/' + container.id + '/config', { config, previous: container.database_config, generation: container.sync_generation })).status).toBe(200);
  const values = JSON.stringify(Object.fromEntries(properties.map(p => [p.id, 'x'.repeat(2000)])));
  for (let i = 0; i < 24; i++) {
    const note = await auth.result(auth.post('/api/pages', { title: '大量資料' + i, parent_id: container.id }));
    await env.DB.prepare('UPDATE pages SET property_values = ? WHERE id = ?').bind(values, note.id).run();
  }
  expect(values.length * 24).toBeGreaterThan(2 * 1024 * 1024);
  await env.DB.prepare("INSERT INTO completed_page_history_restores VALUES ('completed', ?, ?, 'version', 'before-version', ?)").bind(container.owner_id, container.id, auth.now).run();
  const backup = await createBackup(env, container.owner_id, () => auth.now);
  const response = await auth.post(`/api/backups/${backup.id}/restore`, { request_id: 'large-restore' });
  expect(response.status).toBe(200);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM pages WHERE parent_id = ? AND property_values = ?').bind(container.id, values).first('n')).toBe(24);
  expect(await env.DB.prepare("SELECT count(*) AS n FROM completed_page_history_restores WHERE request_id = 'completed'").first('n')).toBe(1);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM restore_staging').first('n')).toBe(0);
}, 60000);

it('BACKUP-08：大量已引用候選不佔用孤兒清理配額', async () => {
  const auth = await authenticated(); const page = await auth.note('清理配額');
  await env.DB.prepare(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM seq WHERE n < 1001)
    INSERT INTO page_versions (id, owner_id, page_id, generation, title, created_at, reason, checkpoint, checksum, byte_size, object_key)
    SELECT 'kept-' || n, ?, ?, 'generation', '保留版本', 0, 'manual', 0, ?, 1, 'kept-' || n FROM seq`)
    .bind(page.owner_id, page.id, '0'.repeat(64)).run();
  await env.DB.prepare("INSERT INTO storage_cleanup SELECT owner_id, 'version', object_key, 0 FROM page_versions").run();
  await env.BACKUPS.put('orphan', '孤兒');
  await queueCleanup(env, page.owner_id, 'version', 'orphan', -3600000);
  await cleanupStorage(env, Date.now());
  expect(await env.BACKUPS.get('orphan')).toBeNull();
  expect(await env.DB.prepare('SELECT count(*) AS n FROM storage_cleanup').first('n')).toBe(0);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM page_versions').first('n')).toBe(1001);
});
