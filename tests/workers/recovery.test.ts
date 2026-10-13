import { env, exports } from 'cloudflare:workers';
import { abortAllDurableObjects, reset } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it } from 'vitest';
import * as Y from 'yjs';
import { authenticated, connect, commit, persisted, origin } from './helpers';
import type { PageInfo } from '../../src/shared/pages';

const sockets: WebSocket[] = [];
beforeEach(async () => { await exports.default.fetch(origin + '/health'); await exports.default.fetch(origin + '/__test/reset', { method: 'POST' }); });
afterEach(async () => { sockets.splice(0).forEach(socket => socket.close()); await reset(); });
function draft(text: string) {
  const doc = new Y.Doc(); const paragraph = new Y.XmlElement('paragraph'); const content = new Y.XmlText();
  content.insert(0, text); paragraph.insert(0, [content]); doc.getXmlFragment('body').insert(0, [paragraph]); return doc;
}
for (const action of ['delete', 'restore'] as const) it(`${action === 'delete' ? 'SYNC-10' : 'SYNC-11'}：被刪除或舊世代草稿另存為新根筆記，原日記與正文不變`, async () => {
  const auth = await authenticated(); const page = await auth.today(); const client = await connect(page, auth.cookie); sockets.push(client.socket);
  const original = draft('雲端正文'); await commit(client, original, 'original');
  if (action === 'delete') await auth.post(`/api/pages/${page.id}/delete`, {});
  else {
    const backup = await (await auth.post('/api/backups', {})).json<{ id: string }>();
    expect((await auth.post(`/api/backups/${backup.id}/restore`, {})).status).toBe(200);
  }
  const local = draft('舊裝置正文 /api/assets/private-image');
  const response = await exports.default.fetch(`${origin}/api/pages/${page.id}/fork`, { method: 'POST', headers: { Origin: origin, Cookie: auth.cookie, 'Content-Type': 'application/octet-stream' }, body: Y.encodeStateAsUpdate(local) });
  expect(response.status).toBe(200); const fork = await response.json<PageInfo>();
  expect(fork.id).not.toBe(page.id); expect(fork.kind).toBe('note'); expect(fork.parent_id).toBeNull(); expect(fork.journal_date).toBeNull(); expect(fork.owner_id).toBe(page.owner_id);
  const current = await auth.get(`/api/pages/${page.id}`); expect(current.status).toBe(action === 'delete' ? 409 : 200);
  if (action === 'restore') {
    const info = await current.json<PageInfo>(); expect(info.sync_generation).not.toBe(page.sync_generation);
    const restored = await connect(info, auth.cookie); sockets.push(restored.socket);
    const restoredDoc = await persisted(restored); expect(restoredDoc.getXmlFragment('body').toString()).toBe(original.getXmlFragment('body').toString()); restoredDoc.destroy();
  }
  await abortAllDurableObjects(); const copied = await connect(fork, auth.cookie); sockets.push(copied.socket);
  const recovered = await persisted(copied); expect(recovered.getXmlFragment('body').toString()).toBe(local.getXmlFragment('body').toString()); recovered.destroy();
  const old = await persisted(client); expect(old.getXmlFragment('body').toString()).toBe(original.getXmlFragment('body').toString()); old.destroy();
  expect(await env.DB.prepare("SELECT count(*) AS n FROM pages WHERE kind = 'journal'").first('n')).toBe(1);
  local.destroy(); original.destroy();
});
it('FORK-GUARD-01：正文無效或發布中斷不能留下空筆記，來源與他人頁面不可變更', async () => {
  const auth = await authenticated(); const page = await auth.today();
  const send = (id: string, bytes: Uint8Array) => exports.default.fetch(`${origin}/api/pages/${id}/fork`, { method: 'POST', headers: { Origin: origin, Cookie: auth.cookie, 'Content-Type': 'application/octet-stream' }, body: bytes });
  expect((await send(page.id, new Uint8Array([255]))).status).toBe(400);
  const stamp = new Date(auth.now).toISOString();
  await env.DB.prepare('INSERT INTO user VALUES (?, ?, ?, 1, NULL, ?, ?)').bind('foreign-owner', '他人', 'foreign@example.test', stamp, stamp).run();
  await env.DB.prepare("INSERT INTO pages (id, owner_id, kind, title, sync_generation, created_at, updated_at) VALUES ('foreign-page', 'foreign-owner', 'note', '他人原頁', 'g1', 0, 0)").run();
  const foreignDraft = draft('不能另存他人草稿');
  expect((await send('foreign-page', Y.encodeStateAsUpdate(foreignDraft))).status).toBe(404); foreignDraft.destroy();
  expect(await env.DB.prepare("SELECT title FROM pages WHERE id = 'foreign-page'").first('title')).toBe('他人原頁');
  await env.DB.exec("CREATE TRIGGER fail_fork BEFORE INSERT ON pages WHEN NEW.kind = 'note' BEGIN SELECT RAISE(ABORT, '測試另存發布中斷'); END");
  const doc = draft('須保留的正文'); expect((await send(page.id, Y.encodeStateAsUpdate(doc))).status).toBe(503); doc.destroy();
  expect(await env.DB.prepare('SELECT count(*) AS n FROM pages').first('n')).toBe(2);
  await env.DB.exec('DROP TRIGGER fail_fork');
});
