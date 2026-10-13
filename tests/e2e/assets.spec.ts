import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import { images } from '../fixtures/images';
import { saved } from './helpers';
const file = { name: '中文原圖.png', mimeType: 'image/png', buffer: Buffer.from(images.png) };
async function login(page: Page, request: APIRequestContext) {
  await page.goto('/'); await page.getByLabel('Email', { exact: true }).fill('owner@example.test');
  await page.getByRole('button', { name: '寄送登入連結', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('查看登入郵件');
  const mails = await (await request.get('/__test/mailbox')).json() as { url: string }[];
  await page.goto(mails.at(-1)!.url); await page.getByRole('button', { name: '確認登入', exact: true }).click(); await saved(page);
}
const urls = (page: Page) => page.evaluate(() => window.probe!.editor.document.flatMap(block => block.type === 'image' && block.props.url ? [block.props.url] : []));
async function insert(page: Page) {
  await page.getByLabel('圖片檔案', { exact: true }).setInputFiles(file);
  await page.getByRole('button', { name: '上傳圖片', exact: true }).click();
  await expect.poll(() => urls(page)).toHaveLength(1); await saved(page);
  return (await urls(page))[0];
}
test.beforeEach(async ({ request }) => { await request.post('/__test/reset'); await request.post('/__test/control', { data: { now: Date.now() + 86400000 } }); });

test('ASSET-02：中斷上傳顯示失敗／重試，不插入不存在原檔的正式引用', async ({ page, request }) => {
  await login(page, request);
  await page.route('**/api/assets', route => route.abort('failed'));
  await page.getByLabel('圖片檔案', { exact: true }).setInputFiles(file);
  await page.getByRole('button', { name: '上傳圖片', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('上傳失敗'); expect(await urls(page)).toEqual([]);
  await expect(page.getByRole('button', { name: '重試上傳', exact: true })).toBeVisible();
  await page.unroute('**/api/assets'); await page.getByRole('button', { name: '重試上傳', exact: true }).click();
  await expect.poll(() => urls(page)).toHaveLength(1); await saved(page);
  expect(await (await page.request.get((await urls(page))[0])).body()).toEqual(file.buffer);
});

test('ASSET-04：含圖片頁面垃圾桶再還原，引用與原檔保持一致', async ({ page, request }) => {
  await login(page, request); const url = await insert(page); const original = page.url();
  await page.getByText('頁面操作', { exact: true }).click();
  await Promise.all([page.waitForEvent('framenavigated', frame => frame === page.mainFrame()), page.getByRole('button', { name: '移到垃圾桶', exact: true }).click()]);
  await page.goto(original); await expect(page.getByRole('alert')).toContainText('垃圾桶');
  await Promise.all([page.waitForEvent('framenavigated', frame => frame === page.mainFrame()), page.getByRole('button', { name: '還原此頁', exact: true }).click()]);
  await saved(page); expect(await urls(page)).toEqual([url]);
  expect(await (await page.request.get(url)).body()).toEqual(file.buffer);
  await expect(page.locator('.tiptap img')).toBeVisible();
});

test('EDIT-03：上傳原圖後另一 context／重開讀到穩定引用與相同位元組', async ({ page, request, browser }) => {
  await login(page, request); const url = await insert(page);
  expect(url).toMatch(/^\/api\/assets\/[\w-]+$/);
  const context = await browser.newContext({ storageState: await page.context().storageState() });
  try {
    const other = await context.newPage(); await other.goto(page.url()); await saved(other);
    expect(await urls(other)).toEqual([url]); expect(await (await other.request.get(url)).body()).toEqual(file.buffer);
    await expect(other.locator('.tiptap img')).toBeVisible();
    await page.reload(); await saved(page); expect(await urls(page)).toEqual([url]);
    const denied = await request.get(url); expect(denied.status()).toBe(401);
    await expect.poll(() => page.locator('.tiptap img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  } finally { await context.close(); }
});

test('ASSET-CLIENT-01：拒絕格式／超限，BlockNote 原生上傳入口沿用私有 API', async ({ page, request }) => {
  await login(page, request);
  await page.getByLabel('圖片檔案', { exact: true }).setInputFiles({ name: '偽造.png', mimeType: 'image/png', buffer: Buffer.from('<svg/>') });
  await page.getByRole('button', { name: '上傳圖片', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('圖片'); expect(await urls(page)).toEqual([]);
  await page.evaluate(async base64 => {
    const file = new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], '原生上傳.png', { type: 'image/png' });
    const editor = window.probe!.editor; const url = await editor.uploadFile!(file);
    if (typeof url !== 'string') throw new Error('上傳必須回傳穩定引用');
    editor.insertBlocks([{ type: 'image', props: { url, name: file.name, showPreview: true } }], editor.document[0], 'after');
  }, file.buffer.toString('base64'));
  await saved(page); expect((await urls(page))[0]).toMatch(/^\/api\/assets\//);
});
