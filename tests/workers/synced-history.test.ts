import { env, exports } from 'cloudflare:workers';
import { reset } from 'cloudflare:test';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { authenticated, commit, origin } from './helpers';
import type { PageInfo } from '../../src/shared/pages';
import type { PageVersion, PageVersionRestore } from '../../src/shared/history';
import type { SyncedBlockInfo } from '../../src/shared/synced-blocks';

const sockets: WebSocket[] = [];
afterEach(async () => { for (const socket of sockets.splice(0)) socket.close(); await reset(); });
async function setup() {
  const auth = await authenticated(); const page = await auth.note('同步引用版本歷史');
  const response = await auth.post('/api/synced-blocks', { blocks: [{ type: 'paragraph', content: '共用正文' }] });
  expect(response.status).toBe(200); const block = await response.json<SyncedBlockInfo>();
  const keyInfo = await (await auth.post('/api/keys', { name: '引用歷史測試' })).json<{ id: string }>();
  const { key } = await (await auth.post(`/api/keys/${keyInfo.id}/reveal`, {})).json<{ key: string }>();
  const send = (path: string, blocks?: unknown[], etag?: string) => exports.default.fetch(origin + '/api/v1' + path, {
    method: blocks ? 'PUT' : 'GET', headers: { Authorization: 'Bearer ' + key, ...(blocks ? { 'Content-Type': 'application/json' } : {}), ...(etag ? { 'If-Match': etag } : {}) }, body: blocks ? JSON.stringify({ blocks }) : undefined,
  });
  const reference = async (target = page) => {
    const path = `/pages/${target.id}/content`; const current = await send(path);
    expect((await send(path, [{ id: 'reference', type: 'syncedBlock', props: { syncedBlockId: block.id } }], current.headers.get('etag')!)).status).toBe(200);
  };
  const socket = async (target = page) => {
    const response = await exports.default.fetch(`${origin}/parties/sync/${block.room}?syncedBlock=${block.id}&page=${target.id}&pageGeneration=${target.sync_generation}&generation=${block.sync_generation}`, { headers: { Cookie: auth.cookie, Origin: origin, Upgrade: 'websocket' } });
    expect(response.status).toBe(101); const socket = response.webSocket!; socket.binaryType = 'arraybuffer'; socket.accept(); sockets.push(socket);
    const messages: (string | ArrayBuffer)[] = []; let closed = false;
    socket.addEventListener('message', event => { messages.push(event.data); }); socket.addEventListener('close', () => { closed = true; });
    return { socket, messages, stub: env.SYNC.getByName(block.room), get closed() { return closed; } };
  };
  const scope = { owner: page.owner_id, page: block.id, generation: block.sync_generation, kind: 'syncedBlock' as const };
  return { auth, page, block, send, reference, socket, scope };
}
it('SB-19：同步區塊經 WebSocket 與正文 API 修改時不建立頁面歷史', async () => {
  const a = await setup(); await a.reference(); const client = await a.socket();
  const doc = new Y.Doc(); Y.applyUpdate(doc, (await client.stub.capture(a.scope)).data);
  const text = Array.from(doc.getXmlFragment('body').createTreeWalker(node => node instanceof Y.XmlText))[0] as Y.XmlText;
  text.insert(0, '即時修改'); expect((await commit(client, doc, 'block-history-skip')).type).toBe('persisted'); doc.destroy();
  const path = `/synced-blocks/${a.block.id}/content`; const current = await a.send(path);
  expect((await a.send(path, [{ type: 'paragraph', content: 'API 共用修改' }], current.headers.get('etag')!)).status).toBe(200);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM page_versions WHERE page_id = ?').bind(a.block.id).first('n')).toBe(0);
  expect(JSON.stringify(await (await a.send(path)).json())).toContain('API 共用修改');
});
it('SB-15 HIST-03：單頁歷史還原恢復引用且隔離該頁舊連線，其他頁持續編輯同一同步世代', async () => {
  const a = await setup(); await a.reference(); const other = await a.auth.note('不受影響的引用'); await a.reference(other);
  const old = await a.socket(); const peer = await a.socket(other);
  const versionResponse = await a.auth.post(`/api/pages/${a.page.id}/history`, {}); expect(versionResponse.status).toBe(201);
  const version = await versionResponse.json<PageVersion>(); const before = await old.stub.capture(a.scope);
  const current = await a.send(`/pages/${a.page.id}/content`);
  expect((await a.send(`/pages/${a.page.id}/content`, [{ type: 'paragraph', content: '還原前頁面' }], current.headers.get('etag')!)).status).toBe(200);
  const response = await a.auth.post(`/api/pages/${a.page.id}/history/${version.id}/restore`, { request_id: crypto.randomUUID() }); expect(response.status).toBe(200);
  const restored = await response.json<PageVersionRestore>(); expect(restored.page.sync_generation).not.toBe(a.page.sync_generation);
  expect((await old.stub.capture(a.scope)).data).toEqual(before.data);
  const metadata = await (await a.auth.get(`/api/synced-blocks/${a.block.id}`)).json<SyncedBlockInfo>(); expect(metadata.sync_generation).toBe(a.block.sync_generation);
  old.socket.send('__YPS:' + JSON.stringify({ type: 'commit', id: 'stale-reference-generation', update: 'AAA=' }));
  await vi.waitFor(() => expect(old.closed).toBe(true));
  const rejected = await exports.default.fetch(`${origin}/parties/sync/${a.block.room}?syncedBlock=${a.block.id}&page=${a.page.id}&pageGeneration=${a.page.sync_generation}&generation=${a.block.sync_generation}`, { headers: { Cookie: a.auth.cookie, Origin: origin, Upgrade: 'websocket' } });
  expect(rejected.status).toBe(409);
  const reopened = await a.socket(restored.page as PageInfo); const doc = new Y.Doc(); Y.applyUpdate(doc, before.data);
  (Array.from(doc.getXmlFragment('body').createTreeWalker(node => node instanceof Y.XmlText))[0] as Y.XmlText).insert(0, '其他頁修改');
  expect((await commit(peer, doc, 'other-page-still-current')).type).toBe('persisted'); doc.destroy();
  const after = new Y.Doc(); Y.applyUpdate(after, (await reopened.stub.capture(a.scope)).data);
  expect(after.getXmlFragment('body').toString()).toContain('其他頁修改共用正文'); after.destroy();
  expect(await (await a.auth.get(`/api/synced-blocks/${a.block.id}/references`)).json()).toMatchObject({ count: 2 });
});
it('SB-15 HIST-03：歷史引用的同步區塊不存在或已屬別人時，還原在暫停頁面前拒絕', async () => {
  const a = await setup(); await a.reference();
  const version = await (await a.auth.post(`/api/pages/${a.page.id}/history`, {})).json<PageVersion>();
  const path = `/pages/${a.page.id}/content`; const current = await a.send(path);
  expect((await a.send(path, [{ type: 'paragraph', content: '仍保留目前正文' }], current.headers.get('etag')!)).status).toBe(200);
  await env.DB.prepare("INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('history-foreign-block-owner', '其他人', 'other@example.test', 1, '2026-10-15', '2026-10-15')").run();
  await env.DB.prepare('DELETE FROM synced_block_search WHERE synced_block_id = ?').bind(a.block.id).run();
  await env.DB.prepare("UPDATE synced_blocks SET owner_id = 'history-foreign-block-owner' WHERE id = ?").bind(a.block.id).run();
  for (const remove of [false, true]) {
    if (remove) await env.DB.prepare('DELETE FROM synced_blocks WHERE id = ?').bind(a.block.id).run();
    const response = await a.auth.post(`/api/pages/${a.page.id}/history/${version.id}/restore`, { request_id: crypto.randomUUID() }); expect(response.status).toBe(400);
    expect(await env.DB.prepare('SELECT sync_generation FROM pages WHERE id = ?').bind(a.page.id).first('sync_generation')).toBe(a.page.sync_generation);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM page_operations').first('n')).toBe(0);
    expect(JSON.stringify(await (await a.send(path)).json())).toContain('仍保留目前正文');
  }
});
