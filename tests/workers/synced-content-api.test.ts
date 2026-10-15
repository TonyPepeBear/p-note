import { env, exports } from 'cloudflare:workers';
import { createExecutionContext, reset } from 'cloudflare:test';
import { afterEach, expect, it, vi } from 'vitest';
import { authenticated, origin } from './helpers';
import { serveMcp } from '../../src/worker/mcp';
import type { SyncedBlockInfo } from '../../src/shared/synced-blocks';
import type { AppBlock } from '../../src/shared/block-schema';
import { expandSyncedBlocks, SYNCED_BLOCK_EXPANSION_LIMIT } from '../../src/worker/content-api';

afterEach(async () => { await reset(); });
async function setup() {
  const auth = await authenticated(); const page = await auth.note('同步區塊 API');
  const created = await auth.post('/api/synced-blocks', { blocks: [{ type: 'paragraph', content: '共用正文' }] });
  expect(created.status).toBe(200); const block = await created.json<SyncedBlockInfo>();
  const keyInfo = await (await auth.post('/api/keys', { name: '同步區塊' })).json<{ id: string }>();
  const { key } = await (await auth.post(`/api/keys/${keyInfo.id}/reveal`, {})).json<{ key: string }>();
  const send = (path: string, method = 'GET', value?: object, etag?: string) => exports.default.fetch(origin + '/api/v1' + path, {
    method, headers: { Authorization: 'Bearer ' + key, ...(value ? { 'Content-Type': 'application/json' } : {}), ...(etag ? { 'If-Match': etag } : {}) }, body: value ? JSON.stringify(value) : undefined,
  });
  return { auth, page, block, send, pagePath: `/pages/${page.id}/content`, blockPath: `/synced-blocks/${block.id}/content` };
}
const reference = (id: string, blockId = 'reference') => ({ id: blockId, type: 'syncedBlock', props: { syncedBlockId: id } });
async function mcpGrant(a: Awaited<ReturnType<typeof setup>>, scopes = 'notes:read notes:write') {
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO mcp_grants (id, owner_id, name, scopes, created_at, expires_at) VALUES (?, ?, '同步區塊測試', ?, ?, ?)`)
    .bind(id, a.page.owner_id, scopes, a.auth.now, a.auth.now + 3600000).run();
  return id;
}
async function mcp(a: Awaited<ReturnType<typeof setup>>, grant: string, name: string, args: object, scopes = ['notes:read', 'notes:write']) {
  const context = Object.assign(createExecutionContext(), {
    props: { owner: a.page.owner_id, connectionId: grant },
    auth: { token: 'fixture-token', audience: origin + '/mcp', scope: scopes },
  });
  return serveMcp(new Request(origin + '/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }), env, context, () => a.auth.now);
}
async function mcpValue(response: Response): Promise<{ blocks?: unknown[]; etag: string; status?: number; syncedBlocks?: Record<string, { blocks: unknown[] }> }> {
  expect(response.status).toBe(200);
  const value = await response.json<{ result: { content: { text: string }[] } }>();
  return JSON.parse(value.result.content[0].text);
}

it('SB-18：頁面預設只回引用，選擇展開時每個同步區塊各帶正文與 ETag', async () => {
  const a = await setup(); const current = await a.send(a.pagePath);
  const put = await a.send(a.pagePath, 'PUT', { blocks: [reference(a.block.id), reference(a.block.id, 'second-reference')] }, current.headers.get('etag')!);
  expect(put.status).toBe(200);
  const plain = await (await a.send(a.pagePath)).json<{ blocks: unknown[]; syncedBlocks?: unknown }>();
  expect(plain.blocks).toHaveLength(2); expect(plain.syncedBlocks).toBeUndefined(); expect(JSON.stringify(plain)).not.toContain('共用正文');
  const expanded = await (await a.send(a.pagePath + '?expandSyncedBlocks=true')).json<{ blocks: unknown[]; syncedBlocks: Record<string, { blocks: unknown[]; etag: string }> }>();
  expect(expanded.blocks).toEqual(plain.blocks); expect(Object.keys(expanded.syncedBlocks)).toEqual([a.block.id]);
  expect(JSON.stringify(expanded.syncedBlocks[a.block.id].blocks)).toContain('共用正文'); expect(expanded.syncedBlocks[a.block.id].etag).toMatch(/^".+"$/);
  await env.DB.prepare('DELETE FROM page_synced_blocks WHERE synced_block_id = ?').bind(a.block.id).run();
  await env.DB.prepare('DELETE FROM synced_blocks WHERE id = ?').bind(a.block.id).run();
  const unavailable = await (await a.send(a.pagePath + '?expandSyncedBlocks=true')).json<{ blocks: unknown[]; syncedBlocks: Record<string, { status: number; blocks?: unknown[] }> }>();
  expect(unavailable.blocks).toEqual(plain.blocks); expect(unavailable.syncedBlocks[a.block.id].status).toBe(404); expect(unavailable.syncedBlocks[a.block.id].blocks).toBeUndefined();
});

it('SB-18：展開以 UTF-8 JSON 大小限制總量，超限後停止 RPC 並保留明確錯誤', async () => {
  expect(SYNCED_BLOCK_EXPANSION_LIMIT).toBe(8 * 1024 * 1024);
  const blocks: AppBlock[] = [{ id: 'body', type: 'paragraph', props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' }, content: [{ type: 'text', text: '共用資料'.repeat(150), styles: {} }], children: [] }];
  const read = vi.fn(async () => ({ status: 200, blocks, etag: '"current"' }));
  const expanded = await expandSyncedBlocks(['first', 'over-limit', 'not-read'], read, 3000);
  expect(read.mock.calls).toHaveLength(2);
  expect(expanded.first.blocks).toEqual(blocks);
  for (const id of ['over-limit', 'not-read']) { expect(expanded[id].status).toBe(413); expect(expanded[id].blocks).toBeUndefined(); expect(expanded[id].message).toContain('分別讀取'); }
  expect(new TextEncoder().encode(JSON.stringify(expanded)).byteLength).toBeLessThanOrEqual(3000);
});

it('SB-19：同步區塊獨立 ETag 防止競爭覆寫與跨擁有者讀寫', async () => {
  const a = await setup(); const current = await a.send(a.blockPath); expect(current.status).toBe(200);
  const etag = current.headers.get('etag')!;
  expect((await a.send(a.blockPath, 'PUT', { blocks: [] })).status).toBe(428);
  const races = await Promise.all(['第一修改', '另一修改'].map(content => a.send(a.blockPath, 'PUT', { blocks: [{ type: 'paragraph', content }] }, etag)));
  expect(races.map(r => r.status).sort()).toEqual([200, 412]);
  await env.DB.prepare(`INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('foreign-owner', '另一擁有者', 'other@example.test', 1, '2026-10-15', '2026-10-15')`).run();
  await env.DB.prepare(`INSERT INTO synced_blocks (id, owner_id, sync_generation, created_at, updated_at) VALUES ('foreign-block', 'foreign-owner', 'foreign-generation', 1, 1)`).run();
  expect((await a.send('/synced-blocks/foreign-block/content')).status).toBe(404);
  expect((await a.send('/synced-blocks/foreign-block/content', 'PUT', { blocks: [] }, etag)).status).toBe(404);
  const page = await a.send(a.pagePath);
  expect((await a.send(a.pagePath, 'PUT', { blocks: [reference('foreign-block')] }, page.headers.get('etag')!)).status).toBe(400);
  expect((await a.send('/synced-blocks/missing-block/content')).status).toBe(404);
});

it('SB-19：唯讀 MCP 授權不能更新同步區塊，撤銷後也不能繼續讀取', async () => {
  const a = await setup(); const grant = await mcpGrant(a, 'notes:read');
  const read = await mcpValue(await mcp(a, grant, 'get_synced_block_content', { synced_block_id: a.block.id }, ['notes:read']));
  expect(JSON.stringify(read.blocks)).toContain('共用正文');
  const args = { synced_block_id: a.block.id, etag: read.etag, blocks: [] };
  expect((await mcpValue(await mcp(a, grant, 'update_synced_block_content', args))).status).toBe(403);
  await env.DB.prepare("UPDATE mcp_grants SET scopes = 'notes:read notes:write' WHERE id = ?").bind(grant).run();
  expect((await mcpValue(await mcp(a, grant, 'update_synced_block_content', args, ['notes:read']))).status).toBe(403);
  await env.DB.prepare('UPDATE mcp_grants SET revoked_at = ? WHERE id = ?').bind(a.auth.now, grant).run();
  expect((await mcp(a, grant, 'get_synced_block_content', { synced_block_id: a.block.id })).status).toBe(401);
});

it('SB-19：MCP 同步正文使用自己的 ETag，最新版本可以繼續更新', async () => {
  const a = await setup(); const grant = await mcpGrant(a);
  const read = await mcpValue(await mcp(a, grant, 'get_synced_block_content', { synced_block_id: a.block.id }));
  const args = { synced_block_id: a.block.id, etag: read.etag, blocks: [{ type: 'paragraph', content: 'MCP 修改共用正文' }] };
  const put = await mcpValue(await mcp(a, grant, 'update_synced_block_content', args)); expect(put.etag).not.toBe(read.etag);
  expect((await mcpValue(await mcp(a, grant, 'update_synced_block_content', args))).status).toBe(412);
  const next = await mcpValue(await mcp(a, grant, 'update_synced_block_content', { ...args, etag: put.etag, blocks: [{ type: 'paragraph', content: 'MCP 最新正文' }] }));
  expect(JSON.stringify(next.blocks)).toContain('MCP 最新正文');
  expect(JSON.stringify(await (await a.send(a.blockPath)).json())).toContain('MCP 最新正文');
});

it('SB-20：頁面 API 只能改引用，禁止內嵌正文、未知引用與同步區塊巢狀', async () => {
  const a = await setup(); const page = await a.send(a.pagePath); const etag = page.headers.get('etag')!;
  for (const blocks of [
    [{ ...reference(a.block.id), content: '不允許內嵌' }],
    [{ ...reference(a.block.id), children: [{ type: 'paragraph', content: '不允許巢狀' }] }],
    [reference('missing-block')],
  ]) expect((await a.send(a.pagePath, 'PUT', { blocks }, etag)).status).toBe(400);
  expect((await a.send(a.pagePath, 'PUT', { blocks: [reference(a.block.id)], syncedBlocks: { [a.block.id]: { blocks: [] } } }, etag)).status).toBe(400);
  const block = await a.send(a.blockPath);
  expect((await a.send(a.blockPath, 'PUT', { blocks: [reference(a.block.id)] }, block.headers.get('etag')!)).status).toBe(400);
  expect(JSON.stringify(await (await a.send(a.blockPath)).json())).toContain('共用正文');
  const put = await a.send(a.pagePath, 'PUT', { blocks: [reference(a.block.id)] }, etag); expect(put.status).toBe(200);
  expect((await a.send(a.pagePath, 'PUT', { blocks: [] }, put.headers.get('etag')!)).status).toBe(200);
  expect(JSON.stringify(await (await a.send(a.blockPath)).json())).toContain('共用正文');
  const grant = await mcpGrant(a); const read = await mcpValue(await mcp(a, grant, 'get_content', { page_id: a.page.id }));
  const added = await mcpValue(await mcp(a, grant, 'update_content', { page_id: a.page.id, etag: read.etag, blocks: [reference(a.block.id)] }));
  const expanded = await mcpValue(await mcp(a, grant, 'get_content', { page_id: a.page.id, expand_synced_blocks: true }));
  expect(JSON.stringify(expanded.syncedBlocks?.[a.block.id].blocks)).toContain('共用正文');
  expect((await mcpValue(await mcp(a, grant, 'update_content', { page_id: a.page.id, etag: added.etag, blocks: [{ ...reference(a.block.id), content: '無法內嵌修改' }] }))).status).toBe(400);
  await mcpValue(await mcp(a, grant, 'update_content', { page_id: a.page.id, etag: added.etag, blocks: [] }));
  expect(JSON.stringify(await (await a.send(a.blockPath)).json())).toContain('共用正文');
});
