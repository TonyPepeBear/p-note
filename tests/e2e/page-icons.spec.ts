import { expect, test, type Page } from '@playwright/test';
import { blocks, openPageActions, openPrivate, saved, showNavigation } from './helpers';
import { origin } from './ports';

test.beforeEach(async ({ request }) => { await request.post('/__test/reset'); });
const post = (page: Page, path: string, data: object) => page.request.post(path, { headers: { Origin: origin }, data });
async function note(page: Page, title: string, icon: string | null = null, parent_id: string | null = null) {
  const response = await post(page, '/api/pages', { title, icon, parent_id });
  expect(response.status()).toBe(200);
  return response.json() as Promise<{ id: string; title: string; icon: string | null }>;
}
async function visit(page: Page, id: string) {
  await page.goto('/?page=' + id);
  await expect(page.getByTestId('ready')).toHaveText('可編輯');
  await saved(page);
}
const header = (page: Page) => page.locator('.document-icon .page-icon-trigger');
const dialog = (page: Page) => page.getByRole('dialog', { name: '頁面圖示', exact: true });
async function apply(page: Page, icon: string) {
  await dialog(page).getByLabel('自訂 emoji', { exact: true }).fill(icon);
  await dialog(page).getByRole('button', { name: '套用圖示', exact: true }).click();
  await expect(dialog(page)).toBeHidden();
}

test('ICON-01：標題上方以鍵盤或觸控新增、更換、移除並拒絕無效 emoji', async ({ page, isMobile }) => {
  await openPrivate(page);
  const target = await note(page, '圖示筆記');
  await visit(page, target.id);
  await expect(header(page)).toContainText('新增圖示');
  if (isMobile) await header(page).tap();
  else { await header(page).focus(); await page.keyboard.press('Enter'); }
  await dialog(page).getByLabel('自訂 emoji', { exact: true }).fill('不是 emoji');
  await dialog(page).getByRole('button', { name: '套用圖示', exact: true }).click();
  await expect(dialog(page).getByRole('alert')).toContainText('一個 emoji');
  await dialog(page).getByRole('button', { name: '選擇圖示 💡', exact: true }).click();
  await expect(header(page)).toContainText('💡');
  await header(page).click(); await apply(page, '👩🏽‍💻');
  await expect(header(page)).toContainText('👩🏽‍💻');
  expect((await (await page.request.get('/api/pages/' + target.id)).json()).icon).toBe('👩🏽‍💻');
  await page.reload(); await saved(page);
  await expect(header(page)).toContainText('👩🏽‍💻');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await header(page).click();
  await dialog(page).getByRole('button', { name: '移除圖示', exact: true }).click();
  await expect(header(page)).toContainText('新增圖示');
  await page.reload(); await saved(page);
  expect((await (await page.request.get('/api/pages/' + target.id)).json()).icon).toBeNull();
});

test('ICON-02：側欄、行內連結、選單與反向連結顯示圖示且不改正文', async ({ page }) => {
  test.setTimeout(45_000);
  await openPrivate(page);
  const source = await note(page, '引用來源', '🌱');
  const target = await note(page, '引用目標', '🎯');
  await visit(page, source.id);
  await page.evaluate(id => {
    const editor = window.probe!.editor;
    editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: [{ type: 'link', href: '/?page=' + id, content: '引用目標' }] }]);
  }, target.id);
  await saved(page);
  const before = await blocks(page);
  const inline = page.locator('.tiptap .page-icon-trigger').first();
  await expect(inline).toContainText('🎯');
  await inline.click(); await apply(page, '🚀');
  await expect(page).toHaveURL(new RegExp('page=' + source.id));
  expect(await blocks(page)).toEqual(before);
  await expect(inline).toContainText('🚀');
  await page.locator('.tiptap a').first().click();
  await expect(page.getByLabel('文件標題', { exact: true })).toHaveValue(target.title);
  await expect(header(page)).toContainText('🚀');
  const backlinks = page.getByRole('region', { name: '反向連結' });
  await expect(backlinks.locator('[data-page-icon="🌱"]')).toBeVisible();
  await backlinks.getByRole('link', { name: source.title, exact: true }).click();
  await expect(page.getByLabel('文件標題', { exact: true })).toHaveValue(source.title);
  await page.evaluate(() => {
    const editor = window.probe!.editor;
    editor.setTextCursorPosition(editor.document.at(-1)!, 'end'); editor.insertInlineContent(' '); editor.focus();
  });
  await page.keyboard.type('[['); await page.keyboard.insertText('引用目標');
  const option = page.locator('.note-link-option-row').filter({ hasText: target.title });
  await expect(option.locator('[data-page-icon="🚀"]')).toBeVisible();
  await option.getByRole('button', { name: '更換「' + target.title + '」圖示', exact: true }).click();
  await apply(page, '🎯');
  await page.keyboard.press('Escape');
  await showNavigation(page);
  const sidebar = page.locator('.pn-note-row').filter({ has: page.getByRole('link', { name: target.title, exact: true }) }).filter({ visible: true });
  await expect(sidebar.locator('[data-page-icon="🎯"]')).toBeVisible();
  await sidebar.getByRole('button', { name: '更換「' + target.title + '」圖示', exact: true }).click();
  await apply(page, '📚');
  await expect(page).toHaveURL(new RegExp('page=' + source.id));
  await expect(sidebar.locator('[data-page-icon="📚"]')).toBeVisible();
  await sidebar.getByRole('link', { name: target.title, exact: true }).click();
  await expect(page.getByLabel('文件標題', { exact: true })).toHaveValue(target.title);
  await expect(header(page)).toContainText('📚');
});

