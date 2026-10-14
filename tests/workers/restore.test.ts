import { env, exports } from 'cloudflare:workers';
import { abortAllDurableObjects, reset, runInDurableObject } from 'cloudflare:test';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { toBase64 } from 'lib0/buffer';
import { fixture, create, manifest, request, hash } from './backup-helpers';
import { authenticated, commit, connect, origin, persisted } from './helpers';
import type { PageInfo, PageRow } from '../../src/shared/pages';
import { images } from '../fixtures/images';
import { cleanupBackups } from '../../src/worker/backups';

const sockets: WebSocket[] = [];
beforeEach(async () => { await exports.default.fetch(origin + '/health'); await exports.default.fetch(origin + '/__test/reset', { method: 'POST' }); });
afterEach(async () => { vi.restoreAllMocks(); sockets.splice(0).forEach(socket => socket.close()); await reset(); });

async function restored(f: Awaited<ReturnType<typeof fixture>>) {
  const rows = (await env.DB.prepare('SELECT * FROM pages WHERE owner_id = ? ORDER BY id').bind(f.root.owner_id).all<PageRow>()).results;
  expect(rows.map(({ sync_generation: _generation, ...row }) => row)).toEqual(f.metadata.map(({ sync_generation: _generation, ...row }) => row));
  expect(rows.every(row => row.sync_generation !== f.metadata.find(old => old.id === row.id)!.sync_generation)).toBe(true);
  for (const page of rows) {
    const room = await import('../../src/shared/room').then(module => module.roomName(page.owner_id, page.id, page.sync_generation));
    const snapshot = await env.SYNC.getByName(room).capture({ owner: page.owner_id, page: page.id, generation: page.sync_generation });
    expect(snapshot.data).toEqual(f.documents.get(page.id));
  }
  const original = await f.auth.get(f.asset.url); expect(original.status).toBe(200); expect(new Uint8Array(await original.arrayBuffer())).toEqual(images.png);
  expect((await env.DB.prepare('SELECT indexed_generation FROM page_search WHERE page_id = ?').bind(f.root.id).first('indexed_generation'))).toBe(rows.find(row => row.id === f.root.id)!.sync_generation);
  expect((await f.auth.get('/api/search?q=' + encodeURIComponent('雲端正文'))).status).toBe(200);
}

it('BACKUP-01：保留中備份完整恢復階層／日記／垃圾桶／正文／圖片，覆蓋前現況可恢復', async () => {
  const f = await fixture(sockets); const backup = await create(f.auth);
  await f.auth.post(`/api/pages/${f.root.id}/title`, { title: '還原前標題' });
  const response = await request(f.auth, `/api/backups/${backup.id}/restore`, env, 'POST'); expect(response.status).toBe(200);
  const result = await response.json<{ rollback: string }>(); expect(result.rollback).not.toBe(backup.id);
  expect((await manifest(f.auth, result.rollback)).pages.find(page => page.metadata.id === f.root.id)!.metadata.title).toBe('還原前標題');
  await abortAllDurableObjects(); await restored(f);
}, 30000);

it('RESTORE-IDEMPOTENT-01：同請求確認遺失後重送不再換世代，也不覆蓋其後已保存的修改', async () => {
  const f = await fixture(sockets); const backup = await create(f.auth); const id = crypto.randomUUID();
  const first = await f.auth.post(`/api/backups/${backup.id}/restore`, { request_id: id }); expect(first.status).toBe(200);
  const page = await (await f.auth.get(`/api/pages/${f.root.id}`)).json<PageInfo>();
  const client = await connect(page, f.auth.cookie); sockets.push(client.socket);
  const doc = await persisted(client); const newer = new Y.XmlText(); newer.insert(0, '還原之後的新修改'); doc.getXmlFragment('body').insert(0, [newer]);
  expect((await commit(client, doc, 'after-restore')).type).toBe('persisted'); doc.destroy();
  await abortAllDurableObjects();
  const repeated = await f.auth.post(`/api/backups/${backup.id}/restore`, { request_id: id }); expect(repeated.status).toBe(200);
  expect((await (await f.auth.get(`/api/pages/${f.root.id}`)).json<PageInfo>()).sync_generation).toBe(page.sync_generation);
  expect((await persisted(client)).getXmlFragment('body').toString()).toContain('還原之後的新修改');
}, 30000);

