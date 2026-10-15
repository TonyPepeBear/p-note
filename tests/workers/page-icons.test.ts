import { env, exports } from 'cloudflare:workers';
import { reset } from 'cloudflare:test';
import { afterEach, expect, it } from 'vitest';
import { authenticated, origin } from './helpers';
import { serveMcp } from '../../src/worker/mcp';
import type { PageInfo } from '../../src/shared/pages';
import type { PageVersion } from '../../src/shared/history';

type IconPage = PageInfo & { icon: string | null };
type ToolReply = { result: { content: { type: string; text: string }[]; isError?: boolean; tools?: { name: string; inputSchema: Record<string, unknown> }[] } };
afterEach(async () => { await reset(); });

it('ICON-03：筆記與日記圖示可建立、更換和移除，並更新中繼資料版本', async () => {
  const auth = await authenticated(); const empty = await auth.note('既有無圖示筆記');
  expect((empty as IconPage).icon).toBeNull();
  for (const icon of ['📝', '👩🏽‍💻', '🇹🇼', '1️⃣', '👨‍👩‍👧‍👦', '☀️']) {
    const response = await auth.post('/api/pages', { title: '有圖示筆記', icon });
    expect(response.status).toBe(200);
    const page = await response.json<IconPage>(); expect(page.icon).toBe(icon);
    await auth.post('/__test/control', { now: auth.now + 60000 });
    const changed = await (await auth.post(`/api/pages/${page.id}/icon`, { icon: '📚' })).json<IconPage>();
    expect(changed).toMatchObject({ icon: '📚', metadata_revision: page.metadata_revision + 1, updated_at: auth.now + 60000, sync_generation: page.sync_generation });
    expect((await (await auth.get(`/api/pages/${page.id}`)).json<IconPage>()).icon).toBe('📚');
    const removed = await (await auth.post(`/api/pages/${page.id}/icon`, { icon: null })).json<IconPage>();
    expect(removed).toMatchObject({ icon: null, metadata_revision: page.metadata_revision + 2 });
  }
  const journal = await auth.today();
  expect((await auth.post(`/api/pages/${journal.id}/icon`, { icon: '📅' })).status).toBe(200);
  expect(await (await auth.get(`/api/journals?month=${journal.journal_date!.slice(0, 7)}`)).json()).toMatchObject([{ id: journal.id, icon: '📅' }]);
});

it('ICON-03：拒絕非單一 emoji 與缺少圖示欄位，失敗不修改原圖示', async () => {
  const auth = await authenticated(); const page = await auth.note('圖示驗證');
  expect((await auth.post(`/api/pages/${page.id}/icon`, { icon: '📝' })).status).toBe(200);
  for (const icon of ['', '文字', 'a', '1', '#', '📝📚', '👩‍', '<img>', '📝'.repeat(3000), true, 1, {}]) {
    expect((await auth.post('/api/pages', { title: '不得建立', icon })).status).toBe(400);
    expect((await auth.post(`/api/pages/${page.id}/icon`, { icon })).status).toBe(400);
  }
  expect((await auth.post(`/api/pages/${page.id}/icon`, {})).status).toBe(400);
  expect(await (await auth.get(`/api/pages/${page.id}`)).json()).toMatchObject({ icon: '📝', metadata_revision: 1 });
});

it('ICON-03：列表、搜尋、上層、反向連結與資料庫列都帶回圖示', async () => {
  const auth = await authenticated();
  const database = await (await auth.post('/api/databases', { title: '圖示資料庫' })).json<IconPage>();
  const source = await (await auth.post('/api/pages', { title: '可搜尋圖示筆記', icon: '🔎', parent_id: database.id })).json<IconPage>();
  const target = await auth.note('被連結筆記');
  await auth.post(`/api/pages/${database.id}/icon`, { icon: '🗃️' });
  await env.DB.prepare('INSERT INTO page_search (page_id, owner_id, plain_text, summary, indexed_generation, indexed_checkpoint, linked_pages) VALUES (?, ?, ?, ?, ?, 0, ?)')
    .bind(source.id, source.owner_id, '', '', source.sync_generation, JSON.stringify([target.id])).run();
  expect(await (await auth.get('/api/pages')).json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: source.id, icon: '🔎' })]));
  expect(await (await auth.get('/api/search?q=可搜尋圖示')).json()).toMatchObject([{ id: source.id, icon: '🔎' }]);
  expect(await (await auth.get(`/api/pages/${source.id}`)).json()).toMatchObject({ ancestors: [{ id: database.id, icon: '🗃️' }] });
  expect(await (await auth.get(`/api/pages/${target.id}/backlinks`)).json()).toMatchObject([{ id: source.id, icon: '🔎', metadata_revision: source.metadata_revision, sync_generation: source.sync_generation }]);
  expect(await (await auth.get(`/api/databases/${database.id}`)).json()).toMatchObject({ page: { icon: '🗃️' }, rows: [{ id: source.id, icon: '🔎' }] });
});