test('ICON-02：資料庫標題與兩種檢視的資料列圖示可獨立編輯', async ({ page, context }) => {
  test.setTimeout(45_000);
  await openPrivate(page);
  const response = await post(page, '/api/databases', { title: '圖示資料庫' });
  expect(response.status()).toBe(200);
  const database = await response.json() as { id: string };
  const row = await note(page, '圖示資料列', '✅', database.id);
  await page.goto('/?page=' + database.id);
  await expect(page.getByTestId('database-ready')).toBeVisible();
  const peer = await context.newPage();
  await peer.goto('/?page=' + database.id);
  await expect(peer.getByTestId('database-ready')).toBeVisible();
  const large = page.locator('.database-page .page-icon-trigger-large');
  await large.click(); await apply(page, '🗃️');
  await expect(large).toContainText('🗃️');
  await expect(peer.locator('.database-page .page-icon-trigger-large')).toContainText('🗃️', { timeout: 12_000 });
  await expect(peer.locator('.pn-current-page [data-page-icon="🗃️"]')).toBeVisible();
  const rows = page.getByTestId('database-rows');
  await expect(rows.locator('[data-page-icon="✅"]')).toBeVisible();
  await rows.getByRole('button', { name: '更換「' + row.title + '」圖示', exact: true }).click();
  await apply(page, '⭐');
  await expect(page).toHaveURL(new RegExp('page=' + database.id));
  await expect(rows.locator('[data-page-icon="⭐"]')).toBeVisible();
  await page.getByRole('button', { name: '檢視設定', exact: true }).click();
  await page.getByLabel('檢視形式', { exact: true }).selectOption('list');
  await page.keyboard.press('Escape');
  await expect(rows.locator('[data-page-icon="⭐"]')).toBeVisible();
  await rows.getByRole('button', { name: '更換「' + row.title + '」圖示', exact: true }).click();
  await apply(page, '📚');
  await expect(page).toHaveURL(new RegExp('page=' + database.id));
  await rows.getByRole('link', { name: row.title, exact: true }).click();
  await expect(header(page)).toContainText('📚');
  await peer.close();
});

test('ICON-03：雙分頁更新、離線快取與寫入失敗保留原圖示', async ({ page, context }) => {
  test.setTimeout(45_000);
  await openPrivate(page);
  const target = await note(page, '同步圖示', '📖');
  await visit(page, target.id);
  const peer = await context.newPage(); await visit(peer, target.id);
  await header(page).click(); await apply(page, '🇹🇼');
  await expect(header(peer)).toContainText('🇹🇼', { timeout: 12_000 });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('ready')).toHaveText('可編輯');
  await expect(header(page)).toContainText('🇹🇼');
  await expect(header(page)).toBeDisabled();
  await context.setOffline(false);
  await expect(header(page)).toBeEnabled();
  // 在 fetch 邊界注入，讓 WebKit 的 service worker 控制頁面也套用相同故障。
  await page.evaluate(path => {
    const original = window.fetch;
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      if (url.pathname === path && method === 'POST') return Response.json({ message: '圖示儲存暫時失敗' }, { status: 503 });
      return original(input, init);
    };
  }, '/api/pages/' + target.id + '/icon');
  await header(page).click();
  await dialog(page).getByRole('button', { name: '選擇圖示 💡', exact: true }).click();
  await expect(dialog(page).getByRole('alert')).toContainText('圖示儲存暫時失敗');
  await dialog(page).getByRole('button', { name: '關閉圖示選擇', exact: true }).click();
  await expect(header(page)).toContainText('🇹🇼');
  expect((await (await page.request.get('/api/pages/' + target.id)).json()).icon).toBe('🇹🇼');
  await peer.close();
});