it('RESTORE-ATOMIC-01：D1 batch 中途插入失敗回滾全部 metadata，不留下部分新世代', async () => {
  const f = await fixture(sockets); const backup = await create(f.auth);
  await f.auth.post(`/api/pages/${f.root.id}/title`, { title: '中斷前現況' });
  await env.DB.prepare(`CREATE TRIGGER restore_insert_failure BEFORE INSERT ON pages WHEN NEW.id = '${f.child.id}'
    AND EXISTS (SELECT 1 FROM restore_operations WHERE phase = 'preparing') BEGIN SELECT RAISE(ABORT, '測試原子切換中斷'); END`).run();
  expect((await request(f.auth, `/api/backups/${backup.id}/restore`, env, 'POST')).status).toBe(503);
  expect(await env.DB.prepare('SELECT title FROM pages WHERE id = ?').bind(f.root.id).first('title')).toBe('中斷前現況');
  const rows = (await env.DB.prepare('SELECT id, sync_generation FROM pages').all<{ id: string; sync_generation: string }>()).results;
  expect(rows.every(row => f.metadata.find(old => old.id === row.id)!.sync_generation === row.sync_generation)).toBe(true);
  expect((await f.auth.get('/api/pages')).status).toBe(503);
  await env.DB.exec('DROP TRIGGER restore_insert_failure'); await abortAllDurableObjects();
  expect((await request(f.auth, `/api/backups/${backup.id}/restore`, env, 'POST')).status).toBe(200); await restored(f);
}, 30000);

it('RESTORE-EXPIRED-ACK-01：已完成請求的回應遺失，目標備份到期後仍能取得先前結果', async () => {
  const f = await fixture(sockets); const backup = await create(f.auth); const started = f.auth.now; const id = crypto.randomUUID();
  f.auth = await authenticated(started + 89 * 86400000);
  const first = await f.auth.post(`/api/backups/${backup.id}/restore`, { request_id: id }); expect(first.status).toBe(200);
  const result = await first.json(); const current = await (await f.auth.get(`/api/pages/${f.journal.id}`)).json<PageInfo>();
  await f.auth.post('/__test/control', { now: started + 91 * 86400000 }); await cleanupBackups(env, started + 91 * 86400000);
  expect(await env.DB.prepare('SELECT id FROM backups WHERE id = ?').bind(backup.id).first()).toBeNull();
  await abortAllDurableObjects();
  const replay = await f.auth.post(`/api/backups/${backup.id}/restore`, { request_id: id }); expect(replay.status).toBe(200); expect(await replay.json()).toEqual(result);
  expect((await (await f.auth.get(`/api/pages/${f.journal.id}`)).json<PageInfo>()).sync_generation).toBe(current.sync_generation);
}, 30000);