it('ICON-03：資料庫頁面與子列的圖示變更會使條件讀取更新版本', async () => {
  const auth = await authenticated();
  const database = await (await auth.post('/api/databases', { title: '條件讀取圖示' })).json<IconPage>();
  const row = await (await auth.post('/api/pages', { title: '圖示資料列', parent_id: database.id })).json<IconPage>();
  const read = (etag?: string) => exports.default.fetch(`${origin}/api/databases/${database.id}`, {
    headers: { Cookie: auth.cookie, ...(etag ? { 'If-None-Match': etag } : {}) },
  });
  let response = await read(); expect(response.status).toBe(200);
  let etag = response.headers.get('ETag')!;
  expect((await read(etag)).status).toBe(304);
  for (const page of [database, row]) {
    expect((await auth.post(`/api/pages/${page.id}/icon`, { icon: '📝' })).status).toBe(200);
    response = await read(etag); expect(response.status).toBe(200);
    expect(response.headers.get('ETag')).not.toBe(etag); etag = response.headers.get('ETag')!;
    expect(await response.json()).toMatchObject(page.id === database.id ? { page: { icon: '📝' } } : { rows: [{ id: row.id, icon: '📝' }] });
    expect((await read(etag)).status).toBe(304);
    // 圖示本身也是回應內容，即使只改圖示欄位，資料庫快取仍須失效。
    await env.DB.prepare('UPDATE pages SET icon = ? WHERE id = ?').bind('📚', page.id).run();
    response = await read(etag); expect(response.status).toBe(200);
    expect(response.headers.get('ETag')).not.toBe(etag); etag = response.headers.get('ETag')!;
    expect(await response.json()).toMatchObject(page.id === database.id ? { page: { icon: '📚' } } : { rows: [{ id: row.id, icon: '📚' }] });
    expect((await read(etag)).status).toBe(304);
  }
});

it('ICON-03：圖示更新沿用登入、來源、所有權與可見性限制', async () => {
  const auth = await authenticated(); const page = await auth.note('受保護圖示');
  const path = `/api/pages/${page.id}/icon`;
  expect((await exports.default.fetch(origin + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ icon: '📝' }) })).status).toBe(401);
  expect((await exports.default.fetch(origin + path, { method: 'POST', headers: { Origin: 'https://other.example.test', Cookie: auth.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ icon: '📝' }) })).status).toBe(403);
  expect((await auth.post('/api/pages/missing/icon', { icon: '📝' })).status).toBe(404);
  const stamp = new Date().toISOString();
  await env.DB.prepare('INSERT INTO user VALUES (?, ?, ?, 1, NULL, ?, ?)').bind('other-owner', '其他使用者', 'other@example.test', stamp, stamp).run();
  await env.DB.prepare("INSERT INTO pages (id, owner_id, kind, title, sync_generation, created_at, updated_at) VALUES ('foreign', 'other-owner', 'note', '他人的筆記', 'g1', 0, 0)").run();
  expect((await auth.post('/api/pages/foreign/icon', { icon: '📝' })).status).toBe(404);
  await auth.post(`/api/pages/${page.id}/delete`, {});
  expect((await auth.post(path, { icon: '📝' })).status).toBe(409);
  expect(await env.DB.prepare('SELECT icon FROM pages WHERE id = ?').bind(page.id).first('icon')).toBeNull();
});

it('ICON-03：API key 可以建立、讀取與移除圖示，撤銷後不能寫入', async () => {
  const auth = await authenticated();
  const k = await (await auth.post('/api/keys', { name: '圖示 API' })).json<{ id: string }>();
  const { key } = await (await auth.post(`/api/keys/${k.id}/reveal`, {})).json<{ key: string }>();
  const send = (path: string, value?: object) => exports.default.fetch(origin + '/api/v1' + path, { method: value ? 'POST' : 'GET', headers: { Authorization: `Bearer ${key}`, ...(value ? { 'Content-Type': 'application/json' } : {}) }, body: value ? JSON.stringify(value) : undefined });
  const created = await send('/pages', { title: 'API 圖示筆記', icon: '🔌' }); expect(created.status).toBe(200);
  const page = await created.json<IconPage>(); expect(page.icon).toBe('🔌');
  expect((await send(`/pages/${page.id}/icon`, { icon: '🧩' })).status).toBe(200);
  expect(await (await send(`/pages/${page.id}`)).json()).toMatchObject({ icon: '🧩' });
  expect((await send(`/pages/${page.id}/icon`, { icon: null })).status).toBe(200);
  await auth.post(`/api/keys/${k.id}/revoke`, {});
  expect((await send(`/pages/${page.id}/icon`, { icon: '🔌' })).status).toBe(401);
});

