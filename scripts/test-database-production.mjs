// 正式資料庫驗收使用十分鐘專用 session，僅操作本次建立的測試筆記，最後撤銷 session。
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
process.loadEnvFile(process.env.P_NOTE_RELEASE_ENV ?? '.dev.vars.release');
const origin = process.env.BETTER_AUTH_URL;
assert.equal(origin, 'https://note.tonypepe.com');
const wrangler = 'node_modules/@cloudflare/vitest-plugin/node_modules/wrangler/bin/wrangler.js';
const sqlPath = '.env.database-smoke.sql';
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
function sql(statement) {
  writeFileSync(sqlPath, statement, { mode: 0o600 });
  try { return execFileSync(process.execPath, [wrangler, 'd1', 'execute', 'p-note-production', '--config', 'wrangler.production.jsonc', '--remote', '--file', sqlPath, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { throw new Error('正式驗證 SQL 失敗，敏感輸出已隱藏'); }
  finally { unlinkSync(sqlPath); }
}
const report = { startedAt: new Date().toISOString(), authentication: '十分鐘管理 session，本次不重新驗證寄信登入', checks: {} };
const sessionId = 'database-smoke-' + randomUUID();
const token = randomBytes(32).toString('hex');
const signed = encodeURIComponent(token + '.' + createHmac('sha256', process.env.BETTER_AUTH_SECRET).update(token).digest('base64'));
const headers = { Cookie: '__Secure-better-auth.session_token=' + signed, Origin: origin, 'Content-Type': 'application/json' };
const request = (path, data) => fetch(origin + path, { method: data === undefined ? 'GET' : 'POST', headers, body: data === undefined ? undefined : JSON.stringify(data) });
async function json(path, data, status = 200) { const response = await request(path, data); assert.equal(response.status, status, path); return response.json(); }
let database, browser;
try {
  assert.equal((await fetch(origin + '/api/databases/no-session')).status, 401);
  assert.equal((await fetch(origin + '/__test/database-backup')).status, 404);
  const html = await (await fetch(origin)).text(); const entry = html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1]; assert(entry);
  assert.equal(await (await fetch(origin + entry)).text(), readFileSync('dist' + entry, 'utf8')); report.checks.deployedBuild = true;
  const now = new Date().toISOString();
  sql(`INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId) SELECT ${quote(sessionId)}, ${quote(new Date(Date.now() + 600000).toISOString())}, ${quote(token)}, ${quote(now)}, ${quote(now)}, id FROM user WHERE lower(email) = ${quote(process.env.OWNER_EMAIL.toLowerCase())};`);
  await json('/api/session');
  database = await json('/api/databases', { title: '正式驗證資料庫 ' + sessionId });
  const props = [{ id: 'summary', name: '摘要', type: 'text', options: [] }, { id: 'topic', name: '主題', type: 'select', options: [{ id: 'tech', name: '技術' }] }];
  const views = [{ id: 'table', name: '全部筆記', layout: 'table', columns: ['title', 'summary', 'topic'], filters: [], filterMode: 'and', sorts: [] }, { id: 'list', name: '技術筆記', layout: 'list', columns: ['title'], filters: [{ property: 'topic', operator: 'eq', value: 'tech' }], filterMode: 'and', sorts: [] }];
  database = await json('/api/databases/' + database.id + '/config', { previous: database.database_config, generation: database.sync_generation, config: { properties: props, views } });
  const note = await json('/api/pages', { title: '正式驗證筆記', parent_id: database.id });
  await json('/api/pages/' + note.id + '/properties', { property: 'topic', value: 'tech', generation: note.sync_generation });
  assert.equal((await request('/api/pages/' + note.id + '/properties', { property: 'summary', value: '舊版本', generation: 'old' })).status, 409);
  report.checks.createAndValidation = true;
  browser = await chromium.launch(); const context = await browser.newContext();
  const cookies = [{ name: '__Secure-better-auth.session_token', value: signed, domain: 'note.tonypepe.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }];
  await context.addCookies(cookies); const page = await context.newPage();
  await page.goto(origin + '/?page=' + database.id); await page.getByTestId('database-ready').waitFor({ timeout: 30000 });
  await page.getByLabel('摘要', { exact: true }).fill('正式欄位保存'); await page.getByLabel('摘要', { exact: true }).blur();
  await expect(page.getByTestId('property-status')).toHaveText('已儲存');
  await page.getByLabel('目前檢視').selectOption('list'); await expect(page.getByTestId('database-row')).toHaveText('正式驗證筆記');
  await page.getByTestId('database-row').getByRole('link').click(); await page.getByTestId('ready').filter({ hasText: '可編輯' }).waitFor({ timeout: 30000 });
  await expect(page.getByLabel('摘要', { exact: true })).toHaveValue('正式欄位保存');
  await page.evaluate(() => window.probe.editor.updateBlock(window.probe.editor.document[0], { content: '正式資料庫正文往返' }));
  await expect(page.getByTestId('cloud-status')).toHaveText('雲端已儲存');
  const fresh = await browser.newContext(); await fresh.addCookies(cookies); const second = await fresh.newPage();
  await second.goto(origin + '/?page=' + note.id); await expect(second.locator('.tiptap')).toContainText('正式資料庫正文往返', { timeout: 30000 });
  report.checks.browserPropertiesViewsAndBody = true;
  const result = await json('/api/databases/' + database.id); assert.equal(result.rows.length, 1); assert.equal(JSON.parse(result.rows[0].property_values).summary, '正式欄位保存');
  report.checks.persisted = true;
} catch (e) { report.error = e instanceof Error ? e.message : '驗證失敗'; process.exitCode = 1; }
finally {
  await browser?.close();
  try {
    if (database) assert.equal((await request('/api/pages/' + database.id + '/delete', {})).status, 200);
    sql(`DELETE FROM session WHERE id = ${quote(sessionId)};`);
    report.checks.cleanup = true;
  } catch { report.checks.cleanup = false; process.exitCode = 1; }
  writeFileSync('docs/tdd/db-production-results.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