it('RESTORE-PIN-01：到期清理在選取之後才出現還原引用，也不能刪除正在使用的備份', async () => {
  const f = await fixture(sockets); const backup = await create(f.auth);
  const prepare = env.DB.prepare.bind(env.DB); let inserted = false;
  vi.spyOn(env.DB, 'prepare').mockImplementation(sql => {
    const statement = prepare(sql);
    if (!sql.startsWith("UPDATE backups SET status = 'expiring'")) return statement;
    return new Proxy(statement, { get(target, property) {
      if (property === 'bind') return (...values: unknown[]) => {
        const bound = Reflect.apply(target.bind, target, values);
        return new Proxy(bound, { get(value, key) {
          if (key === 'run') return async () => {
            inserted = true;
            await prepare("INSERT INTO restore_operations (id, owner_id, backup_id, phase, started_at) VALUES ('pin-race', ?, ?, 'paused', ?)").bind(f.root.owner_id, backup.id, f.auth.now).run();
            return value.run();
          };
          const method = Reflect.get(value, key, value); return typeof method === 'function' ? method.bind(value) : method;
        } });
      };
      const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
  });
  await cleanupBackups(env, f.auth.now + 90 * 86400000).catch(() => {});
  expect(inserted).toBe(true);
  expect(await env.DB.prepare('SELECT status FROM backups WHERE id = ?').bind(backup.id).first('status')).toBe('success');
  expect(await env.BACKUPS.get(`${f.root.owner_id}/${backup.id}/manifest.json`)).not.toBeNull();
}, 30000);

it('BACKUP-08：乾淨產品儲存完整恢復與索引重建，不使撤銷的 session／magic link 復活', async () => {
  const f = await fixture(sockets); const backup = await create(f.auth);
  const oldToken = await env.DB.prepare('SELECT token FROM session LIMIT 1').first<string>('token');
  await env.DB.prepare('DELETE FROM session').run();
  await env.DB.prepare('DELETE FROM verification').run();
  const fresh = await authenticated(f.auth.now + 60000); f.auth = fresh;
  await env.DB.batch([env.DB.prepare('DELETE FROM page_search'), env.DB.prepare('DELETE FROM pages'), env.DB.prepare('DELETE FROM assets')]);
  for (const client of f.clients) await runInDurableObject(client.stub, async (_instance, state) => { await state.storage.deleteAll(); await state.storage.sync(); });
  await env.ASSETS.delete((await env.ASSETS.list()).objects.map(object => object.key)); await abortAllDurableObjects();
  const response = await request(f.auth, `/api/backups/${backup.id}/restore`, env, 'POST'); expect(response.status).toBe(200);
  await restored(f); expect(await env.DB.prepare('SELECT id FROM session WHERE token = ?').bind(oldToken).first('id')).toBeNull();
  expect(await env.DB.prepare('SELECT count(*) AS n FROM verification').first('n')).toBe(0);
}, 30000);

it('BACKUP-09：還原後舊房間仍停止，舊更新不能污染新世代或復活其他日記', async () => {
  const f = await fixture(sockets); const backup = await create(f.auth);
  const old = new Y.Doc(); Y.applyUpdate(old, f.documents.get(f.journal.id)!); const offline = new Y.XmlText(); offline.insert(0, '舊裝置離線修改'); old.getXmlFragment('body').insert(0, [offline]);
  expect((await request(f.auth, `/api/backups/${backup.id}/restore`, env, 'POST')).status).toBe(200);
  await abortAllDurableObjects();
  const denied = await f.auth.get(`/parties/sync/${f.journal.room}?page=${f.journal.id}&generation=${f.journal.sync_generation}`); expect(denied.status).toBe(409);
  const current = await (await f.auth.get(`/api/pages/${f.journal.id}`)).json<PageInfo>();
  const client = await connect(current, f.auth.cookie); sockets.push(client.socket);
  expect((await persisted(client)).getXmlFragment('body').toString()).not.toContain('舊裝置離線修改');
  expect(await env.DB.prepare("SELECT count(*) AS n FROM pages WHERE kind = 'journal' AND journal_date = ?").bind(f.journal.journal_date).first('n')).toBe(1); old.destroy();
}, 30000);

it('BACKUP-07：暫停／準備／原子切換／解除中斷保留現況與意圖，abort 後同操作可重試', async () => {
  for (const phase of ['pause', 'prepare', 'switch', 'resume']) {
    await exports.default.fetch(origin + '/__test/reset', { method: 'POST' });
    const f = await fixture(sockets); const backup = await create(f.auth);
    if (phase === 'pause') await runInDurableObject(f.clients[0].stub, (_instance, state) => { vi.spyOn(state.storage, 'sync').mockRejectedValueOnce(new Error('測試暫停中斷')); });
    if (phase !== 'pause') {
      const prepare = env.DB.prepare.bind(env.DB);
      vi.spyOn(env.DB, 'prepare').mockImplementation(sql => {
        if ((phase === 'prepare' && sql.startsWith('UPDATE restore_operations SET rollback_id'))
          || (phase === 'switch' && sql.startsWith('DELETE FROM pages WHERE owner_id'))
          || (phase === 'resume' && sql.startsWith('DELETE FROM restore_operations'))) throw new Error('測試階段中斷');
        return prepare(sql);
      });
    }
    const response = await request(f.auth, `/api/backups/${backup.id}/restore`, env, 'POST'); expect(response.status).toBe(503);
    expect((await f.auth.get(`/api/pages/${f.root.id}`)).status).toBe(503);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM restore_operations').first('n')).toBe(1);
    const late = new Y.Doc(); Y.applyUpdate(late, f.documents.get(f.root.id)!);
    const text = new Y.XmlText(); text.insert(0, '處理中不得接受'); late.getXmlFragment('body').insert(0, [text]);
    if (f.clients[0].socket.readyState === WebSocket.OPEN) f.clients[0].socket.send('__YPS:' + JSON.stringify({ type: 'commit', id: 'late-write', update: toBase64(Y.encodeStateAsUpdate(late)) }));
    await vi.waitFor(() => expect(f.clients[0].closed).toBe(true)); late.destroy();
    const stopped = await persisted(f.clients[0]); expect(Y.encodeStateAsUpdate(stopped)).toEqual(f.documents.get(f.root.id)); stopped.destroy();
    vi.restoreAllMocks(); await abortAllDurableObjects();
    expect((await request(f.auth, `/api/backups/${backup.id}/restore`, env, 'POST')).status).toBe(200); await restored(f);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM restore_operations').first('n')).toBe(0);
  }
}, 60000);

it('RESTORE-GUARD-01：損毀正文／圖片與 metadata 不暫停現況，不發布空文件', async () => {
  const f = await fixture(sockets); const backup = await create(f.auth); const data = await manifest(f.auth, backup.id);
  await env.BACKUPS.put(`${f.root.owner_id}/${backup.id}/${data.pages[0].file.path}`, new Uint8Array([255, 255, 255]));
  expect((await request(f.auth, `/api/backups/${backup.id}/restore`, env, 'POST')).status).toBe(503);
  expect((await f.auth.get(`/api/pages/${f.root.id}`)).status).toBe(200);
  expect((await persisted(f.clients[0])).getXmlFragment('body').toString()).toContain('中文上層');
}, 30000);
