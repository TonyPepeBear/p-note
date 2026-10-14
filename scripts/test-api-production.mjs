// 正式發布驗收：以管理員權限建立 10 分鐘專用 session，測試後撤銷；不繞過產品 API 的權限檢查。
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { chromium } from '@playwright/test';
process.loadEnvFile(process.env.P_NOTE_RELEASE_ENV ?? '.dev.vars.release');
const origin = process.env.BETTER_AUTH_URL;
assert.equal(origin, 'https://note.tonypepe.com');
const wrangler = 'node_modules/@cloudflare/vitest-plugin/node_modules/wrangler/bin/wrangler.js';
const sqlPath = '.env.api-smoke.sql';
const quote = v => "'" + String(v).replaceAll("'", "''") + "'";
function sql(text) {
  writeFileSync(sqlPath, text, { mode: 0o600 });
  try { return JSON.parse(execFileSync(process.execPath, [wrangler, 'd1', 'execute', 'p-note-production', '--config', 'wrangler.production.jsonc', '--remote', '--file', sqlPath, '--json'], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] })); }
  catch { throw new Error('正式測試資料操作失敗（敏感輸出已隱藏）'); }
  finally { unlinkSync(sqlPath); }
}
const report = { startedAt: new Date().toISOString(), checks: {}, authentication: '管理員建立的 10 分鐘專用 session；本次不驗證郵件登入' };
const sessionId = 'api-smoke-' + randomUUID(), token = randomBytes(32).toString('hex');
const signed = encodeURIComponent(token + '.' + createHmac('sha256', process.env.BETTER_AUTH_SECRET).update(token).digest('base64'));
const cookie = '__Secure-better-auth.session_token=' + signed;
const sessionHeaders = { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' };
let keyId, pageId, browser;
const sessionRequest = (path, data) => fetch(origin + path, { method: data === undefined ? 'GET' : 'POST', headers: sessionHeaders, body: data === undefined ? undefined : JSON.stringify(data) });
try {
  for (const path of ['/api/keys', '/api/v1/pages']) assert.equal((await fetch(origin + path)).status, 401);
  const html = await (await fetch(origin)).text(); const asset = html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1]; assert(asset);
  assert(await (await fetch(origin + asset)).text() === readFileSync('dist' + asset, 'utf8'), '正式 JS 須等於本次 build');
  report.checks.public = true;
  const now = new Date();
  sql(`INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId) SELECT ${quote(sessionId)}, ${quote(new Date(Date.now()+600000).toISOString())}, ${quote(token)}, ${quote(now.toISOString())}, ${quote(now.toISOString())}, id FROM user WHERE lower(email) = ${quote(process.env.OWNER_EMAIL.toLowerCase())};`);
  assert.equal((await sessionRequest('/api/session')).status, 200, '專用 session 無效');
  const created = await sessionRequest('/api/keys', { name: sessionId }); assert.equal(created.status, 201); keyId = (await created.json()).id;
  const reveal = await sessionRequest(`/api/keys/${keyId}/reveal`, {}); assert.equal(reveal.status, 200); const key = (await reveal.json()).key;
  assert(/^pn_[a-f0-9]{64}$/.test(key));
  assert((await (await sessionRequest(`/api/keys/${keyId}/reveal`, {})).json()).key === key);
  assert.equal(reveal.headers.get('cache-control'), 'no-store'); report.checks.keyManagement = true;
  const auth = { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  const request = (path, method = 'GET', data, extra = {}) => fetch(origin + '/api/v1' + path, { method, headers: { ...auth, ...extra }, body: data === undefined ? undefined : JSON.stringify(data) });
  const createdPage = await request('/pages', 'POST', { title: sessionId }); assert.equal(createdPage.status, 200); pageId = (await createdPage.json()).id;
  const path = `/pages/${pageId}/content`; const get = await request(path); assert.equal(get.status, 200);
  const put = await request(path, 'PUT', { blocks: [{ type: 'paragraph', content: '正式 API 驗證 ' + sessionId }] }, { 'If-Match': get.headers.get('etag') }); assert.equal(put.status, 200);
  assert.equal((await request(path, 'PUT', { blocks: [] }, { 'If-Match': get.headers.get('etag') })).status, 412);
  assert(JSON.stringify(await (await request(path)).json()).includes(sessionId));
  assert((await (await request('/search?q=' + encodeURIComponent(sessionId))).json()).some(p => p.id === pageId));
  assert.equal((await request('/backups')).status, 403); report.checks.content = true;
  browser = await chromium.launch(); const context = await browser.newContext();
  await context.addCookies([{ name: '__Secure-better-auth.session_token', value: signed, domain: 'note.tonypepe.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage(); await page.goto(origin + '/?page=' + pageId);
  await page.getByTestId('ready').filter({ hasText: '可編輯' }).waitFor({ timeout: 30000 });
  await page.locator('.tiptap').filter({ hasText: sessionId }).waitFor();
  await page.getByRole('button', { name: '設定', exact: true }).click(); await page.getByRole('heading', { name: '設定', exact: true }).waitFor();
  const card = page.getByTestId('api-key-card').filter({ hasText: sessionId }); await card.getByRole('button', { name: '顯示', exact: true }).click();
  assert(await card.getByLabel('完整 API key').inputValue() === key);
  await card.getByRole('button', { name: '隱藏', exact: true }).click();
  await card.getByLabel('完整 API key').waitFor({ state: 'detached' });
  await page.screenshot({ path: 'docs/screenshots/ui/production-api-settings.png', fullPage: true });
  report.checks.browserSettingsAndContent = true;
  assert.equal((await sessionRequest(`/api/keys/${keyId}/revoke`, {})).status, 200);
  assert.equal((await request('/pages')).status, 401); report.checks.revocation = true;
} catch (error) { report.error = error instanceof Error ? error.message.replace(/pn_[a-f0-9]+/g,'[已遮蔽]') : '驗證失敗'; process.exitCode = 1; }
finally {
  await browser?.close();
  try {
    if (pageId) assert.equal((await sessionRequest(`/api/pages/${pageId}/delete`, {})).status, 200);
    sql(`${keyId ? `DELETE FROM api_keys WHERE id = ${quote(keyId)};` : ''} DELETE FROM api_keys WHERE name = ${quote(sessionId)}; DELETE FROM session WHERE id = ${quote(sessionId)};`);
    report.checks.cleanup = true;
  } catch { report.checks.cleanup = false; process.exitCode = 1; }
  writeFileSync('docs/tdd/api-production-results.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
