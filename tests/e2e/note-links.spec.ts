import { expect, test, type Page } from '@playwright/test';
import { openPrivate, saved, blocks, gate, release, heldCount } from './helpers';

// 多次換頁與重連的流程允許完整操作時間，個別斷言仍沿用 5 秒上限。
test.describe.configure({ timeout: 40000 });

test.beforeEach(async ({ request }) => {
  await request.post('/__test/reset');
  await request.post('/__test/control', { data: { now: Date.now() + 86400000 } });
});

async function note(page: Page, title: string, parent_id?: string) {
  const response = await page.request.post('/api/pages', { data: { title, parent_id }, headers: { Origin: new URL(page.url()).origin } });
  expect(response.status()).toBe(200);
  return response.json() as Promise<{ id: string; title: string }>;
}
// 正式 dist 不使用開發模組；透過真正站內連結切換。
async function visit(page: Page, id: string) {
  await page.goto('/?page=' + id);
  await expect(page.getByTestId('ready')).toHaveText('可編輯');
  await saved(page);
}
async function insert(page: Page, title: string, offline = false) {
  await page.locator('.tiptap').click();
  await page.keyboard.type('[[');
  await page.keyboard.insertText(title);
  await page.getByRole('option', { name: title, exact: false }).first().click();
  if (offline) await expect(page.getByTestId('local-status')).toHaveText('本機已儲存');
  else await saved(page);
}

test('LINK-01：中文同名與日記搜尋、鍵盤插入、重開與站內導航', async ({ page }) => {
  await openPrivate(page);
  const source = await note(page, '來源筆記');
  const targets = [await note(page, '中文目標'), await note(page, '中文目標')];
  await visit(page, source.id);
  await page.locator('.tiptap').click();
  await page.keyboard.type('[['); await page.keyboard.insertText('中文');
  const options = page.getByRole('listbox', { name: '筆記連結搜尋' }).getByRole('option');
  await expect(options).toHaveCount(2);
  await expect(options).toContainText(['中文目標', '中文目標']);
  await expect(page.getByRole('option', { selected: true })).toContainText('中文目標');
  await page.keyboard.press('Enter');
  await saved(page);
  const link = page.locator('.tiptap a').first();
  const href = await link.getAttribute('href');
  await expect(link).toHaveText('中文目標');
  expect(targets.map(target => '/?page=' + target.id)).toContain(href);
  await expect(page.locator('.tiptap')).not.toContainText('[[');
  const before = await blocks(page);
  await page.reload();
  await expect(page.getByTestId('ready')).toHaveText('可編輯');
  expect(await blocks(page)).toEqual(before);
  await page.evaluate(() => { (window as unknown as { bootMarker: string }).bootMarker = '同一工作區'; });
  await page.locator('.tiptap a').first().click();
  await expect(page).toHaveURL(new RegExp('page=' + href!.split('=')[1]));
  await expect(page.getByLabel('文件標題')).toHaveValue('中文目標');
  expect(await page.evaluate(() => (window as unknown as { bootMarker: string }).bootMarker)).toBe('同一工作區');
  await expect(page.getByRole('region', { name: '反向連結' })).toContainText('來源筆記');
  await visit(page, source.id);
  await page.evaluate(() => { const e = window.probe!.editor; e.setTextCursorPosition(e.document.at(-1)!, 'end'); e.insertInlineContent(' '); e.focus(); });
  await page.keyboard.type('[['); await page.keyboard.insertText('20');
  await expect(page.getByRole('option', { name: /日記/ }).first()).toBeVisible();
  await page.keyboard.press('Escape');
});

test('LINK-01：搜尋尚未完成時 Enter 保留輸入，不插入上一批結果', async ({ page }) => {
  await openPrivate(page);
  const source = await note(page, '搜尋來源');
  const target = await note(page, '延遲目標');
  await visit(page, source.id);
  await page.locator('.tiptap').click();
  await page.keyboard.type('[[');
  await expect(page.getByRole('option', { name: /搜尋來源/ })).toBeVisible();
  await gate(page, [{ pattern: '^/api/pages$', hold: true }]);
  await page.keyboard.insertText('延遲');
  await expect.poll(() => heldCount(page, '^/api/pages$')).toBeGreaterThan(0);
  await page.keyboard.press('Enter');
  await expect(page.locator('.tiptap a')).toHaveCount(0);
  await expect(page.locator('.tiptap')).toContainText('[[延遲');
  await expect(page.getByRole('option')).toHaveCount(0);
  await release(page, '^/api/pages$');
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('option', { selected: true })).toContainText('延遲目標');
  await page.keyboard.press('Enter');
  await expect(page.locator('.tiptap a')).toHaveAttribute('href', '/?page=' + target.id);
  await expect(page.locator('.tiptap a')).toHaveText('延遲目標');
  await saved(page);
});

test('LINK-02：反向來源去重、可返回且移除最後連結後消失', async ({ page }) => {
  await openPrivate(page);
  const source = await note(page, '引用來源'); const target = await note(page, '引用目標');
  await visit(page, source.id);
  await page.evaluate(id => {
    const e = window.probe!.editor;
    const link = { type: 'link' as const, href: '/?page=' + id, content: '引用目標' };
    e.replaceBlocks(e.document, [{ type: 'paragraph', content: [link, ' ', link] }]);
  }, target.id);
  await saved(page); await visit(page, target.id);
  const backlinks = page.getByRole('region', { name: '反向連結' });
  await expect(backlinks.getByRole('link', { name: '引用來源' })).toHaveCount(1);
  await backlinks.getByRole('link', { name: '引用來源' }).click();
  await expect(page.getByLabel('文件標題')).toHaveValue('引用來源');
  await page.evaluate(() => { const e = window.probe!.editor; e.replaceBlocks(e.document, [{ type: 'paragraph', content: '已移除引用' }]); });
  await saved(page); await visit(page, target.id);
  await expect(backlinks).toContainText('目前沒有其他筆記引用這頁');
});

