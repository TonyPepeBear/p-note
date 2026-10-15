import { env, exports } from 'cloudflare:workers';
import { abortAllDurableObjects, reset, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { PageHistory, PageVersion, PageVersionPreview, PageVersionRestore } from '../../src/shared/history';
import type { PageInfo } from '../../src/shared/pages';
import { blockEditor, replaceBlocks } from '../../src/worker/block-json';
import { authenticated, commit, connect, origin, persisted } from './helpers';

const sockets: WebSocket[] = [];
beforeEach(async () => { await exports.default.fetch(origin + '/__test/reset', { method: 'POST' }); });
afterEach(async () => { vi.restoreAllMocks(); sockets.splice(0).forEach(socket => socket.close()); await reset(); });
async function fixture() {
  const auth = await authenticated(); const page = await auth.note('版本原標題'); const client = await connect(page, auth.cookie); sockets.push(client.socket);
  const doc = new Y.Doc(); const editor = blockEditor(); let count = 0;
  const write = async (text: string) => {
    replaceBlocks(doc, [{ type: 'paragraph', content: text }], editor);
    expect((await commit(client, doc, 'history-' + ++count)).type).toBe('persisted');
    // 持久確認早於衍生歷史索引；透過 RPC 排在同一房間提交之後。
    await client.stub.reindex({ owner: page.owner_id, page: page.id, generation: page.sync_generation });
  };
  const list = async (query = '') => {
    const response = await auth.get(`/api/pages/${page.id}/history${query}`); expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store'); return response.json<PageHistory>();
  };
  const manual = async () => { const response = await auth.post(`/api/pages/${page.id}/history`, {}); expect(response.status).toBe(201); return response.json<PageVersion>(); };
  const preview = async (id: string) => { const response = await auth.get(`/api/pages/${page.id}/history/${id}`); expect(response.status).toBe(200); return response.json<PageVersionPreview>(); };
  const restore = (id: string, request_id = crypto.randomUUID()) => auth.post(`/api/pages/${page.id}/history/${id}/restore`, { request_id });
  return { auth, page, client, doc, write, list, manual, preview, restore };
}

it('HIST-01：首次變更前保留基準、五分鐘節流並在開啟歷史時補最新，標題也自動留史', async () => {
  const f = await fixture();
  await f.write('第一份正文');
  expect(await env.DB.prepare('SELECT count(*) AS n FROM page_versions WHERE page_id = ?').bind(f.page.id).first('n')).toBe(1);
  const first = await f.list(); expect(first.versions).toHaveLength(2);
  expect((await f.preview(first.versions.at(-1)!.id)).blocks).toEqual([]);
  await f.write('五分鐘內的正文');
  expect(await env.DB.prepare('SELECT count(*) AS n FROM page_versions WHERE page_id = ?').bind(f.page.id).first('n')).toBe(2);
  await f.auth.post('/__test/control', { now: f.auth.now + 5 * 60 * 1000 });
  expect((await f.auth.post(`/api/pages/${f.page.id}/title`, { title: '自動保留的新標題' })).status).toBe(200);
  const latest = await f.list(); expect(latest.versions).toHaveLength(3); expect(latest.versions[0]).toMatchObject({ title: '自動保留的新標題', reason: 'auto' });
  expect(JSON.stringify((await f.preview(latest.versions[0].id)).blocks)).toContain('五分鐘內的正文');
  expect((await f.list()).versions).toHaveLength(3); f.doc.destroy();
});

it('HIST-02：手動版本重試去重，游標倒序分頁，重啟後格式預覽仍可讀且不改現況', async () => {
  const f = await fixture(); await f.write('較早正文'); const old = await f.manual();
  expect((await f.manual()).id).toBe(old.id);
  replaceBlocks(f.doc, [{ type: 'heading', props: { level: 2 }, content: '最新格式標題' }, { type: 'bulletListItem', content: [{ type: 'text', text: '粗體', styles: { bold: true } }] }], blockEditor());
  expect((await commit(f.client, f.doc, 'formatted')).type).toBe('persisted'); const newer = await f.manual();
  const top = await f.list('?limit=1'); expect(top.versions[0].id).toBe(newer.id); expect(top.next_cursor).toBe(newer.id);
  const next = await f.list('?limit=1&cursor=' + top.next_cursor); expect(next.versions[0].id).toBe(old.id);
  await abortAllDurableObjects();
  const preview = await f.preview(newer.id); expect(JSON.stringify(preview.blocks)).toContain('"bold":true');
  expect(preview.blocks[0]).toMatchObject({ type: 'heading', props: { level: 2 } });
  expect((await persisted(f.client)).getXmlFragment('body').toString()).toContain('最新格式標題'); f.doc.destroy();
});

it('HIST-03：還原只回退標題正文，保留結構與屬性，前態可還原且舊端不能合併', async () => {
  const f = await fixture(); await f.write('較早正文'); const old = await f.manual();
  await f.auth.post(`/api/pages/${f.page.id}/title`, { title: '還原前新標題' }); await f.write('還原前最新正文');
  const parent = await f.auth.note('保留上層'); await f.auth.post(`/api/pages/${f.page.id}/move`, { parent_id: parent.id });
  await env.DB.prepare('UPDATE pages SET property_values = ? WHERE id = ?').bind('{"text":"保留屬性"}', f.page.id).run();
  const before = await f.auth.result(f.auth.get(`/api/pages/${f.page.id}`));
  const response = await f.restore(old.id); expect(response.status).toBe(200); const result = await response.json<PageVersionRestore>();
  expect(result.page).toMatchObject({ title: f.page.title, parent_id: parent.id, property_values: before.property_values });
  expect(result.page.sync_generation).not.toBe(before.sync_generation);
  expect(JSON.stringify((await f.preview(result.before_version_id)).blocks)).toContain('還原前最新正文');
  expect((await f.preview(result.before_version_id)).version.title).toBe('還原前新標題');
  const current = await connect(result.page, f.auth.cookie); sockets.push(current.socket);
  expect((await persisted(current)).getXmlFragment('body').toString()).toContain('較早正文');
  expect((await f.auth.get(`/parties/sync/${f.page.room}?page=${f.page.id}&generation=${f.page.sync_generation}`)).status).toBe(409);
  expect((await f.restore(result.before_version_id)).status).toBe(200); f.doc.destroy();
});

it('HIST-03：相同請求重試不再換世代或覆寫還原後的新修改', async () => {
  const f = await fixture(); await f.write('舊版'); const old = await f.manual(); await f.write('最新版'); const request = crypto.randomUUID();
  const first = await f.restore(old.id, request); expect(first.status).toBe(200); const result = await first.json<PageVersionRestore>();
  const client = await connect(result.page, f.auth.cookie); sockets.push(client.socket); const doc = await persisted(client);
  replaceBlocks(doc, [{ type: 'paragraph', content: '還原之後的新修改' }], blockEditor()); expect((await commit(client, doc, 'after-restore')).type).toBe('persisted');
  await abortAllDurableObjects(); const repeated = await f.restore(old.id, request); expect(repeated.status).toBe(200);
  expect((await repeated.json<PageVersionRestore>()).page.sync_generation).toBe(result.page.sync_generation);
  expect((await persisted(client)).getXmlFragment('body').toString()).toContain('還原之後的新修改'); doc.destroy(); f.doc.destroy();
});

it('HIST-04：階段中斷保持鎖與前態，重啟後原請求可繼續', async () => {
  const f = await fixture(); await f.write('目標舊版'); const old = await f.manual(); await f.write('必須保護的前態');
  const request = crypto.randomUUID();
  await runInDurableObject(f.client.stub, (_instance, state) => { vi.spyOn(state.storage, 'sync').mockRejectedValueOnce(new Error('測試暫停中斷')); });
  expect((await f.restore(old.id, request)).status).toBe(503);
  const pending = await f.list(); expect(pending.restore).toEqual({ request_id: request, version_id: old.id });
  expect((await f.auth.post(`/api/pages/${f.page.id}/title`, { title: '鎖定時不得修改' })).status).toBe(503);
  expect((await f.restore(old.id)).status).toBe(409);
  vi.restoreAllMocks(); await abortAllDurableObjects();
  const response = await f.restore(old.id, request); expect(response.status).toBe(200); const result = await response.json<PageVersionRestore>();
  expect(JSON.stringify((await f.preview(result.before_version_id)).blocks)).toContain('必須保護的前態');
  expect((await f.list()).restore).toBeNull(); f.doc.destroy();
});

it('HIST-05：版本損毀不暫停現況，垃圾桶與別人頁面／版本不可讀，資料庫容器明確拒絕', async () => {
  const f = await fixture(); await f.write('原文'); const version = await f.manual();
  const key = await env.DB.prepare('SELECT object_key FROM page_versions WHERE id = ?').bind(version.id).first<string>('object_key');
  await env.BACKUPS.put(key!, new Uint8Array([255]));
  expect((await f.restore(version.id)).status).toBe(503); expect((await f.auth.get(`/api/pages/${f.page.id}`)).status).toBe(200);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM page_history_restores').first('n')).toBe(0);
  const other = await f.auth.note('其他頁面'); expect((await f.auth.get(`/api/pages/${other.id}/history/${version.id}`)).status).toBe(404);
  await env.DB.prepare('UPDATE pages SET database_config = ? WHERE id = ?').bind('{"properties":[]}', other.id).run();
  expect((await f.auth.get(`/api/pages/${other.id}/history`)).status).toBe(409);
  await f.auth.post(`/api/pages/${f.page.id}/delete`, {}); expect((await f.auth.get(`/api/pages/${f.page.id}/history`)).status).toBe(404);
  expect((await f.auth.get(`/api/pages/${f.page.id}/history/${version.id}`)).status).toBe(404);
  expect((await exports.default.fetch(origin + `/api/pages/${other.id}/history`)).status).toBe(401); f.doc.destroy();
});

it('HIST-06：手動版本 D1 發布失敗不出現假成功，重試可建立完整版本', async () => {
  const f = await fixture(); await f.write('必須完整保存');
  const before = await env.DB.prepare('SELECT count(*) AS n FROM page_versions').first<number>('n');
  await env.DB.exec("CREATE TRIGGER history_manual_failure BEFORE INSERT ON page_versions WHEN NEW.reason = 'manual' BEGIN SELECT RAISE(ABORT, '測試歷史發布中斷'); END");
  expect((await f.auth.post(`/api/pages/${f.page.id}/history`, {})).status).toBe(503);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM page_versions').first<number>('n')).toBe(before);
  expect((await persisted(f.client)).getXmlFragment('body').toString()).toContain('必須完整保存');
  await env.DB.exec('DROP TRIGGER history_manual_failure'); const version = await f.manual();
  expect(JSON.stringify((await f.preview(version.id)).blocks)).toContain('必須完整保存'); f.doc.destroy();
});

it('HIST-04：前態發布、世代切換、恢復歷史與完成紀錄中斷均可重試原操作', async () => {
  for (const phase of ['before', 'switch', 'restored', 'completed']) {
    await exports.default.fetch(origin + '/__test/reset', { method: 'POST' });
    const f = await fixture(); await f.write('目標舊內容'); const old = await f.manual(); await f.write('中斷前必須保護的內容');
    const request = crypto.randomUUID();
    const trigger = phase === 'before'
      ? "BEFORE INSERT ON page_versions WHEN NEW.reason = 'before_restore'"
      : phase === 'switch' ? "BEFORE UPDATE OF sync_generation ON pages WHEN EXISTS (SELECT 1 FROM page_history_restores WHERE phase = 'switching')"
      : phase === 'restored' ? "BEFORE INSERT ON page_versions WHEN NEW.reason = 'restore'"
      : 'BEFORE INSERT ON completed_page_history_restores';
    await env.DB.exec(`CREATE TRIGGER history_phase_failure ${trigger} BEGIN SELECT RAISE(ABORT, '測試版本還原階段中斷'); END`);
    expect((await f.restore(old.id, request)).status, phase).toBe(503);
    expect((await f.list()).restore).toEqual({ request_id: request, version_id: old.id });
    const pending = await f.auth.get('/api/history-restore'); expect(pending.status).toBe(200);
    expect(await pending.json()).toMatchObject({ restore: { request_id: request, version_id: old.id, page_id: f.page.id }, page: { id: f.page.id } });
    expect((await f.auth.post('/api/backups', {})).status).toBe(503);
    if (phase === 'before' || phase === 'switch') expect(await env.DB.prepare('SELECT sync_generation FROM pages WHERE id = ?').bind(f.page.id).first('sync_generation')).toBe(f.page.sync_generation);
    await env.DB.exec('DROP TRIGGER history_phase_failure'); await abortAllDurableObjects();
    const response = await f.restore(old.id, request); expect(response.status, phase).toBe(200); const result = await response.json<PageVersionRestore>();
    expect(JSON.stringify((await f.preview(result.before_version_id)).blocks)).toContain('中斷前必須保護的內容');
    expect((await f.preview(result.before_version_id)).version.reason).toBe('before_restore');
    expect((await f.list()).restore).toBeNull();
    expect(await env.DB.prepare("SELECT count(*) AS n FROM page_versions WHERE page_id = ? AND reason = 'before_restore'").bind(f.page.id).first('n')).toBe(1);
    f.doc.destroy();
  }
}, 30000);

it('HIST-05：其他擁有者頁面與版本一律拒絕，API key 不可操作歷史', async () => {
  const f = await fixture(); await f.write('本人版本'); const version = await f.manual();
  await env.DB.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)')
    .bind('history-other-owner', '另一擁有者', 'other@example.test', new Date().toISOString(), new Date().toISOString()).run();
  await env.DB.prepare("INSERT INTO pages (id, owner_id, kind, title, sync_generation, created_at, updated_at) VALUES ('history-private-page', 'history-other-owner', 'note', '私人標題', 'other-generation', ?, ?)")
    .bind(f.auth.now, f.auth.now).run();
  expect((await f.auth.get('/api/pages/history-private-page/history')).status).toBe(404);
  expect((await f.auth.get(`/api/pages/history-private-page/history/${version.id}`)).status).toBe(404);
  expect((await f.auth.post(`/api/pages/history-private-page/history/${version.id}/restore`, { request_id: crypto.randomUUID() })).status).toBe(404);
  const created = await f.auth.post('/api/keys', { name: 'history test key' });
  expect(created.status).toBe(201); const createdKey = await created.json<{ id: string }>();
  const key = await (await f.auth.post(`/api/keys/${createdKey.id}/reveal`, {})).json<{ key: string }>();
  expect((await exports.default.fetch(origin + `/api/v1/pages/${f.page.id}/history`, { headers: { Authorization: 'Bearer ' + key.key } })).status).toBe(403);
  expect((await exports.default.fetch(origin + `/api/pages/${f.page.id}/history`, { headers: { Cookie: f.auth.cookie, Origin: 'https://other.example.test' } })).status).toBe(403);
  expect((await exports.default.fetch(origin + `/api/pages/${f.page.id}/history`, { method: 'POST', headers: { Cookie: f.auth.cookie, Origin: 'https://other.example.test', 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(403);
  expect((await exports.default.fetch(origin + '/api/history-restore')).status).toBe(401);
  f.doc.destroy();
});

it('HIST-01：表格改名保存原標題基準，設定競爭仍拒絕過期欄位操作', async () => {
  const auth = await authenticated();
  const containerResponse = await auth.post('/api/databases', { title: '資料庫容器' }); expect(containerResponse.status).toBe(200);
  const container = await containerResponse.json<PageInfo>();
  const child = await auth.result(auth.post('/api/pages', { title: '表格改名前', parent_id: container.id }));
  const renamed = await auth.post(`/api/pages/${child.id}/properties`, { property: 'title', value: '表格改名後', generation: child.sync_generation });
  expect(renamed.status).toBe(200);
  const history = await (await auth.get(`/api/pages/${child.id}/history`)).json<PageHistory>();
  expect(history.versions.map(version => version.title)).toEqual(['表格改名後', '表格改名前']);
  const racing = await auth.result(auth.post('/api/pages', { title: '競爭前標題', parent_id: container.id }));
  await env.DB.exec(`CREATE TRIGGER history_container_race AFTER INSERT ON page_versions WHEN NEW.page_id = '${racing.id}' BEGIN UPDATE pages SET database_config = database_config || ' ' WHERE id = '${container.id}'; END`);
  expect((await auth.post(`/api/pages/${racing.id}/properties`, { property: 'title', value: '不得寫入', generation: racing.sync_generation })).status).toBe(409);
  expect(await env.DB.prepare('SELECT title FROM pages WHERE id = ?').bind(racing.id).first('title')).toBe('競爭前標題');
  await env.DB.exec('DROP TRIGGER history_container_race');
});

it('HIST-06：整站備份還原保留原有頁面歷史與快照', async () => {
  const f = await fixture(); await f.write('備份中的正文'); const old = await f.manual();
  const backupResponse = await f.auth.post('/api/backups', {}); expect(backupResponse.status).toBe(201); const backup = await backupResponse.json<{ id: string }>();
  await f.write('備份之後的正文'); const newer = await f.manual();
  const restored = await f.auth.post(`/api/backups/${backup.id}/restore`, { request_id: crypto.randomUUID() }); expect(restored.status).toBe(200);
  await abortAllDurableObjects();
  expect(JSON.stringify((await f.preview(old.id)).blocks)).toContain('備份中的正文');
  expect(JSON.stringify((await f.preview(newer.id)).blocks)).toContain('備份之後的正文');
  const history = await f.list(); expect(history.versions.map(version => version.id)).toEqual(expect.arrayContaining([old.id, newer.id])); f.doc.destroy();
});
