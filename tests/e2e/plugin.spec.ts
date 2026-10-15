import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BlobReader, ZipReader, TextWriter } from '@zip.js/zip.js';
import { openPrivate, saved, showNavigation } from './helpers';

const scopes = 'notes:read notes:write offline_access';
const data = (result: any) => JSON.parse(result.content[0].text);
async function registration(request: APIRequestContext, base: string, scope = scopes) {
  const callback = base + '/oauth/test-callback';
  const response = await request.post('/oauth/register', { data: { client_name: '測試 MCP <script>client</script>', redirect_uris: [callback], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] } });
  expect(response.status()).toBe(201);
  const { client_id } = await response.json();
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const url = new URL('/oauth/authorize', base);
  url.search = new URLSearchParams({ client_id, redirect_uri: callback, response_type: 'code', scope, state: 'test-state', code_challenge: challenge, code_challenge_method: 'S256', resource: base + '/mcp' }).toString();
  return { client_id, callback, verifier, url: url.toString() };
}
async function authorize(page: Page, base: string, scope = scopes, signIn = true) {
  if (signIn) await openPrivate(page);
  const flow = await registration(page.request, base, scope);
  await page.route('**/oauth/test-callback?*', route => route.fulfill({ contentType: 'text/html', body: '<h1>授權返回</h1>' }));
  await page.goto(flow.url);
  await expect(page.getByRole('heading', { name: '授權筆記存取' })).toBeVisible();
  await page.getByRole('button', { name: '同意授權', exact: true }).click();
  await page.waitForURL('**/oauth/test-callback?*');
  const code = new URL(page.url()).searchParams.get('code');
  expect(!!code).toBe(true);
  const form = { grant_type: 'authorization_code', client_id: flow.client_id, redirect_uri: flow.callback, code: code!, code_verifier: flow.verifier, resource: base + '/mcp' };
  const response = await page.request.post('/oauth/token', { form });
  expect(response.status()).toBe(200);
  return { ...await response.json(), flow, form };
}
async function rpc(request: APIRequestContext, token: string, method: string, params: object = {}) {
  return request.post('/mcp', { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' }, data: { jsonrpc: '2.0', id: 1, method, params } });
}
async function call(request: APIRequestContext, token: string, name: string, args: object = {}) {
  const response = await rpc(request, token, 'tools/call', { name, arguments: args });
  expect(response.status()).toBe(200);
  return (await response.json()).result;
}
test.beforeEach(async ({ request }) => { await request.post('/__test/reset'); });

test('PLUGIN-05：Email 跨分頁登入後回到同意畫面，拒絕不授權', async ({ page, context, baseURL }) => {
  const base = baseURL!;
  const flow = await registration(page.request, base);
  await page.goto(flow.url);
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill('owner@example.test');
  await page.getByRole('button', { name: '寄送登入連結', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('查看登入郵件');
  const mails = await (await page.request.get('/__test/mailbox')).json();
  const second = await context.newPage();
  await second.goto(mails.at(-1).url);
  await second.getByRole('button', { name: '確認登入', exact: true }).click();
  await expect(second.getByRole('heading', { name: '授權筆記存取' })).toBeVisible();
  await expect(second.getByText('測試 MCP <script>client</script>', { exact: true })).toBeVisible();
  await expect(second.getByText('127.0.0.1', { exact: true })).toBeVisible();
  await expect(second.getByText('讀取筆記與日記', { exact: true })).toBeVisible();
  await expect(second.getByText('建立及修改筆記與日記', { exact: true })).toBeVisible();
  await second.route('**/oauth/test-callback?*', route => route.fulfill({ body: '拒絕授權' }));
  await second.getByRole('button', { name: '拒絕', exact: true }).click();
  await second.waitForURL('**/oauth/test-callback?*');
  expect(new URL(second.url()).searchParams.get('error')).toBe('access_denied');
  expect(new URL(second.url()).searchParams.get('state')).toBe('test-state');
  expect(await (await page.request.get('/api/mcp-connections')).json()).toEqual([]);
  await second.close();
});

test('PLUGIN-01：HTTP MCP 的 13 個工具與網站及同步區塊往返', async ({ page, baseURL }) => {
  const id = await openPrivate(page);
  const auth = await authorize(page, baseURL!);
  const init = await rpc(page.request, auth.access_token, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } });
  expect((await init.json()).result.serverInfo.name).toBe('p-note');
  const tools = (await (await rpc(page.request, auth.access_token, 'tools/list')).json()).result.tools;
  expect(tools.map((x: any) => x.name).sort()).toEqual(['create_page', 'get_content', 'get_page', 'get_synced_block_content', 'list_journals', 'list_pages', 'move_page', 'open_journal', 'rename_page', 'search', 'set_page_icon', 'update_content', 'update_synced_block_content']);
  const run = (name: string, args = {}) => call(page.request, auth.access_token, name, args);
  expect(data(await run('list_pages')).some((x: any) => x.id === id)).toBe(true);
  expect(data(await run('get_page', { page_id: id })).id).toBe(id);
  const parent = data(await run('create_page', { title: 'MCP 上層' }));
  const note = data(await run('create_page', { title: 'MCP 筆記' }));
  expect(data(await run('rename_page', { page_id: note.id, title: 'MCP 改名' })).title).toBe('MCP 改名');
  expect(data(await run('move_page', { page_id: note.id, parent_id: parent.id })).parent_id).toBe(parent.id);
  expect(data(await run('move_page', { page_id: note.id, parent_id: null })).parent_id).toBeNull();
  const journal = data(await run('open_journal', { date: '2026-10-15' }));
  expect(data(await run('open_journal', { date: '2026-10-15' })).id).toBe(journal.id);
  expect(data(await run('list_journals', { month: '2026-10' })).some((x: any) => x.id === journal.id)).toBe(true);
  await openPrivate(page, id);
  const current = data(await run('get_content', { page_id: id }));
  expect(current.etag).toMatch(/^".+"$/);
  expect((await run('update_content', { page_id: id, etag: current.etag, blocks: [{ type: 'paragraph', content: '雲端 MCP 正文' }] })).isError).not.toBe(true);
  await expect(page.locator('.tiptap')).toContainText('雲端 MCP 正文');
  expect(JSON.stringify(data(await run('search', { query: '雲端 MCP' })))).toContain(id);
  await page.evaluate(() => window.probe!.editor.updateBlock(window.probe!.editor.document[0], { content: '網站修改雲端正文' })); await saved(page);
  expect(JSON.stringify(data(await run('get_content', { page_id: id })))).toContain('網站修改雲端正文');
  const shared = await page.request.post('/api/synced-blocks', { headers: { Origin: baseURL! }, data: { blocks: [{ type: 'paragraph', content: 'MCP 共用正文' }] } });
  expect(shared.status()).toBe(200); const sharedId = (await shared.json()).id;
  const content = data(await run('get_synced_block_content', { synced_block_id: sharedId }));
  expect(JSON.stringify(content.blocks)).toContain('MCP 共用正文');
  expect((await run('update_synced_block_content', { synced_block_id: sharedId, etag: content.etag, blocks: [{ type: 'paragraph', content: 'MCP 已修改同步區塊' }] })).isError).not.toBe(true);
  expect(data(await run('update_synced_block_content', { synced_block_id: sharedId, etag: content.etag, blocks: [] })).status).toBe(412);
  const pageContent = data(await run('get_content', { page_id: id }));
  expect((await run('update_content', { page_id: id, etag: pageContent.etag, blocks: [{ type: 'syncedBlock', props: { syncedBlockId: sharedId } }] })).isError).not.toBe(true);
  const expanded = data(await run('get_content', { page_id: id, expand_synced_blocks: true }));
  expect(JSON.stringify(expanded.syncedBlocks[sharedId].blocks)).toContain('MCP 已修改同步區塊');
});

test('PLUGIN-02：版本衝突、無效參數與錯誤憑證不能覆蓋正文', async ({ page, baseURL }) => {
  const id = await openPrivate(page); const auth = await authorize(page, baseURL!);
  const run = (name: string, args = {}) => call(page.request, auth.access_token, name, args);
  const current = data(await run('get_content', { page_id: id }));
  await run('update_content', { page_id: id, etag: current.etag, blocks: [{ type: 'paragraph', content: '保留新版本' }] });
  const conflict = await run('update_content', { page_id: id, etag: current.etag, blocks: [] });
  expect(conflict.isError).toBe(true); expect(data(conflict).status).toBe(412);
  for (const args of [{ page_id: id, blocks: [] }, { page_id: '../keys', etag: '*', blocks: [] }, { page_id: id, etag: '*', blocks: [] }, { page_id: id, etag: current.etag, blocks: [], owner: 'other' }]) {
    const response = await rpc(page.request, auth.access_token, 'tools/call', { name: 'update_content', arguments: args });
    const message = await response.json(); expect(!!message.error || message.result?.isError === true).toBe(true);
  }
  expect((await call(page.request, auth.access_token, 'delete_page')).isError).toBe(true);
  expect(JSON.stringify(data(await run('get_content', { page_id: id })))).toContain('保留新版本');
  expect((await rpc(page.request, 'pn_' + '0'.repeat(64), 'tools/list')).status()).toBe(401);
  expect((await page.request.post('/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })).status()).toBe(401);
});

test('PLUGIN-03：discovery、來源與錯誤回應安全', async ({ page, baseURL }) => {
  const challenge = await page.request.post('/mcp', { data: {} });
  expect(challenge.status()).toBe(401); expect(challenge.headers()['www-authenticate']).toContain('resource_metadata=');
  const resource = await (await page.request.get('/.well-known/oauth-protected-resource/mcp')).json();
  expect(resource.resource).toBe(baseURL + '/mcp');
  const metadata = await (await page.request.get('/.well-known/oauth-authorization-server')).json();
  expect(metadata.code_challenge_methods_supported).toContain('S256');
  expect(metadata.client_id_metadata_document_supported).toBe(true);
  const auth = await authorize(page, baseURL!);
  const cross = await page.request.post('/mcp', { headers: { Authorization: 'Bearer ' + auth.access_token, Origin: 'https://attacker.example.test', Accept: 'application/json, text/event-stream' }, data: {} });
  expect(cross.status()).toBe(403);
  const malformed = await page.request.post('/mcp', { headers: { Authorization: 'Bearer ' + auth.access_token, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' }, data: '{' });
  expect(malformed.status()).toBe(400);
  const output = JSON.stringify(await (await rpc(page.request, auth.access_token, 'tools/list')).json());
  expect(output.includes(auth.access_token)).toBe(false); expect(output.includes(auth.refresh_token)).toBe(false);
});

test('PLUGIN-06：PKCE、code 重用、回呼、CSRF 與返回網址竄改拒絕', async ({ page, browser, baseURL }) => {
  await openPrivate(page); const base = baseURL!;
  const flow = await registration(page.request, base);
  const altered = new URL(flow.url); altered.searchParams.set('redirect_uri', 'https://attacker.example.test/callback');
  expect((await page.request.get(altered.toString(), { maxRedirects: 0 })).status()).toBe(400);
  const unknown = new URL(flow.url); unknown.searchParams.set('scope', 'admin');
  expect((await page.request.get(unknown.toString(), { maxRedirects: 0 })).status()).toBe(400);
  await page.goto(flow.url);
  const handle = await page.locator('input[name="handle"]').inputValue();
  const other = await browser.newContext({ ignoreHTTPSErrors: true, storageState: { cookies: (await page.context().cookies()).filter(cookie => !cookie.name.startsWith('__Host-oauth-')), origins: [] } });
  try { expect((await other.request.post(base + '/oauth/authorize', { headers: { Origin: base }, form: { handle, decision: 'approve', scope: 'notes:read' }, maxRedirects: 0 })).status()).toBe(400); }
  finally { await other.close(); }
  expect((await page.request.post('/oauth/authorize', { headers: { Origin: 'https://attacker.example.test' }, form: { handle, decision: 'approve' }, maxRedirects: 0 })).status()).toBe(403);
  expect((await page.request.post('/api/login', { headers: { Origin: base }, data: { email: 'owner@example.test', returnTo: 'https://attacker.example.test' } })).status()).toBe(400);
  const auth = await authorize(page, base);
  expect((await page.request.post('/oauth/token', { form: auth.form })).status()).toBe(400);
  const fresh = await registration(page.request, base);
  await page.goto(fresh.url); await page.getByRole('button', { name: '同意授權', exact: true }).click(); await page.waitForURL('**/oauth/test-callback?*');
  const code = new URL(page.url()).searchParams.get('code')!;
  const invalidResource = await page.request.post('/oauth/token', { form: { grant_type: 'authorization_code', client_id: fresh.client_id, redirect_uri: fresh.callback, code, code_verifier: fresh.verifier, resource: base + '/other-resource' } });
  expect(invalidResource.status()).toBe(400);
  const bad = await page.request.post('/oauth/token', { form: { grant_type: 'authorization_code', client_id: fresh.client_id, redirect_uri: fresh.callback, code, code_verifier: randomBytes(32).toString('base64url'), resource: base + '/mcp' } });
  expect(bad.status()).toBe(400);
});

test('PLUGIN-07：唯讀 scope 與 refresh 不得擴權', async ({ page, baseURL }) => {
  const auth = await authorize(page, baseURL!, 'notes:read offline_access');
  expect((await call(page.request, auth.access_token, 'list_pages')).isError).not.toBe(true);
  const blocked = await call(page.request, auth.access_token, 'create_page', { title: '禁止建立' });
  expect(blocked.isError).toBe(true); expect(data(blocked).status).toBe(403);
  const refresh = { grant_type: 'refresh_token', client_id: auth.flow.client_id, refresh_token: auth.refresh_token, resource: baseURL + '/mcp' };
  const broader = await page.request.post('/oauth/token', { form: { ...refresh, scope: scopes } });
  expect(broader.status()).toBe(200);
  const narrowed = await broader.json();
  expect(narrowed.scope.split(' ').includes('notes:write')).toBe(false);
  expect((await call(page.request, narrowed.access_token, 'create_page', { title: '不得擴權' })).isError).toBe(true);
  const response = await page.request.post('/oauth/token', { form: { ...refresh, refresh_token: narrowed.refresh_token } }); expect(response.status()).toBe(200);
  const next = await response.json();
  expect((await call(page.request, next.access_token, 'list_pages')).isError).not.toBe(true);
  expect((await call(page.request, next.access_token, 'create_page', { title: '仍禁止建立' })).isError).toBe(true);
});

test('PLUGIN-08：設定撤銷、授權到期及 owner 變更後拒絕', async ({ page, baseURL }) => {
  const auth = await authorize(page, baseURL!);
  await openPrivate(page); await showNavigation(page); await page.getByRole('button', { name: '設定', exact: true }).click();
  const connection = page.getByTestId('mcp-connection'); await expect(connection).toHaveCount(1);
  await connection.getByRole('button', { name: '撤銷連線', exact: true }).click();
  await page.getByRole('button', { name: '確認撤銷連線', exact: true }).click(); await expect(connection).toHaveCount(0);
  expect((await rpc(page.request, auth.access_token, 'tools/list')).status()).toBe(401);
  const refresh = { grant_type: 'refresh_token', client_id: auth.flow.client_id, refresh_token: auth.refresh_token, resource: baseURL + '/mcp' };
  expect((await page.request.post('/oauth/token', { form: refresh })).status()).toBe(400);
  const expired = await authorize(page, baseURL!);
  await page.request.post('/__test/control', { data: { now: Date.now() + 31 * 86400000 } });
  expect((await rpc(page.request, expired.access_token, 'tools/list')).status()).toBe(401);
  await page.request.post('/__test/control', { data: { now: Date.now() } });
  const owner = await authorize(page, baseURL!);
  await page.request.post('/__test/change-owner', { data: {} });
  expect((await rpc(page.request, owner.access_token, 'tools/list')).status()).toBe(401);
});

test('PLUGIN-04：遠端 OAuth 封裝完整且無本機執行需求', async ({}, testInfo) => {
  const root = resolve('plugins/p-note');
  const manifest = JSON.parse(await readFile(root + '/plugin.json', 'utf8'));
  const legacy = JSON.parse(await readFile(root + '/.codex-plugin/plugin.json', 'utf8'));
  expect(legacy.version).toBe(manifest.version); expect(legacy.interface).toEqual(manifest.extensions['com.openai'].interface);
  expect(legacy.requires_local_executor).not.toBe(true); expect(manifest.extensions['com.openai'].requires_local_executor).not.toBe(true);
  const mcp = JSON.parse(await readFile(root + '/mcp.json', 'utf8')).mcpServers['p-note'];
  expect(mcp.type).toBe('streamable-http'); expect(mcp.url).toBe('https://note.tonypepe.com/mcp');
  expect(mcp.extensions['com.openai'].auth.type).toBe('oauth');
  expect(mcp.extensions['com.openai'].auth.client.mode).toBe('cimd');
  const marketplace = JSON.parse(await readFile('.agents/plugins/marketplace.json', 'utf8'));
  expect(resolve(marketplace.plugins[0].source.path)).toBe(root);
  const archive = execFileSync(process.execPath, ['scripts/package-plugin.mjs', testInfo.outputPath('plugin.zip')], { encoding: 'utf8' }).trim();
  const reader = new ZipReader(new BlobReader(new Blob([await readFile(archive)])));
  try {
    const entries = await reader.getEntries();
    expect(entries.map(e => e.filename).sort()).toEqual(['.codex-plugin/plugin.json', '.mcp.json', 'README.md', 'mcp.json', 'plugin.json', 'skills/p-note/SKILL.md']);
    for (const entry of entries) {
      if (entry.directory) throw new Error('封裝不得有目錄項目');
      const value = await entry.getData!(new TextWriter()); expect(/pn_[a-f0-9]{64}/.test(value)).toBe(false);
    }
  } finally { await reader.close(); }
});
