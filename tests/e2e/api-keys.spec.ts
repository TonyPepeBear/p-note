import { test, expect } from '@playwright/test';
import { openPrivate, showNavigation, saved } from './helpers';

test.beforeEach(async ({ request }) => { await request.post('/__test/reset'); await request.post('/__test/control', { data: { now: Date.now() + 86400000 } }); });
test('KEY-01 KEY-02：設定頁建立、再次顯示、複製及撤銷', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as unknown as { copied: string }).copied = text; } } }); });
  await openPrivate(page); await showNavigation(page); await page.getByRole('button', { name: '設定', exact: true }).click();
  await expect(page.getByRole('heading', { name: '設定', exact: true })).toBeVisible();
  await page.getByLabel('API key 名稱').fill('我的自動化'); await page.getByRole('button', { name: '建立 API key', exact: true }).click();
  const card = page.getByTestId('api-key-card'); await expect(card).toHaveCount(1);
  await expect(card.getByLabel('完整 API key')).toHaveCount(0);
  await card.getByRole('button', { name: '顯示', exact: true }).click(); const token = await card.getByLabel('完整 API key').inputValue();
  expect(/^pn_[a-f0-9]{64}$/.test(token)).toBe(true);
  await card.getByRole('button', { name: '複製', exact: true }).click();
  expect(await page.evaluate(value => (window as unknown as { copied: string }).copied === value, token)).toBe(true);
  await card.getByRole('button', { name: '隱藏', exact: true }).click(); await expect(card.getByLabel('完整 API key')).toHaveCount(0);
  await page.getByRole('button', { name: '返回筆記' }).click(); await showNavigation(page); await page.getByRole('button', { name: '設定', exact: true }).click();
  await card.getByRole('button', { name: '顯示', exact: true }).click();
  expect(await card.getByLabel('完整 API key').inputValue() === token).toBe(true);
  expect(await page.evaluate(value => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(x => x.includes(value)), token)).toBe(false);
  await card.getByRole('button', { name: '撤銷', exact: true }).click(); await page.getByRole('button', { name: '確認撤銷', exact: true }).click();
  await expect(card).toHaveCount(0);
  expect((await page.request.get('/api/v1/pages', { headers: { Authorization: 'Bearer ' + token } })).status()).toBe(401);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('KEY-04：網站與 API 正文雙向同步，網站修改使舊 ETag 失效', async ({ page, baseURL }) => {
  const id = await openPrivate(page); const headers = { Origin: baseURL! };
  const k = await (await page.request.post('/api/keys', { headers, data: { name: '同步驗證' } })).json();
  const { key } = await (await page.request.post(`/api/keys/${k.id}/reveal`, { headers, data: {} })).json();
  const auth = { Authorization: 'Bearer ' + key }; const path = `/api/v1/pages/${id}/content`;
  const get = await page.request.get(path, { headers: auth }); expect(get.status()).toBe(200);
  const put = await page.request.put(path, { headers: { ...auth, 'If-Match': get.headers().etag }, data: { blocks: [{ type: 'paragraph', content: 'API 即時寫入內容' }] } }); expect(put.status()).toBe(200);
  await expect(page.locator('.tiptap')).toContainText('API 即時寫入內容');
  await page.evaluate(() => window.probe!.editor.updateBlock(window.probe!.editor.document[0], { content: '網站修改內容' })); await saved(page);
  expect(JSON.stringify(await (await page.request.get(path, { headers: auth })).json())).toContain('網站修改內容');
  expect((await page.request.put(path, { headers: { ...auth, 'If-Match': put.headers().etag }, data: { blocks: [] } })).status()).toBe(412);
  await page.reload(); await saved(page); await expect(page.locator('.tiptap')).toContainText('網站修改內容');
});
