import { env, exports } from 'cloudflare:workers';
import { reset } from 'cloudflare:test';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { authenticated, connect, commit, origin } from './helpers';
import { createBackup } from '../../src/worker/backups';

afterEach(async () => { await reset(); });
const refs = async (auth: Awaited<ReturnType<typeof authenticated>>, id: string) => {
  const r = await auth.get('/api/pages/' + id + '/backlinks'); expect(r.status).toBe(200);
  return r.json<{ id: string; title: string }[]>();
};
function document(hrefs: string[]) {
  const doc = new Y.Doc(); const p = new Y.XmlElement('paragraph'); const text = new Y.XmlText();
  p.insert(0, [text]); doc.getXmlFragment('body').insert(0, [p]);
  for (const href of hrefs) text.insert(text.length, '引用 ', { link: { href } });
  return doc;
}
it('LINK-02：索引去重、外部與自我引用排除、最後引用移除', async () => {
  const auth = await authenticated(); const source = await auth.note('來源'); const target = await auth.note('目標');
  const client = await connect(source, auth.cookie);
  const doc = document(['/?page=' + target.id, '/?page=' + target.id, '/?page=' + source.id, 'https://external.example.test/?page=' + target.id]);
  await commit(client, doc, 'links');
  await vi.waitFor(async () => expect(await refs(auth, target.id)).toEqual([expect.objectContaining({ id: source.id })]));
  expect(await refs(auth, source.id)).toEqual([]);
  const text = (doc.getXmlFragment('body').get(0) as Y.XmlElement).get(0) as Y.XmlText;
  text.delete(0, text.length); await commit(client, doc, 'remove');
  await vi.waitFor(async () => expect(await refs(auth, target.id)).toEqual([]));
  client.socket.close(); doc.destroy();
});
it('LINK-03：新標題、上層垃圾桶、還原、舊世代與其他擁有者隔離', async () => {
  const auth = await authenticated(); const parent = await auth.note('上層');
  const source = await auth.result(auth.post('/api/pages', { title: '來源', parent_id: parent.id })); const target = await auth.note('目標');
  const client = await connect(source, auth.cookie); const doc = document(['/?page=' + target.id]); await commit(client, doc, 'link');
  await vi.waitFor(async () => expect((await refs(auth, target.id)).length).toBe(1));
  await auth.post('/api/pages/' + source.id + '/title', { title: '新來源' }); expect((await refs(auth, target.id))[0].title).toBe('新來源');
  await auth.post('/api/pages/' + parent.id + '/delete', {}); expect(await refs(auth, target.id)).toEqual([]);
  await auth.post('/api/pages/' + parent.id + '/restore', {}); expect((await refs(auth, target.id)).length).toBe(1);
  await env.DB.prepare('UPDATE page_search SET indexed_generation = ? WHERE page_id = ?').bind('old', source.id).run(); expect(await refs(auth, target.id)).toEqual([]);
  await env.DB.prepare("INSERT INTO user VALUES ('other-owner', '其他測試帳號', 'other@example.test', 1, NULL, '2026-10-14', '2026-10-14')").run();
  await env.DB.prepare("INSERT INTO pages (id, owner_id, kind, title, sync_generation, created_at, updated_at) VALUES ('other-page', 'other-owner', 'note', '不可見來源', 'other-generation', 0, 0)").run();
  await env.DB.prepare('INSERT INTO page_search (page_id, owner_id, plain_text, summary, indexed_generation, indexed_checkpoint, linked_pages) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind('other-page', 'other-owner', '', '', 'other-generation', 1, JSON.stringify([target.id])).run();
  expect(await refs(auth, target.id)).toEqual([]);
  expect((await auth.get('/api/pages/other-page/backlinks')).status).toBe(404);
  expect((await exports.default.fetch(origin + '/api/pages/' + target.id + '/backlinks')).status).toBe(401);
  expect((await auth.get('/api/pages/missing/backlinks')).status).toBe(404);
  await auth.post('/api/pages/' + target.id + '/delete', {}); expect((await auth.get('/api/pages/' + target.id + '/backlinks')).status).toBe(404);
  client.socket.close(); doc.destroy();
});
it('LINK-05：JSON API 連結往返、巢狀與表格索引、覆蓋還原重建', async () => {
  const auth = await authenticated(); const source = await auth.note('API 來源'); const target = await auth.note('API 目標'); const later = await auth.note('還原前目標');
  const created = await auth.post('/api/keys', { name: '測試連結 key' }); expect(created.status).toBe(201);
  const { id: keyId } = await created.json<{ id: string }>();
  const { key } = await (await auth.post('/api/keys/' + keyId + '/reveal', {})).json<{ key: string }>();
  const path = origin + '/api/v1/pages/' + source.id + '/content';
  const send = (body?: object, etag?: string) => exports.default.fetch(path, { method: body ? 'PUT' : 'GET', headers: { Authorization: 'Bearer ' + key, ...(body ? { 'Content-Type': 'application/json', 'If-Match': etag! } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const before = await send(); expect(before.status).toBe(200);
  const link = { type: 'link', href: '/?page=' + target.id, content: 'API 目標' };
  const written = await send({ blocks: [{ type: 'paragraph', content: '上層', children: [{ type: 'paragraph', content: [link] }] }, { type: 'table', content: { type: 'tableContent', rows: [{ cells: [[link]] }] } }] }, before.headers.get('etag')!);
  expect(written.status).toBe(200); expect(JSON.stringify(await written.json())).toContain('/?page=' + target.id);
  expect((await refs(auth, target.id)).map(p => p.id)).toEqual([source.id]);
  const backup = await createBackup(env, source.owner_id, () => auth.now);
  const current = await send(); const changed = await send({ blocks: [{ type: 'paragraph', content: [{ ...link, href: '/?page=' + later.id }] }] }, current.headers.get('etag')!); expect(changed.status).toBe(200);
  expect((await refs(auth, later.id)).length).toBe(1);
  const restored = await auth.post('/api/backups/' + backup.id + '/restore', {}); expect(restored.status).toBe(200);
  expect((await refs(auth, target.id)).map(p => p.id)).toEqual([source.id]); expect(await refs(auth, later.id)).toEqual([]);
  expect(JSON.stringify(await (await send()).json())).toContain('/?page=' + target.id);
});
