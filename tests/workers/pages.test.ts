import { env, exports } from 'cloudflare:workers';
import { reset, runInDurableObject, abortAllDurableObjects } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { toBase64 } from 'lib0/buffer';
import { roomName } from '../../src/shared/room';

const origin = 'http://127.0.0.1:5173';
type PageRow = { id: string; owner_id: string; kind: string; title: string; parent_id: string | null; journal_date: string | null; sync_generation: string; deleted_at: number | null; created_at: number; updated_at: number; metadata_revision: number; room: string };
let cookie = ''; let owner = ''; let now = 0;
const sockets: WebSocket[] = [];
const get = (path: string) => exports.default.fetch(origin + path, { headers: { Cookie: cookie } });
const post = (path: string, data: object) => exports.default.fetch(origin + path, { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
async function result(response: Promise<Response>): Promise<PageRow> { const r = await response; expect(r.status, await r.clone().text()).toBe(200); return r.json<PageRow>(); }
const note = (title: string, parent_id: string | null = null) => result(post('/api/pages', { title, parent_id }));
async function rows() { return (await env.DB.prepare('SELECT * FROM pages ORDER BY id').all()).results; }
async function connect(page: PageRow) {
  const room = await roomName(owner, page.id, page.sync_generation);
  const response = await exports.default.fetch(`${origin}/parties/sync/${room}?page=${page.id}&generation=${page.sync_generation}`, { headers: { Cookie: cookie, Origin: origin, Upgrade: 'websocket' } });
  expect(response.status).toBe(101);
  const socket = response.webSocket!; socket.accept(); sockets.push(socket);
  const messages: string[] = []; let closed = false;
  socket.addEventListener('message', event => { if (typeof event.data === 'string') messages.push(event.data); });
  socket.addEventListener('close', () => { closed = true; });
  return { socket, messages, stub: env.SYNC.getByName(room), get closed() { return closed; } };
}
function document(text: string, image = false) {
  const doc = new Y.Doc(); const paragraph = new Y.XmlElement('paragraph');
  const content = new Y.XmlText(); content.insert(0, text); paragraph.insert(0, [content]);
  doc.getXmlFragment('body').insert(0, [paragraph]);
  if (image) { const node = new Y.XmlElement('image'); node.setAttribute('url', '/api/assets/pixel'); doc.getXmlFragment('body').insert(1, [node]); }
  return doc;
}
async function commit(client: Awaited<ReturnType<typeof connect>>, doc: Y.Doc, id: string) {
  client.socket.send(`__YPS:${JSON.stringify({ type: 'commit', id, update: toBase64(Y.encodeStateAsUpdate(doc)) })}`);
  await vi.waitFor(() => expect(client.messages.some(message => message.includes('persisted') && message.includes(id))).toBe(true));
}
beforeEach(async () => {
  await get('/health'); now = Date.now() + 86400000;
  await post('/__test/control', { now });
  expect((await post('/api/login', { email: 'owner@example.test' })).status).toBe(200);
  const mail = (await (await get('/__test/mailbox')).json<{ url: string }[]>()).at(-1)!;
  const confirmed = await post('/api/confirm', { token: new URL(mail.url).searchParams.get('token') });
  expect(confirmed.status).toBe(200); cookie = confirmed.headers.get('set-cookie')!.split(';')[0];
  owner = (await (await get('/api/session')).json<{ user: { id: string } }>()).user.id;
});
afterEach(async () => { sockets.splice(0).forEach(socket => socket.close()); cookie = ''; await reset(); });

it('PAGE-01：今日入口沿用已保存日記與世代，不重建正文', async () => {
  const page = await result(get('/api/today')); const client = await connect(page);
  await commit(client, document('原本的今天'), 'today');
  expect((await result(get('/api/today'))).id).toBe(page.id);
  await runInDurableObject(client.stub, instance => expect(instance.document.getXmlFragment('body').toString()).toContain('原本的今天'));
  expect(await env.DB.prepare('SELECT count(*) AS n FROM pages WHERE journal_date = ?').bind(page.journal_date).first('n')).toBe(1);
});

it('PAGE-02：併發建立同日期取得同一日記與房間', async () => {
  const pages = await Promise.all(Array.from({ length: 8 }, () => result(post('/api/journal', { date: '2024-02-29' }))));
  expect(new Set(pages.map(page => page.id)).size).toBe(1);
  expect(new Set(pages.map(page => page.room)).size).toBe(1);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM pages WHERE journal_date = ?').bind('2024-02-29').first('n')).toBe(1);
});

it('PAGE-03：補寫歸屬日期不變、實際更新時間獨立，月份列表與日期邊界正確', async () => {
  const page = await result(post('/api/journal', { date: '2024-02-29' }));
  expect(page.created_at).toBe(now);
  await post('/__test/control', { now: now + 60000 });
  const edited = await result(post(`/api/pages/${page.id}/title`, { title: '補寫的日記' }));
  expect(edited.journal_date).toBe('2024-02-29'); expect(edited.created_at).toBe(now); expect(edited.updated_at).toBe(now + 60000);
  const client = await connect(page); const body = document('實際補寫正文');
  await post('/__test/control', { now: now + 120000 }); await commit(client, body, 'body-time');
  await client.stub.reindex({ owner, page: page.id, generation: page.sync_generation });
  expect((await result(get(`/api/pages/${page.id}`))).updated_at).toBe(now + 120000);
  await post('/__test/control', { now: now + 180000 }); await commit(client, body, 'duplicate-time');
  await client.stub.reindex({ owner, page: page.id, generation: page.sync_generation });
  expect((await result(get(`/api/pages/${page.id}`))).updated_at).toBe(now + 120000); body.destroy();
  await env.DB.prepare('UPDATE pages SET updated_at = ? WHERE id = ?').bind(now, page.id).run();
  await abortAllDurableObjects(); await connect(page);
  expect((await result(get(`/api/pages/${page.id}`))).updated_at).toBe(now + 120000);
  const list = await (await get('/api/journals?month=2024-02')).json<PageRow[]>();
  expect(list.map(item => item.id)).toEqual([page.id]);
  for (const date of ['2023-02-29', '1900-02-29', '2024-04-31', '2024-00-01', '2024-13-01', '2024-01-00', '0000-01-01', '2024-2-1', '日期']) {
    expect((await post('/api/journal', { date })).status).toBe(400);
  }
  expect((await post('/api/journal', { date: '2000-02-29' })).status).toBe(200);
  expect((await get('/api/journals?month=2024-13')).status).toBe(400);
});

it('PAGE-04：根筆記／子頁可編輯，列表與路徑保留所有權，標題不改世代', async () => {
  const parent = await note('上層'); const child = await note('子頁', parent.id);
  expect(child.parent_id).toBe(parent.id); expect(child.owner_id).toBe(owner);
  const client = await connect(child); await commit(client, document('子頁正文'), 'child');
  const changed = await result(post(`/api/pages/${child.id}/title`, { title: '新標題' }));
  expect(changed.metadata_revision).toBe(1); expect(changed.sync_generation).toBe(child.sync_generation);
  expect((await (await get(`/api/pages/${child.id}`)).json<{ ancestors: PageRow[] }>()).ancestors.map(item => item.id)).toEqual([parent.id]);
  expect((await (await get('/api/pages')).json<PageRow[]>()).map(page => page.id).sort()).toEqual([parent.id, child.id].sort());
  const journal = await result(get('/api/today'));
  expect((await post('/api/pages', { title: '無效', parent_id: journal.id })).status).toBe(409);
  expect((await post(`/api/pages/${child.id}/title`, { title: '   ' })).status).toBe(400);
});

it('PAGE-05：拒絕自己／子孫／他人／刪除／不存在上層，併發互移不形成循環', async () => {
  const parent = await note('上層'); const child = await note('子頁', parent.id); const deleted = await note('刪除');
  const original = await rows();
  expect((await post(`/api/pages/${child.id}/move`, {})).status).toBe(400);
  expect(await rows()).toEqual(original);
  await post(`/api/pages/${deleted.id}/delete`, {});
  const stamp = new Date().toISOString();
  await env.DB.prepare('INSERT INTO user VALUES (?, ?, ?, 1, NULL, ?, ?)').bind('other-owner', '別人', 'other@example.test', stamp, stamp).run();
  await env.DB.prepare("INSERT INTO pages (id, owner_id, kind, title, sync_generation, created_at, updated_at) VALUES ('foreign', 'other-owner', 'note', '別人', 'g1', 0, 0)").run();
  for (const parent_id of [parent.id, child.id, 'foreign', deleted.id, 'missing']) {
    const before = await rows(); expect((await post(`/api/pages/${parent.id}/move`, { parent_id })).status).toBe(409); expect(await rows()).toEqual(before);
  }
  expect((await post('/api/pages/foreign/move', { parent_id: null })).status).toBe(404);
  const a = await note('甲'); const b = await note('乙');
  const results = await Promise.all([post(`/api/pages/${a.id}/move`, { parent_id: b.id }), post(`/api/pages/${b.id}/move`, { parent_id: a.id })]);
  expect(results.map(response => response.status).sort()).toEqual([200, 409]);
});

it('PAGE-06：刪除／還原上層保留正文與 R2，先前單獨刪除子頁不復活且活躍連線停止', async () => {
  const parent = await note('上層'); const child = await note('有效子頁', parent.id); const separately = await note('先前刪除', parent.id);
  await env.ASSETS.put('pixel', new Uint8Array([1, 2, 3, 4]));
  const client = await connect(child); await commit(client, document('子頁內容', true), 'before-delete');
  await post(`/api/pages/${separately.id}/delete`, {});
  expect((await post(`/api/pages/${parent.id}/delete`, {})).status).toBe(200);
  await vi.waitFor(() => expect(client.closed).toBe(true));
  expect((await get(`/api/pages/${child.id}`)).status).toBe(409);
  expect(await (await get('/api/pages')).json()).toEqual([]);
  expect((await post(`/api/pages/${separately.id}/restore`, {})).status).toBe(409);
  expect((await post(`/api/pages/${parent.id}/restore`, {})).status).toBe(200);
  expect((await get(`/api/pages/${child.id}`)).status).toBe(200);
  expect((await get(`/api/pages/${separately.id}`)).status).toBe(409);
  expect(new Uint8Array(await (await env.ASSETS.get('pixel'))!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  await abortAllDurableObjects();
  const resumed = await connect(child);
  await runInDurableObject(resumed.stub, instance => {
    expect(instance.document.getXmlFragment('body').toString()).toContain('子頁內容');
    expect(instance.document.getXmlFragment('body').toString()).toContain('/api/assets/pixel');
  });
});

it('PAGE-07：日期在垃圾桶時提供原 ID 還原，重試不另建日記', async () => {
  const page = await result(post('/api/journal', { date: '2024-01-01' }));
  await post(`/api/pages/${page.id}/delete`, {});
  const response = await post('/api/journal', { date: '2024-01-01' }); expect(response.status).toBe(409);
  expect((await response.json<{ page: PageRow }>()).page.id).toBe(page.id);
  expect((await (await get('/api/trash')).json<PageRow[]>()).map(item => item.id)).toContain(page.id);
  expect(await (await get('/api/journals?month=2024-01')).json()).toEqual([]);
  await post(`/api/pages/${page.id}/restore`, {});
  expect((await result(post('/api/journal', { date: '2024-01-01' }))).id).toBe(page.id);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM pages').first('n')).toBe(1);
});

it('PAGE-08：中文標題／正文／literal 搜尋排除垃圾桶子樹與他人，索引不改正文', async () => {
  const title = await note('中文標題 100%'); const body = await note('正文筆記'); const parent = await note('隱藏上層'); const hidden = await note('中文標題', parent.id);
  const client = await connect(body); const doc = document('今天記錄中文正文 <保留原字>');
  await commit(client, doc, 'index');
  await vi.waitFor(async () => expect(await env.DB.prepare('SELECT plain_text FROM page_search WHERE page_id = ?').bind(body.id).first('plain_text')).toBe('今天記錄中文正文 <保留原字>'));
  await post(`/api/pages/${parent.id}/delete`, {});
  const search = async (q: string) => (await (await get('/api/search?q=' + encodeURIComponent(q))).json<PageRow[]>()).map(page => page.id).sort();
  expect(await search('中文')).toEqual([title.id, body.id].sort()); expect(await search('%')).toEqual([title.id]);
  expect(await search('正文')).toEqual([body.id]); expect(await search('中文標題')).not.toContain(hidden.id);
  const stamp = new Date().toISOString();
  await env.DB.prepare('INSERT INTO user VALUES (?, ?, ?, 1, NULL, ?, ?)').bind('other-owner', '他人', 'other@example.test', stamp, stamp).run();
  await env.DB.prepare("INSERT INTO pages (id, owner_id, kind, title, sync_generation, created_at, updated_at) VALUES ('foreign', 'other-owner', 'note', '中文標題', 'g1', 0, 0)").run();
  await env.DB.prepare("INSERT INTO page_search (page_id, owner_id, plain_text, summary, indexed_generation, indexed_checkpoint) VALUES ('foreign', 'other-owner', '中文正文', '中文', 'g1', 100)").run();
  expect(await search('中文')).toEqual([title.id, body.id].sort());
  await runInDurableObject(client.stub, instance => expect(instance.document.getXmlFragment('body').toString()).toBe(doc.getXmlFragment('body').toString()));
  const checkpoint = await env.DB.prepare('SELECT indexed_checkpoint FROM page_search WHERE page_id = ?').bind(body.id).first<number>('indexed_checkpoint');
  await client.stub.reindex({ owner, page: body.id, generation: 'wrong-generation' });
  expect(await env.DB.prepare('SELECT indexed_checkpoint FROM page_search WHERE page_id = ?').bind(body.id).first('indexed_checkpoint')).toBe(checkpoint);
  await env.DB.prepare('UPDATE page_search SET indexed_checkpoint = 9999, plain_text = ? WHERE page_id = ?').bind('較新的索引', body.id).run();
  await client.stub.reindex({ owner, page: body.id, generation: body.sync_generation });
  expect(await env.DB.prepare('SELECT plain_text FROM page_search WHERE page_id = ?').bind(body.id).first('plain_text')).toBe('較新的索引');
  await env.DB.prepare('UPDATE pages SET sync_generation = ? WHERE id = ?').bind('g2', body.id).run();
  await env.DB.prepare('UPDATE page_search SET indexed_generation = ?, indexed_checkpoint = 1, plain_text = ? WHERE page_id = ?').bind('g2', '新世代索引', body.id).run();
  await client.stub.reindex({ owner, page: body.id, generation: body.sync_generation });
  expect(await env.DB.prepare('SELECT plain_text FROM page_search WHERE page_id = ?').bind(body.id).first('plain_text')).toBe('新世代索引');
});

it('PAGE-GUARD-01：暫停／解除失敗保留意圖且停止讀寫，重啟後同操作可重試', async () => {
  for (const phase of ['pause', 'resume']) {
    const page = await note('中斷 ' + phase); const client = await connect(page);
    await commit(client, document('必須保留'), 'before-' + phase);
    await runInDurableObject(client.stub, (_instance, state) => {
      if (phase === 'pause') vi.spyOn(state.storage, 'sync').mockRejectedValueOnce(new Error('測試暫停中斷'));
      else {
        const put = state.storage.put.bind(state.storage);
        vi.spyOn(state.storage, 'put').mockImplementation((...args) => {
          const key: unknown = args[0]; const value: unknown = args[1];
          if (key === 'page-paused' && value === false) throw new Error('測試解除中斷');
          return Reflect.apply(put, state.storage, args);
        });
      }
    });
    expect((await post(`/api/pages/${page.id}/delete`, {})).status).toBe(503);
    expect((await get(`/api/pages/${page.id}`)).status).toBe(503);
    expect((await post('/api/pages', { title: '處理中不可新增' })).status).toBe(409);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM page_operations').first('n')).toBe(1);
    expect((await (await get('/api/trash')).json<{ id: string }[]>()).map(item => item.id)).not.toContain(page.id);
    vi.restoreAllMocks(); await abortAllDurableObjects();
    expect((await post(`/api/pages/${page.id}/delete`, {})).status).toBe(200);
    expect((await get(`/api/pages/${page.id}`)).status).toBe(409);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM page_operations').first('n')).toBe(0);
    await post(`/api/pages/${page.id}/restore`, {});
    const resumed = await connect(page);
    await runInDurableObject(resumed.stub, instance => expect(instance.document.getXmlFragment('body').toString()).toContain('必須保留'));
  }
});
