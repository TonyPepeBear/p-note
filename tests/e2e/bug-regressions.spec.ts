import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { openPrivate, saved } from './helpers';
import { origin } from './ports';

declare global {
  interface Window {
    regressionTitle?: { held: number; released: boolean; release?: () => void };
    regressionCell?: { active: number; maximum: number; count: number; release?: () => void };
    regressionUnauthorized?: boolean;
  }
}

test.beforeEach(async ({ request }) => { await request.post('/__test/reset'); });

test('SB-03：同步引用與空白／外部媒體及 tel／ftp 連結皆能雲端保存', async ({ page }) => {
  const id = await openPrivate(page);
  const response = await page.request.post('/api/synced-blocks', { headers: { Origin: origin }, data: { blocks: [{ type: 'paragraph', content: '共用' }] } });
  expect(response.ok()).toBe(true);
  const shared = await response.json();
  await page.evaluate((sharedId) => {
    const e = window.probe!.editor;
    e.insertBlocks([
      { type: 'syncedBlock', props: { syncedBlockId: sharedId } },
      { type: 'image', props: { url: '' } },
      { type: 'image', props: { url: 'https://example.test/image.png' } },
      { type: 'paragraph', content: [{ type: 'link', href: 'tel:+123456', content: '電話' }, { type: 'link', href: 'ftp://example.test/file', content: '檔案' }] },
    ], e.document[0], 'after');
  }, shared.id);
  await saved(page);
  const backup = await page.request.post('/api/backups', { headers: { Origin: origin }, data: {} });
  expect(backup.ok()).toBe(true);
  await page.reload();
  await expect.poll(() => page.evaluate(() => JSON.stringify(window.probe?.editor.document))).toContain('tel:+123456');
  expect(new URL(page.url()).searchParams.get('page')).toBe(id);
});

