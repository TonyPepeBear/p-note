import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';

process.loadEnvFile('.dev.vars.release');
const origin = process.env.BETTER_AUTH_URL;
assert.equal(origin, 'https://note.tonypepe.com');
const tokenFile = '.env.production-login';
const report = { startedAt: new Date().toISOString(), origin, checks: {} };
let phase = 'DEPLOY-02';
let browser;
let cleanupContext;
let noteId;
let diagnosticPage;

async function saved(page) {
  await expect(page.getByTestId('local-status')).toHaveText('本機已儲存', { timeout: 30000 });
  await expect(page.getByTestId('cloud-status')).toHaveText('雲端已儲存', { timeout: 30000 });
}

try {
  const root = await fetch(origin);
  assert.equal(root.status, 200);
  const html = await root.text();
  assert.match(html, /\/assets\/index-[\w-]+\.js/);
  assert(!html.includes('/src/client/main.tsx'));
  for (const path of ['/api/session', '/api/pages', '/api/backups']) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 401, path);
  }
  for (const path of ['/probe', '/__test/reset', '/__test/mailbox', '/parties/rooms/test', '/api/auth/get-session']) {
    assert.equal((await fetch(origin + path)).status, 404, path);
  }
  report.checks['DEPLOY-02'] = { tls: true, builtAssets: true, privateApi: true, testRoutesBlocked: true };
  console.log('DEPLOY-02：正式 HTTPS、建置、私人 API 與測試入口斷言通過');

  phase = 'DEPLOY-03';
  browser = await chromium.launch();
  const loginContext = await browser.newContext({ baseURL: origin });
  const login = await loginContext.newPage();
  diagnosticPage = login;
  login.on('pageerror', error => console.error('瀏覽器錯誤：' + error.message.replace(/[A-Za-z]{32,}/g, '[已遮蔽]')));
  login.on('response', response => { const path = new URL(response.url()).pathname; if (response.status() >= 400) console.error('HTTP ' + response.status() + ' ' + path); });
  login.on('websocket', socket => console.log('WebSocket 路徑：' + new URL(socket.url()).pathname));
  await login.goto('/');
  await login.getByLabel('Email', { exact: true }).fill(process.env.OWNER_EMAIL);
  report.mailRequestedAt = new Date().toISOString();
  const sent = login.waitForResponse(response => new URL(response.url()).pathname === '/api/login');
  await login.getByRole('button', { name: '寄送登入連結', exact: true }).click();
  assert.equal((await sent).status(), 200, '登入郵件申請失敗');
  await expect(login.getByRole('status')).toContainText('查看登入郵件');
  console.log('MAIL_REQUESTED：' + report.mailRequestedAt);
  console.log('等待 Gmail 自動查詢對應郵件，再以忽略的 0600 檔提供登入 token');
  for (let attempt = 0; !existsSync(tokenFile) && attempt < 180; attempt++) await delay(1000);
  assert(existsSync(tokenFile), '未取得本次實際送達郵件');
  const token = readFileSync(tokenFile, 'utf8').trim();
  unlinkSync(tokenFile);
  assert(/^[A-Za-z]{32}$/.test(token), '登入 token 格式不符');
  const confirm = '/login/confirm?token=' + token;
  const getResponse = await login.goto(confirm);
  assert.equal(getResponse.status(), 200);
  assert.equal(getResponse.headers()['cache-control'], 'no-store');
  assert.equal((await login.request.get('/api/session')).status(), 401, 'GET 不得兌換登入');
  await login.getByRole('button', { name: '確認登入', exact: true }).click();
  await login.waitForURL(url => url.pathname === '/');
  console.log('登入後私人 session HTTP ' + (await login.request.get('/api/session')).status());
  await expect(login.getByTestId('ready')).toHaveText('可編輯', { timeout: 30000 });
  assert.equal((await login.request.get('/api/session')).status(), 200);
  const replay = await login.request.post('/api/confirm', { headers: { Origin: origin }, data: { token } });
  assert.equal(replay.status(), 400, '登入 token 不得重用');
  report.checks['DEPLOY-03'] = { deliveredMail: true, getDoesNotRedeem: true, login: true, singleUse: true };
  console.log('DEPLOY-03：實際郵件送達、確認登入與一次性兌換通過');

  phase = 'DEPLOY-04';
  const state = await loginContext.storageState();
  cleanupContext = await browser.newContext({ baseURL: origin, storageState: state });
  const response = await cleanupContext.request.post('/api/pages', {
    headers: { Origin: origin }, data: { title: '部署同步驗證 ' + randomUUID(), parent_id: null },
  });
  assert.equal(response.status(), 200, '建立專用驗證筆記');
  noteId = (await response.json()).id;
  const contexts = await Promise.all([0, 1].map(() => browser.newContext({ baseURL: origin, storageState: state })));
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const sockets = [];
  for (const page of pages) page.on('websocket', socket => sockets.push(socket.url()));
  await Promise.all(pages.map(page => page.goto('/?page=' + noteId)));
  await Promise.all(pages.map(page => expect(page.getByTestId('ready')).toHaveText('可編輯', { timeout: 30000 })));
  await Promise.all(pages.map(saved));
  const first = '正式雙向同步 A ' + randomUUID();
  const second = '正式雙向同步 B ' + randomUUID();
  await pages[0].locator('.tiptap[contenteditable="true"]').fill(first);
  await saved(pages[0]);
  await expect(pages[1].locator('.tiptap')).toContainText(first, { timeout: 30000 });
  await pages[1].locator('.tiptap[contenteditable="true"]').fill(second);
  await saved(pages[1]);
  await expect(pages[0].locator('.tiptap')).toContainText(second, { timeout: 30000 });
  await Promise.all(pages.map(saved));
  assert(sockets.length >= 2 && sockets.every(url => url.startsWith('wss://note.tonypepe.com/parties/sync/')), '正式 wss 連線');
  await Promise.all(contexts.map(context => context.close()));
  await loginContext.close();
  const fresh = await browser.newContext({ baseURL: origin, storageState: state });
  const freshPage = await fresh.newPage();
  await freshPage.goto('/?page=' + noteId);
  await saved(freshPage);
  await expect(freshPage.locator('.tiptap')).toContainText(second, { timeout: 30000 });
  await fresh.close();
  report.checks['DEPLOY-04'] = { independentContexts: true, wss: true, bidirectional: true, freshLoad: true };
  console.log('DEPLOY-04：兩個獨立瀏覽器雙向 wss 同步、雲端保存與全新載入通過');
} catch (error) {
  report.failedPhase = phase;
  process.exitCode = 1;
  // 僅輸出階段，避免瀏覽器錯誤含登入連結或 session。
  console.error(phase + ' 失敗：' + String(error.message).replace(/[A-Za-z]{32,}/g, '[已遮蔽]').slice(0, 1200));
  if (diagnosticPage && !diagnosticPage.isClosed()) {
    console.error('頁面錯誤：' + JSON.stringify(await diagnosticPage.getByRole('alert').allTextContents()));
    console.error('Service Worker：' + JSON.stringify(await diagnosticPage.evaluate(async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      return { registrations: registrations.map(item => ({ active: item.active?.state, installing: item.installing?.state })),
        resources: performance.getEntriesByType('resource').map(item => new URL(item.name).pathname) };
    })));
  }
} finally {
  if (noteId && cleanupContext) {
    try {
      const response = await cleanupContext.request.post('/api/pages/' + noteId + '/delete', { headers: { Origin: origin }, data: {} });
      assert.equal(response.status(), 200);
      const trash = await (await cleanupContext.request.get('/api/trash')).json();
      assert(trash.some(page => page.id === noteId));
      report.testNoteMovedToTrash = true;
      console.log('專用驗證筆記已移入垃圾桶');
    } catch { report.testNoteMovedToTrash = false; process.exitCode = 1; console.error('驗證筆記垃圾桶清理失敗'); }
  }
  if (existsSync(tokenFile)) unlinkSync(tokenFile);
  await browser?.close();
  report.completedAt = new Date().toISOString();
  report.passed = !process.exitCode;
  writeFileSync('docs/tdd/production-results.json', JSON.stringify(report, null, 2) + '\n');
}