test('LINK-03：改名保留目標、垃圾桶來源排除與還原恢復', async ({ page }) => {
  await openPrivate(page); const source = await note(page, '改名前來源'); const target = await note(page, '改名前目標');
  await visit(page, source.id); await insert(page, target.title);
  const post = (path: string, data: object) => page.request.post(path, { data, headers: { Origin: new URL(page.url()).origin } });
  expect((await post('/api/pages/' + target.id + '/title', { title: '改名後目標' })).status()).toBe(200);
  await page.locator('.tiptap a').click(); await expect(page.getByLabel('文件標題')).toHaveValue('改名後目標');
  expect((await post('/api/pages/' + source.id + '/title', { title: '改名後來源' })).status()).toBe(200);
  const region = page.getByRole('region', { name: '反向連結' });
  await expect(region).toContainText('改名後來源');
  expect((await post('/api/pages/' + source.id + '/delete', {})).status()).toBe(200);
  await expect(region).toContainText('目前沒有其他筆記引用這頁');
  expect((await post('/api/pages/' + source.id + '/restore', {})).status()).toBe(200);
  await expect(region).toContainText('改名後來源');
  expect((await post('/api/pages/' + target.id + '/delete', {})).status()).toBe(200);
  await visit(page, source.id); await page.locator('.tiptap a').click();
  await expect(page.getByText('這頁在垃圾桶中', { exact: true })).toBeVisible();
});

test('LINK-04：離線插入快取連結刷新保留，重連同步至另一端', async ({ page, context }) => {
  await openPrivate(page); const source = await note(page, '離線來源'); const target = await note(page, '離線目標');
  await visit(page, target.id); await visit(page, source.id);
  const peer = await context.newPage(); await visit(peer, source.id);
  await context.setOffline(true);
  await insert(page, target.title, true);
  await expect(page.locator('.tiptap a')).toHaveAttribute('href', '/?page=' + target.id);
  await page.reload(); await expect(page.getByTestId('ready')).toHaveText('可編輯');
  await expect(page.locator('.tiptap a')).toHaveAttribute('href', '/?page=' + target.id);
  await expect(page.getByRole('region', { name: '反向連結' })).toContainText('連線後');
  await context.setOffline(false); await saved(page);
  await expect(peer.locator('.tiptap a')).toHaveAttribute('href', '/?page=' + target.id);
  await visit(page, target.id); await expect(page.getByRole('region', { name: '反向連結' })).toContainText('離線來源');
});

test('LINK-06：查詢失敗可重試、導航保存失敗留在來源且手機無溢出', async ({ page }) => {
  await openPrivate(page); const source = await note(page, '錯誤來源'); const target = await note(page, '錯誤目標');
  await visit(page, source.id);
  await gate(page, [{ pattern: '^/api/pages$', result: 503 }, { pattern: '/backlinks$', result: 503 }]);
  await page.locator('.tiptap').click(); await page.keyboard.type('[['); await page.keyboard.insertText('錯誤');
  await expect(page.getByRole('option', { name: /搜尋失敗/ })).toBeVisible();
  await page.getByRole('option', { name: /搜尋失敗/ }).click();
  await expect(page.locator('.tiptap')).toContainText('[[錯誤');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: '反向連結' })).toContainText('反向連結讀取失敗');
  await gate(page, []); await page.getByRole('button', { name: '重試反向連結' }).click();
  await expect(page.getByRole('region', { name: '反向連結' })).toContainText('目前沒有其他筆記引用這頁');
  await page.evaluate(() => { const e = window.probe!.editor; e.replaceBlocks(e.document, [{ type: 'paragraph', content: '' }]); e.setTextCursorPosition(e.document[0], 'start'); });
  await insert(page, target.title);
  await page.evaluate(() => { window.probe!.cache.db!.close(); });
  await page.locator('.tiptap a').click();
  await expect(page.getByRole('alert')).toContainText('本機儲存失敗');
  await expect(page).toHaveURL(new RegExp('page=' + source.id));
  await expect(page.locator('.tiptap a')).toHaveAttribute('href', '/?page=' + target.id);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('LINK-01：沒有結果保留輸入，程式碼不開連結選單', async ({ page }) => {
  await openPrivate(page);
  await page.locator('.tiptap').click(); await page.keyboard.type('[['); await page.keyboard.insertText('不存在的筆記名稱');
  await expect(page.locator('.tiptap')).toContainText('[[不存在的筆記名稱');
  await expect(page.getByRole('option')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const e = window.probe!.editor; e.replaceBlocks(e.document, [{ type: 'codeBlock', content: '' }]); e.setTextCursorPosition(e.document[0], 'start'); e.focus(); });
  await page.keyboard.type('[[');
  await expect(page.getByRole('listbox', { name: '筆記連結搜尋' })).toHaveCount(0);
  await expect(page.locator('.tiptap')).toContainText('[[');
});