test('PLUGIN-05：外部 MCP callback 可完成瀏覽器表單重導', async ({ page, baseURL }) => {
  await openPrivate(page);
  const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('授權返回'); });
  await new Promise<void>(resolve => server.listen(0, resolve));
  const callback = `http://localhost:${(server.address() as { port: number }).port}/callback`;
  try {
  const registered = await page.request.post('/oauth/register', { data: { client_name: '本機 MCP', redirect_uris: [callback], token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'] } });
  const { client_id } = await registered.json();
  const verifier = randomBytes(32).toString('base64url');
  const url = new URL('/oauth/authorize', baseURL!);
  url.search = new URLSearchParams({ client_id, redirect_uri: callback, response_type: 'code', scope: 'notes:read', state: 'regression', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource: baseURL! + '/mcp' }).toString();
  await page.goto(url.toString());
  await page.getByRole('button', { name: '同意授權', exact: true }).click();
  await page.waitForURL(callback + '?*');
  expect(new URL(page.url()).searchParams.get('code')).toBeTruthy();
  await page.goto(url.toString());
  await page.getByRole('button', { name: '拒絕', exact: true }).click();
  await page.waitForURL(callback + '?*');
  expect(new URL(page.url()).searchParams.get('error')).toBe('access_denied');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('UX-02：較早標題回應不覆蓋後續輸入', async ({ page }) => {
  const id = await openPrivate(page);
  await page.evaluate(id => {
    const original = window.fetch;
    const state = { held: 0, released: false, release: undefined as (() => void) | undefined };
    window.regressionTitle = state;
    window.fetch = async (input, init) => {
      const response = await original(input, init);
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.pathname === `/api/pages/${id}/title` && init?.method === 'POST' && !state.released) {
        state.held++;
        await new Promise<void>(resolve => { state.release = resolve; });
        state.released = true;
      }
      return response;
    };
  }, id);
  const title = page.getByLabel('文件標題', { exact: true });
  await title.fill('第一版');
  await title.blur();
  await expect.poll(() => page.evaluate(() => window.regressionTitle?.held)).toBe(1);
  await title.fill('最後輸入');
  await page.evaluate(() => window.regressionTitle?.release?.());
  await expect.poll(() => page.evaluate(() => window.regressionTitle?.released)).toBe(true);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect.poll(async () => (await (await page.request.get('/api/pages/' + id)).json()).title).toBe('第一版');
  await expect(title).toHaveValue('最後輸入');
  await title.blur();
  await expect.poll(async () => (await (await page.request.get('/api/pages/' + id)).json()).title).toBe('最後輸入');
});

test('DB-06：無效欄位不阻塞重新載入與新增筆記', async ({ page }) => {
  await openPrivate(page);
  const db = await (await page.request.post('/api/databases', { headers: { Origin: origin }, data: { title: '回歸資料庫' } })).json();
  const config = JSON.parse(db.database_config);
  config.properties = [{ id: 'url', name: '網址', type: 'url', options: [] }];
  config.views[0].columns.push('url');
  expect((await page.request.post('/api/databases/' + db.id + '/config', { headers: { Origin: origin }, data: { config, previous: db.database_config, generation: db.sync_generation } })).ok()).toBe(true);
  await page.request.post('/api/pages', { headers: { Origin: origin }, data: { title: '既有列', parent_id: db.id } });
  await page.goto('/?page=' + db.id);
  await expect(page.getByTestId('database-ready')).toBeVisible();
  const input = page.getByLabel('網址', { exact: true });
  await input.fill('example.com');
  await input.blur();
  await expect(page.locator('[data-save-state="error"]')).toBeVisible();
  await page.getByRole('button', { name: '新增筆記', exact: true }).click();
  await expect.poll(async () => (await (await page.request.get('/api/databases/' + db.id)).json()).rows.length).toBe(2);
});

async function database(page: import('@playwright/test').Page, type = 'checkbox') {
  const db = await (await page.request.post('/api/databases', { headers: { Origin: origin }, data: { title: '欄位回歸' } })).json();
  const config = JSON.parse(db.database_config);
  config.properties = [{ id: 'field', name: '測試欄位', type, options: [] }, { id: 'other', name: '其他欄位', type: 'text', options: [] }];
  config.views[0].columns = ['title', 'other', 'field'];
  expect((await page.request.post('/api/databases/' + db.id + '/config', { headers: { Origin: origin }, data: { config, previous: db.database_config, generation: db.sync_generation } })).ok()).toBe(true);
  const row = await (await page.request.post('/api/pages', { headers: { Origin: origin }, data: { title: '回歸列', parent_id: db.id } })).json();
  await page.goto('/?page=' + db.id);
  await expect(page.getByTestId('database-ready')).toBeVisible();
  return { db, row, config };
}

test('DB-06：快速修改同格只送出一個請求並保留最後輸入', async ({ page }) => {
  await openPrivate(page);
  const { row } = await database(page);
  await page.evaluate(id => {
    const original = window.fetch;
    const state = { active: 0, maximum: 0, count: 0, release: undefined as (() => void) | undefined };
    window.regressionCell = state;
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.pathname !== `/api/pages/${id}/properties` || init?.method !== 'POST') return original(input, init);
      state.active++; state.count++; state.maximum = Math.max(state.maximum, state.active);
      if (state.count === 1) await new Promise<void>(resolve => { state.release = resolve; });
      try { return await original(input, init); } finally { state.active--; }
    };
  }, row.id);
  const cell = page.getByRole('checkbox', { name: '測試欄位', exact: true });
  await cell.click();
  await expect.poll(() => page.evaluate(() => window.regressionCell?.count)).toBe(1);
  await cell.click();
  await cell.click();
  await cell.click();
  await page.evaluate(() => window.regressionCell?.release?.());
  await expect(cell).not.toBeChecked();
  await expect.poll(async () => JSON.parse((await (await page.request.get('/api/pages/' + row.id)).json()).property_values).field).toBe(false);
  await expect(page.locator('.property-input').filter({ has: cell })).toHaveAttribute('data-save-state', 'saved');
  await expect.poll(() => page.evaluate(() => window.regressionCell?.active)).toBe(0);
  expect(await page.evaluate(() => window.regressionCell?.count)).toBe(2);
  expect(await page.evaluate(() => window.regressionCell?.maximum)).toBe(1);
});

test('DB-05：儲存欄位保留檢視順序，類型變更清理不相容篩選', async ({ page }) => {
  await openPrivate(page);
  const { db, config } = await database(page, 'text');
  const current = await (await page.request.get('/api/pages/' + db.id)).json();
  config.views[0].filters = [{ property: 'field', operator: 'contains', value: '關鍵字' }];
  await page.request.post('/api/databases/' + db.id + '/config', { headers: { Origin: origin }, data: { config, previous: current.database_config, generation: current.sync_generation } });
  await page.reload();
  await expect(page.getByTestId('database-ready')).toBeVisible();
  await page.getByRole('button', { name: '管理欄位', exact: true }).click();
  await page.getByLabel('欄位類型 1', { exact: true }).selectOption('number');
  await page.getByRole('button', { name: '儲存欄位', exact: true }).click();
  await expect.poll(async () => JSON.parse((await (await page.request.get('/api/pages/' + db.id)).json()).database_config).properties[0].type).toBe('number');
  const saved = JSON.parse((await (await page.request.get('/api/pages/' + db.id)).json()).database_config);
  expect(saved.views[0].columns).toEqual(['title', 'other', 'field']);
  expect(saved.views[0].filters).toEqual([]);
});

test('UX-17：瀏覽器上一頁保存尚未失焦的標題', async ({ page }) => {
  const a = await openPrivate(page);
  const b = await (await page.request.post('/api/pages', { headers: { Origin: origin }, data: { title: '第二頁' } })).json();
  await page.evaluate((id) => {
    history.pushState({}, '', '/?page=' + id);
    dispatchEvent(new CustomEvent('p-note:navigate', { detail: { fresh: false } }));
  }, b.id);
  await expect(page.getByLabel('文件標題', { exact: true })).toHaveValue('第二頁');
  await page.getByLabel('文件標題', { exact: true }).fill('上一頁前的標題');
  await page.goBack();
  await expect(page.getByLabel('文件標題', { exact: true })).not.toHaveValue('上一頁前的標題');
  await expect.poll(async () => (await (await page.request.get('/api/pages/' + b.id)).json()).title).toBe('上一頁前的標題');
  expect(new URL(page.url()).searchParams.get('page')).toBe(a);
});

test('LFN-05：只有舊世代 metadata 不顯示不存在的本機草稿', async ({ page }) => {
  await openPrivate(page);
  const note = await (await page.request.post('/api/pages', { headers: { Origin: origin }, data: { title: '只有索引' } })).json();
  await page.evaluate(note => {
    const old = { ...note, sync_generation: 'metadata-only-generation' };
    localStorage.setItem('p-note:owner', note.owner_id);
    localStorage.setItem(`p-note:page:${note.owner_id}:${note.id}`, JSON.stringify(old));
    localStorage.setItem(`p-note:scope:${note.owner_id}:${note.id}:${old.sync_generation}`, JSON.stringify(old));
  }, note);
  await page.goto('/?page=' + note.id);
  await expect(page.getByTestId('ready')).toHaveText('可編輯');
  await expect(page.getByLabel('文件標題', { exact: true })).toHaveValue('只有索引');
  await expect(page.getByText(/此頁尚未下載|本機修改已另外保留/)).toHaveCount(0);
  await expect(page.getByText('本機草稿', { exact: true })).toHaveCount(0);
});

test('AUTH-06：另一分頁登入後原分頁恢復編輯', async ({ page, context }) => {
  const id = await openPrivate(page);
  await page.evaluate(() => localStorage.setItem('p-note:signed-out', '1'));
  await page.addInitScript(id => {
    window.regressionUnauthorized = true;
    const original = window.fetch;
    window.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (window.regressionUnauthorized && url.pathname === `/api/pages/${id}`) return Promise.resolve(Response.json({ message: '請登入' }, { status: 401 }));
      return original(input, init);
    };
  }, id);
  await page.goto('/?page=' + id);
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  await page.evaluate(() => { window.regressionUnauthorized = false; });
  const second = await context.newPage();
  await openPrivate(second, id);
  await page.bringToFront();
  await page.evaluate(() => dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('ready')).toHaveText('可編輯');
  await expect(page.getByLabel('Email', { exact: true })).toHaveCount(0);
  await second.close();
});

test('BACKUP-06：非 JSON 備份錯誤可讀，下載失敗不產生假 ZIP', async ({ page }) => {
  await openPrivate(page);
  const backup = await (await page.request.post('/api/backups', { headers: { Origin: origin }, data: {} })).json();
  await page.evaluate(id => {
    const original = window.fetch;
    window.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.pathname === '/api/backups' && init?.method === 'POST') return Promise.resolve(new Response('<html>error</html>', { status: 500, headers: { 'Content-Type': 'text/html' } }));
      if (url.pathname === `/api/backups/${id}/export`) return Promise.resolve(Response.json({}, { status: 500 }));
      return original(input, init);
    };
  }, backup.id);
  let downloads = 0;
  page.on('download', () => downloads++);
  const { showNavigation } = await import('./helpers');
  await showNavigation(page);
  await page.getByRole('navigation', { name: '工作區管理', exact: true }).getByRole('button', { name: '備份設定', exact: true }).click();
  await page.getByRole('button', { name: '建立備份', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('備份操作未完成');
  await page.getByRole('link', { name: '下載 ZIP', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('備份下載失敗');
  expect(downloads).toBe(0);
});
