import { env, exports } from 'cloudflare:workers';
import { abortAllDurableObjects, reset } from 'cloudflare:test';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { blocksToYDoc } from '@blocknote/core/yjs';
import { authenticated, connect, commit, origin } from './helpers';
import { blockEditor } from '../../src/worker/block-json';
import type { SyncedBlockInfo } from '../../src/shared/synced-blocks';

const sockets: WebSocket[] = [];
afterEach(async () => { for (const socket of sockets.splice(0)) socket.close(); await reset(); });
async function setup() {
  const auth = await authenticated(); const page = await auth.note('同步來源');
  const response = await auth.post('/api/synced-blocks', { blocks: [{ type: 'paragraph', content: '共用內容' }] });
  expect(response.status).toBe(200); const block = await response.json<SyncedBlockInfo>();
  return { auth, page, block };
}
async function reference(a: Awaited<ReturnType<typeof setup>>, page = a.page, count = 1) {
  const client = await connect(page, a.auth.cookie); sockets.push(client.socket);
  const doc = blocksToYDoc(blockEditor(), Array.from({ length: count }, (_, n) => ({ id: 'ref-' + n, type: 'syncedBlock' as never, props: { syncedBlockId: a.block.id } })), 'body');
  expect((await commit(client, doc, 'reference')).type).toBe('persisted'); doc.destroy();
}
async function blockSocket(a: Awaited<ReturnType<typeof setup>>, page = a.page) {
  const response = await exports.default.fetch(`${origin}/parties/sync/${a.block.room}?syncedBlock=${a.block.id}&page=${page.id}&generation=${a.block.sync_generation}`, { headers: { Cookie: a.auth.cookie, Origin: origin, Upgrade: 'websocket' } });
  expect(response.status).toBe(101); const socket = response.webSocket!; socket.binaryType = 'arraybuffer'; socket.accept(); sockets.push(socket); const messages: (string | ArrayBuffer)[] = [];
  let closed = false; socket.addEventListener('close', () => { closed = true; });
  socket.addEventListener('message', event => { messages.push(event.data); }); return { socket, messages, stub: env.SYNC.getByName(a.block.room), get closed() { return closed; } };
}
function blockScope(a: Awaited<ReturnType<typeof setup>>) {
  return { owner: a.page.owner_id, page: a.block.id, generation: a.block.sync_generation, kind: 'syncedBlock' as const };
}
async function removeReferences(a: Awaited<ReturnType<typeof setup>>, page = a.page) {
  const client = await connect(page, a.auth.cookie); sockets.push(client.socket);
  const doc = new Y.Doc(); Y.applyUpdate(doc, (await client.stub.capture({ owner: page.owner_id, page: page.id, generation: page.sync_generation })).data);
  const fragment = doc.getXmlFragment('body'); fragment.delete(0, fragment.length);
  expect((await commit(client, doc, 'remove-reference')).type).toBe('persisted'); doc.destroy();
}
it('SB-12：建立共用正文且同頁重複引用只算一頁，垃圾桶不列入引用', async () => {
  const a = await setup(); await reference(a, a.page, 2);
  const second = await a.auth.note('另一引用頁'); await reference(a, second);
  const refs = () => a.auth.get(`/api/synced-blocks/${a.block.id}/references`).then(r => r.json());
  expect(await refs()).toMatchObject({ count: 2, pages: expect.arrayContaining([{ id: a.page.id, title: '同步來源', kind: 'note' }, { id: second.id, title: '另一引用頁', kind: 'note' }]) });
  await a.auth.post(`/api/pages/${second.id}/delete`, {}); expect(await refs()).toMatchObject({ count: 1 });
  expect((await a.auth.get(`/api/synced-blocks/${a.block.id}`)).status).toBe(200);
  await a.auth.post(`/api/pages/${second.id}/restore`, {}); expect(await refs()).toMatchObject({ count: 2 });
});
it('SB-15：沒有引用、錯誤世代及外部來源拒絕同步連線', async () => {
  const a = await setup(); const send = (generation: string, originValue = origin) => exports.default.fetch(`${origin}/parties/sync/${a.block.room}?syncedBlock=${a.block.id}&page=${a.page.id}&generation=${generation}`, { headers: { Cookie: a.auth.cookie, Origin: originValue, Upgrade: 'websocket' } });
  expect((await send(a.block.sync_generation)).status).toBe(409); await reference(a);
  expect((await send('old-generation')).status).toBe(409); expect((await send(a.block.sync_generation, 'https://other.example.test')).status).toBe(403);
});
it('SB-15：刪除引用後舊連線拒絕更新，共用正文仍保留', async () => {
  const a = await setup(); await reference(a); const client = await blockSocket(a); let closed = false; client.socket.addEventListener('close', () => { closed = true; });
  await removeReferences(a);
  client.socket.send('__YPS:' + JSON.stringify({ type: 'commit', id: 'denied', update: 'AAA=' }));
  await vi.waitFor(() => expect(closed).toBe(true));
  expect((await a.auth.get(`/api/synced-blocks/${a.block.id}`)).status).toBe(200);
});
it('SB-10：最後一個引用移除後保留正文與世代，引用清單仍能找回孤立區塊', async () => {
  const a = await setup(); await reference(a); const client = await blockSocket(a); const before = await client.stub.capture(blockScope(a));
  await removeReferences(a);
  const list = await (await a.auth.get('/api/synced-blocks')).json<(SyncedBlockInfo & { reference_count: number })[]>();
  expect(list.find(item => item.id === a.block.id)).toMatchObject({ sync_generation: a.block.sync_generation, reference_count: 0 });
  expect(await (await a.auth.get(`/api/synced-blocks/${a.block.id}/references`)).json()).toEqual({ count: 0, pages: [] });
  expect((await client.stub.capture(blockScope(a))).data).toEqual(before.data);
  await reference(a); const restored = await blockSocket(a);
  expect((await restored.stub.capture(blockScope(a))).data).toEqual(before.data);
});
it('SB-03：共用正文持久化、可備份 capture 且拒絕巢狀同步區塊', async () => {
  const a = await setup(); await reference(a); const client = await blockSocket(a);
  const scope = { owner: a.page.owner_id, page: a.block.id, generation: a.block.sync_generation, kind: 'syncedBlock' as const };
  const captured = await client.stub.capture(scope); const doc = new Y.Doc(); Y.applyUpdate(doc, captured.data);
  expect(doc.getXmlFragment('body').toString()).toContain('共用內容'); doc.destroy();
  const nested = blocksToYDoc(blockEditor(), [{ type: 'syncedBlock' as never, props: { syncedBlockId: a.block.id } }], 'body');
  expect((await commit(client, nested, 'nested')).type).toBe('error'); nested.destroy();
  const textBody = new Y.Doc(); textBody.getText('body').insert(0, '非區塊正文');
  expect((await commit(client, textBody, 'text-body')).type).toBe('error');
  const page = await connect(a.page, a.auth.cookie); sockets.push(page.socket);
  expect((await commit(page, textBody, 'mixed-body')).type).toBe('error'); textBody.destroy();
  await abortAllDurableObjects(); expect((await env.SYNC.getByName(a.block.room).capture(scope)).data).toEqual(captured.data);
});
it('SB-04：任一引用提交後其他引用即時收到持久保存的 Yjs 更新', async () => {
  const a = await setup(); await reference(a); const second = await a.auth.note('雙向同步'); await reference(a, second);
  const first = await blockSocket(a); const peer = await blockSocket(a, second);
  const scope = { owner: a.page.owner_id, page: a.block.id, generation: a.block.sync_generation, kind: 'syncedBlock' as const };
  const doc = new Y.Doc(); Y.applyUpdate(doc, (await first.stub.capture(scope)).data);
  const text = Array.from(doc.getXmlFragment('body').createTreeWalker(node => node instanceof Y.XmlText))[0] as Y.XmlText;
  text.insert(0, '兩頁一致'); expect((await commit(first, doc, 'edit-shared')).type).toBe('persisted');
  await vi.waitFor(() => expect(peer.messages.some(message => typeof message !== 'string' && new Uint8Array(message)[1] === 2)).toBe(true));
  const captured = new Y.Doc(); Y.applyUpdate(captured, (await first.stub.capture(scope)).data);
  expect(captured.getXmlFragment('body').toString()).toContain('兩頁一致共用內容'); doc.destroy(); captured.destroy();
});
it('SB-05：同步區塊保存故障不確認不廣播，重試後才持久保存並同步', async () => {
  const a = await setup(); await reference(a); const client = await blockSocket(a); const peer = await blockSocket(a);
  const original = await client.stub.capture(blockScope(a)); const doc = new Y.Doc(); Y.applyUpdate(doc, original.data);
  (Array.from(doc.getXmlFragment('body').createTreeWalker(node => node instanceof Y.XmlText))[0] as Y.XmlText).insert(0, '重試保存');
  peer.messages.length = 0;
  await a.auth.post('/__test/storage-failure', { room: a.block.room, fail: true });
  expect((await commit(client, doc, 'failed-commit')).type).toBe('error');
  expect(client.messages.some(message => typeof message === 'string' && message.includes('"persisted"') && message.includes('failed-commit'))).toBe(false);
  expect(peer.messages.some(message => typeof message !== 'string' && new Uint8Array(message)[1] === 2)).toBe(false);
  expect((await client.stub.capture(blockScope(a))).data).toEqual(original.data);
  await a.auth.post('/__test/storage-failure', { room: a.block.room, fail: false });
  expect((await commit(client, doc, 'retry-commit')).type).toBe('persisted');
  await vi.waitFor(() => expect(peer.messages.some(message => typeof message !== 'string' && new Uint8Array(message)[1] === 2)).toBe(true));
  const saved = await client.stub.capture(blockScope(a)); const restored = new Y.Doc(); Y.applyUpdate(restored, saved.data);
  expect(restored.getXmlFragment('body').toString()).toContain('重試保存共用內容');
  expect(saved.checkpoint).toBeGreaterThan(original.checkpoint); doc.destroy(); restored.destroy();
});
it('SB-11：頁面丟垃圾桶及還原只改引用狀態，另一頁仍能編輯原世代', async () => {
  const a = await setup(); await reference(a); const second = await a.auth.note('持續編輯'); await reference(a, second);
  const trashed = await blockSocket(a); const active = await blockSocket(a, second);
  expect((await a.auth.post(`/api/pages/${a.page.id}/delete`, {})).status).toBe(200);
  const doc = new Y.Doc(); Y.applyUpdate(doc, (await active.stub.capture(blockScope(a))).data);
  (Array.from(doc.getXmlFragment('body').createTreeWalker(node => node instanceof Y.XmlText))[0] as Y.XmlText).insert(0, '垃圾桶期間');
  expect((await commit(active, doc, 'while-trashed')).type).toBe('persisted');
  await vi.waitFor(() => expect(trashed.closed).toBe(true));
  expect(await (await a.auth.get(`/api/synced-blocks/${a.block.id}`)).json()).toMatchObject({ sync_generation: a.block.sync_generation });
  expect(await (await a.auth.get(`/api/synced-blocks/${a.block.id}/references`)).json()).toMatchObject({ count: 1, pages: [{ id: second.id }] });
  expect((await a.auth.post(`/api/pages/${a.page.id}/restore`, {})).status).toBe(200);
  expect(await (await a.auth.get(`/api/synced-blocks/${a.block.id}/references`)).json()).toMatchObject({ count: 2 });
  expect(await (await a.auth.get(`/api/synced-blocks/${a.block.id}`)).json()).toMatchObject({ sync_generation: a.block.sync_generation });
  const restored = await blockSocket(a); const recovered = new Y.Doc(); Y.applyUpdate(recovered, (await restored.stub.capture(blockScope(a))).data);
  expect(recovered.getXmlFragment('body').toString()).toContain('垃圾桶期間共用內容'); doc.destroy(); recovered.destroy();
});
it('SB-06：單一同步區塊保存失敗不污染原文，頁面仍可繼續編輯', async () => {
  const a = await setup(); await reference(a); const client = await blockSocket(a);
  const scope = { owner: a.page.owner_id, page: a.block.id, generation: a.block.sync_generation, kind: 'syncedBlock' as const };
  const original = await client.stub.capture(scope); const doc = new Y.Doc(); Y.applyUpdate(doc, original.data);
  (Array.from(doc.getXmlFragment('body').createTreeWalker(node => node instanceof Y.XmlText))[0] as Y.XmlText).insert(0, '保存故障');
  await a.auth.post('/__test/storage-failure', { room: a.block.room, fail: true });
  expect((await commit(client, doc, 'failed')).type).toBe('error');
  expect((await client.stub.capture(scope)).data).toEqual(original.data);
  const page = await connect(a.page, a.auth.cookie); sockets.push(page.socket);
  const pageDoc = blocksToYDoc(blockEditor(), [{ type: 'paragraph', content: '頁面可獨立編輯' }], 'body');
  expect((await commit(page, pageDoc, 'page-independent')).type).toBe('persisted');
  doc.destroy(); pageDoc.destroy();
});