test('ICON-03：較早寫入的延遲回應不蓋回已收到的最新圖示', async ({ page }) => {
  test.setTimeout(30_000);
  await openPrivate(page);
  const target = await note(page, '延遲圖示', '📝'); await visit(page, target.id);
  await page.evaluate(path => {
    const original = window.fetch;
    const delayed = { captured: false, release: () => {} };
    const held = new Promise<void>(resolve => { delayed.release = resolve; });
    (window as unknown as { delayedIconResponse: typeof delayed }).delayedIconResponse = delayed;
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      const response = await original(input, init);
      if (url.pathname === path && method === 'POST') { delayed.captured = true; await held; }
      return response;
    };
  }, '/api/pages/' + target.id + '/icon');
  await header(page).click();
  await dialog(page).getByRole('button', { name: '選擇圖示 💡', exact: true }).click();
  await page.waitForFunction(() => (window as unknown as { delayedIconResponse: { captured: boolean } }).delayedIconResponse.captured);
  expect((await post(page, '/api/pages/' + target.id + '/icon', { icon: '🌱' })).status()).toBe(200);
  await expect(header(page)).toContainText('🌱', { timeout: 12_000 });
  await page.evaluate(() => (window as unknown as { delayedIconResponse: { release: () => void } }).delayedIconResponse.release());
  await expect(dialog(page)).toBeHidden();
  await expect(header(page)).toContainText('🌱');
  await expect(page.locator('.pn-current-page [data-page-icon="🌱"]')).toBeVisible();
});

test('ICON-03：行內連結接受還原後新世代較低版本的圖示', async ({ page }) => {
  await openPrivate(page);
  const target = await note(page, '還原圖示目標', '📚');
  for (const icon of ['📝', '📚', '📝', '📚']) expect((await post(page, '/api/pages/' + target.id + '/icon', { icon })).status()).toBe(200);
  await visit(page, target.id);
  const source = await note(page, '還原圖示來源'); await visit(page, source.id);
  await page.evaluate(id => {
    const editor = window.probe!.editor;
    editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: [{ type: 'link', href: '/?page=' + id, content: '還原圖示目標' }] }]);
  }, target.id);
  await saved(page);
  const inline = page.locator('.tiptap .page-icon-trigger');
  await expect(inline).toContainText('📚');
  await page.evaluate(id => {
    const original = window.fetch;
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      const response = await original(input, init);
      if (url.pathname !== '/api/pages' || method !== 'GET' || !response.ok) return response;
      const pages = await response.json() as { id: string; sync_generation: string; metadata_revision: number; icon: string | null }[];
      return Response.json(pages.map(item => item.id === id ? { ...item, sync_generation: 'restored-generation', metadata_revision: 0, icon: '🌱' } : item), { status: response.status });
    };
  }, target.id);
  await expect(inline).toContainText('🌱', { timeout: 12_000 });
});

test('ICON-03：背景圖示更新保留正在編輯的標題草稿', async ({ page }) => {
  await openPrivate(page);
  const target = await note(page, '標題草稿頁', '📝'); await visit(page, target.id);
  await openPageActions(page);
  await page.getByRole('menuitem', { name: '重新命名', exact: true }).click();
  const title = page.getByLabel('頁面標題', { exact: true });
  await title.fill('尚未提交的標題');
  expect((await post(page, '/api/pages/' + target.id + '/icon', { icon: '🌱' })).status()).toBe(200);
  await expect(header(page)).toContainText('🌱', { timeout: 12_000 });
  await expect(title).toHaveValue('尚未提交的標題');
  await page.getByRole('button', { name: '儲存標題', exact: true }).click();
  await expect(page.getByLabel('文件標題', { exact: true })).toHaveValue('尚未提交的標題');
});
