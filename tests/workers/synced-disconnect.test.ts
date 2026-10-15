import { env, exports } from 'cloudflare:workers';
import { reset } from 'cloudflare:test';
import { afterEach, expect, it } from 'vitest';
import { toBase64 } from 'lib0/buffer';
import { authenticated, connect, origin } from './helpers';
import type { SyncedBlockInfo } from '../../src/shared/synced-blocks';

const sockets: WebSocket[] = [];
afterEach(async () => { for (const socket of sockets.splice(0)) socket.close(); await reset(); });

it('SB-18：引用改目標並關閉舊房間後，孤立同步區塊正文仍能立即讀取', async () => {
  const auth = await authenticated(); const page = await auth.note('切換引用目標');
  const create = async (content: string) => {
    const response = await auth.post('/api/synced-blocks', { blocks: [{ type: 'paragraph', content }] });
    expect(response.status).toBe(200); return response.json<SyncedBlockInfo>();
  };
  const original = await create('舊目標正文'); const target = await create('新目標正文');
  const keyInfo = await (await auth.post('/api/keys', { name: '引用關閉測試' })).json<{ id: string }>();
  const { key } = await (await auth.post(`/api/keys/${keyInfo.id}/reveal`, {})).json<{ key: string }>();
  const send = (path: string, blocks?: unknown[], etag?: string) => exports.default.fetch(origin + '/api/v1' + path, {
    method: blocks ? 'PUT' : 'GET', headers: { Authorization: 'Bearer ' + key, ...(blocks ? { 'Content-Type': 'application/json' } : {}), ...(etag ? { 'If-Match': etag } : {}) }, body: blocks ? JSON.stringify({ blocks }) : undefined,
  });
  const pagePath = `/pages/${page.id}/content`;
  const references = (id: string) => [
    { id: 'retained-reference', type: 'syncedBlock', props: { syncedBlockId: id } },
    { id: 'existing-target-reference', type: 'syncedBlock', props: { syncedBlockId: target.id } },
  ];
  const initial = await send(pagePath);
  expect((await send(pagePath, references(original.id), initial.headers.get('etag')!)).status).toBe(200);
  const parent = await connect(page, auth.cookie); sockets.push(parent.socket);
  const openBlock = async (block: SyncedBlockInfo) => {
    const response = await exports.default.fetch(`${origin}/parties/sync/${block.room}?syncedBlock=${block.id}&page=${page.id}&generation=${block.sync_generation}`, { headers: { Cookie: auth.cookie, Origin: origin, Upgrade: 'websocket' } });
    expect(response.status).toBe(101); const socket = response.webSocket!; socket.binaryType = 'arraybuffer'; socket.accept(); sockets.push(socket);
    return { socket };
  };
  const old = await openBlock(original); const active = await openBlock(target);
  const oldState = await env.SYNC.getByName(original.room).capture({ owner: page.owner_id, page: original.id, generation: original.sync_generation, kind: 'syncedBlock' });
  const current = await send(pagePath);
  expect((await send(pagePath, references(target.id), current.headers.get('etag')!)).status).toBe(200);
  // 舊引用已失效的更新與客戶端關閉，可和下一筆正文 RPC 同時發生。
  old.socket.send('__YPS:' + JSON.stringify({ type: 'commit', id: 'old-target-update', update: toBase64(oldState.data) }));
  old.socket.close();
  const [originalBody, targetBody] = await Promise.all([
    send(`/synced-blocks/${original.id}/content`), send(`/synced-blocks/${target.id}/content`),
  ]);
  expect(originalBody.status).toBe(200); expect(targetBody.status).toBe(200);
  expect(JSON.stringify(await originalBody.json())).toContain('舊目標正文');
  expect(JSON.stringify(await targetBody.json())).toContain('新目標正文');
  expect(old.socket.readyState).toBeGreaterThan(1);
  expect((await auth.get('/api/synced-blocks')).status).toBe(200);
  active.socket.close(); parent.socket.close();
});