it('ICON-03：版本還原中斷時登入、API key 與 MCP 均不能修改圖示，完成後解除鎖定', async () => {
  const auth = await authenticated();
  const page = await auth.result(auth.post('/api/pages', { title: '還原中的圖示', icon: '📝' }));
  const other = await auth.note('同帳號另一頁');
  const versionResponse = await auth.post(`/api/pages/${page.id}/history`, {}); expect(versionResponse.status).toBe(201);
  const version = await versionResponse.json<PageVersion>();
  const keyInfo = await (await auth.post('/api/keys', { name: '版本鎖定圖示 API' })).json<{ id: string }>();
  const { key } = await (await auth.post(`/api/keys/${keyInfo.id}/reveal`, {})).json<{ key: string }>();
  const grantId = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO mcp_grants (id, owner_id, name, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(grantId, page.owner_id, '版本鎖定圖示 MCP', 'notes:read notes:write', auth.now, auth.now + 86400000).run();
  const requestId = crypto.randomUUID();
  await env.DB.exec("CREATE TRIGGER icon_history_failure BEFORE INSERT ON page_versions WHEN NEW.reason = 'before_restore' BEGIN SELECT RAISE(ABORT, '測試圖示版本鎖定'); END");
  const restore = () => auth.post(`/api/pages/${page.id}/history/${version.id}/restore`, { request_id: requestId });
  expect((await restore()).status).toBe(503);
  for (const target of [page, other]) {
    expect((await auth.post(`/api/pages/${target.id}/icon`, { icon: '🔒' })).status).toBe(503);
    const response = await exports.default.fetch(`${origin}/api/v1/pages/${target.id}/icon`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ icon: '🔒' }),
    });
    expect(response.status).toBe(target.id === page.id ? 404 : 409);
  }
  const mcp = await serveMcp(new Request(origin + '/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'set_page_icon', arguments: { page_id: other.id, icon: '🔒' } } }),
  }), env, { props: { owner: page.owner_id, connectionId: grantId }, auth: { scope: ['notes:read', 'notes:write'] } } as Parameters<typeof serveMcp>[2], () => auth.now);
  const denied = await mcp.json<ToolReply>(); expect(denied.result.isError).toBe(true);
  expect(JSON.parse(denied.result.content[0].text)).toMatchObject({ status: 409 });
  for (const original of [page, other]) {
    expect(await env.DB.prepare('SELECT icon, metadata_revision FROM pages WHERE id = ?').bind(original.id).first()).toEqual({ icon: original.icon, metadata_revision: original.metadata_revision });
  }
  await env.DB.exec('DROP TRIGGER icon_history_failure');
  expect((await restore()).status).toBe(200);
  expect((await auth.post(`/api/pages/${page.id}/icon`, { icon: '📚' })).status).toBe(200);
  expect(await (await auth.get(`/api/pages/${page.id}`)).json()).toMatchObject({ icon: '📚' });
});

it('ICON-03：MCP 可建立與設定圖示，唯讀 token 和 grant 均不能寫入', async () => {
  const auth = await authenticated(); const page = await auth.note('MCP 圖示筆記'); const grantId = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO mcp_grants (id, owner_id, name, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(grantId, page.owner_id, '圖示 MCP', 'notes:read notes:write', auth.now, auth.now + 86400000).run();
  const call = (method: string, params: object, scopes = ['notes:read', 'notes:write']) => serveMcp(new Request(origin + '/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }), env, { props: { owner: page.owner_id, connectionId: grantId }, auth: { scope: scopes } } as Parameters<typeof serveMcp>[2], () => auth.now);
  const list = await (await call('tools/list', {})).json<ToolReply>();
  expect(list.result.tools?.map(tool => tool.name)).toContain('set_page_icon');
  const create = await (await call('tools/call', { name: 'create_page', arguments: { title: 'MCP 建立圖示', icon: '🤖' } })).json<ToolReply>();
  expect(JSON.parse(create.result.content[0].text)).toMatchObject({ icon: '🤖' });
  for (const icon of ['👩🏽‍💻', null]) {
    const changed = await (await call('tools/call', { name: 'set_page_icon', arguments: { page_id: page.id, icon } })).json<ToolReply>();
    expect(changed.result.isError).toBeUndefined(); expect(JSON.parse(changed.result.content[0].text)).toMatchObject({ id: page.id, icon });
  }
  const denied = await (await call('tools/call', { name: 'set_page_icon', arguments: { page_id: page.id, icon: '🔒' } }, ['notes:read'])).json<ToolReply>();
  expect(denied.result.isError).toBe(true); expect(JSON.parse(denied.result.content[0].text)).toMatchObject({ status: 403 });
  await env.DB.prepare('UPDATE mcp_grants SET scopes = ? WHERE id = ?').bind('notes:read', grantId).run();
  const deniedGrant = await (await call('tools/call', { name: 'set_page_icon', arguments: { page_id: page.id, icon: '🔒' } })).json<ToolReply>();
  expect(deniedGrant.result.isError).toBe(true); expect(JSON.parse(deniedGrant.result.content[0].text)).toMatchObject({ status: 403 });
  const read = await (await call('tools/call', { name: 'get_page', arguments: { page_id: page.id } }, ['notes:read'])).json<ToolReply>();
  expect(JSON.parse(read.result.content[0].text)).toMatchObject({ icon: null });
  await env.DB.prepare('UPDATE mcp_grants SET revoked_at = ? WHERE id = ?').bind(auth.now, grantId).run();
  expect((await call('tools/call', { name: 'set_page_icon', arguments: { page_id: page.id, icon: '🔒' } })).status).toBe(401);
});
