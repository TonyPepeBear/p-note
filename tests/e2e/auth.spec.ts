import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import { saved } from './helpers';

const origin = 'http://127.0.0.1:5173';
async function control(request: APIRequestContext, now: number, fail = false) {
  expect((await request.post('/__test/control', { data: { now, fail } })).ok()).toBe(true);
}
async function mail(request: APIRequestContext) {
  const response = await request.get('/__test/mailbox');
  return (await response.json() as { url: string }[]).at(-1)!.url;
}
async function requestLink(page: Page) {
  await page.getByLabel('Email').fill('owner@example.test');
  await page.getByRole('button', { name: '寄送登入連結', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('查看登入郵件');
}
async function confirm(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByRole('button', { name: '確認登入', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '確認登入', exact: true }).click();
}
async function login(page: Page, request: APIRequestContext) {
  await page.goto('/'); await requestLink(page); await confirm(page, await mail(request));
  await expect(page.locator('.tiptap[contenteditable="true"]')).toHaveCount(1);
  await saved(page);
}
test.beforeEach(async ({ request }) => {
  expect((await request.post('/__test/reset')).ok()).toBe(true);
  await control(request, Date.now());
});

test('AUTH-01：掃描只開確認頁，按鈕 POST 登入今日編輯器', async ({ page, request, context }) => {
  await page.goto('/'); await requestLink(page);
  const url = await mail(request);
  await page.goto(url);
  expect((await context.cookies()).filter(cookie => cookie.name.includes('session_token'))).toEqual([]);
  await page.getByRole('button', { name: '確認登入', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^日記/ })).toBeVisible();
  await saved(page);
  expect(new URL(page.url()).searchParams.get('page')).toBeTruthy();
  expect((await context.cookies()).some(cookie => cookie.name.includes('session_token') && cookie.httpOnly)).toBe(true);
});

test('AUTH-03：重用與過期連結顯示錯誤及重新申請入口', async ({ page, request }) => {
  await page.goto('/'); await requestLink(page);
  const url = await mail(request); await confirm(page, url);
  await expect(page.locator('.tiptap[contenteditable="true"]')).toHaveCount(1);
  await confirm(page, url);
  await expect(page.getByRole('alert')).toContainText('重新申請');
  await expect(page.getByRole('button', { name: '寄送登入連結', exact: true })).toBeVisible();
  await control(request, Date.now() + 60000);
  await requestLink(page);
  const expired = await mail(request);
  await control(request, Date.now() + 660000);
  await confirm(page, expired);
  await expect(page.getByRole('alert')).toContainText('過期');
});

test('AUTH-04：寄信失敗與限流只有錯誤，沒有成功提示或憑證', async ({ page, request }) => {
  const now = Date.now(); await control(request, now, true);
  await page.goto('/');
  await page.getByLabel('Email').fill('owner@example.test');
  await page.getByRole('button', { name: '寄送登入連結', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('稍後重試');
  await expect(page.getByRole('status')).not.toContainText('查看登入郵件');
  await page.getByRole('button', { name: '寄送登入連結', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('頻繁');
  expect(await page.locator('main').innerText()).not.toMatch(/token|secret/);
});

test('AUTH-05：重開在 30 天內沿用 cookie，讀取不寄信且不續期', async ({ page, request }) => {
  await login(page, request);
  const original = page.url();
  await control(request, Date.now() + 29 * 86400000);
  await page.reload();
  await expect(page.locator('.tiptap[contenteditable="true"]')).toHaveCount(1);
  expect(page.url()).toBe(original);
  expect((await (await request.get('/__test/mailbox')).json()).length).toBe(1);
});

test('AUTH-06：離線草稿在到期後仍存在，重新登入返回原頁並重驗世代', async ({ page, context, request }) => {
  const now = Date.now(); await control(request, now); await login(page, request);
  const original = page.url();
  await context.setOffline(true);
  await page.locator('.tiptap').pressSequentially('未同步草稿');
  await expect(page.getByTestId('local-status')).toHaveText('本機已儲存');
  await control(request, now + 30 * 86400000);
  await context.setOffline(false);
  await expect(page.getByRole('alert')).toContainText('重新登入');
  await expect(page.locator('.tiptap')).toContainText('未同步草稿');
  const local = await page.evaluate(() => window.probe!.localState().then(bytes => Array.from(bytes)));
  expect(local.length).toBeGreaterThan(2);
  await requestLink(page); await confirm(page, await mail(request));
  await expect(page.locator('.tiptap')).toContainText('未同步草稿');
  expect(page.url()).toBe(original);
  await saved(page);
  const metadata = await (await page.request.get('/api/pages/' + new URL(original).searchParams.get('page'))).json();
  expect(await page.evaluate(() => window.probe!.room)).toBe(metadata.room);
});
