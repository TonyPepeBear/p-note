import { expect, test, type Page } from '@playwright/test';
import { openPrivate, openPageActions, saved, blocks, gate, setRule } from './helpers';
import type { PageVersion } from '../../src/shared/history';

test.describe.configure({ timeout: 60000 });
test.beforeEach(async ({ request }) => {
  await request.post('/__test/reset');
  await request.post('/__test/control', { data: { now: Date.now() + 86400000 } });
});

async function history(page: Page) {
  await openPageActions(page);
  await page.getByRole('menuitem', { name: '版本歷史', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '版本歷史', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function write(page: Page, text: string) {
  await page.evaluate(text => {
    const editor = window.probe!.editor;
    editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: text }]);
  }, text);
  await saved(page);
}

async function version(page: Page, id: string) {
  const response = await page.request.post(`/api/pages/${id}/history`, { data: {}, headers: { Origin: new URL(page.url()).origin } });
  expect(response.status()).toBe(201);
  return response.json() as Promise<PageVersion>;
}

test('HIST-01：從頁面操作開啟歷史並手動建立持久版本', async ({ page }) => {
  const id = await openPrivate(page);
  await page.evaluate(() => {
    const editor = window.probe!.editor;
    editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: '第一份需要保留的內容' }]);
  });
  await saved(page);
  const before = await blocks(page);
  const dialog = await history(page);
  const created = page.waitForResponse(response => response.url().endsWith(`/api/pages/${id}/history`) && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: '建立版本', exact: true }).click();
  expect((await created).status()).toBe(201);
  await expect(dialog).toContainText('手動建立');
  await page.reload();
  await expect(page.getByTestId('ready')).toHaveText('可編輯');
  expect(await blocks(page)).toEqual(before);
  await expect(await history(page)).toContainText('手動建立');
});

test('HIST-02：歷史格式唯讀預覽不改變目前文件且手機沒有溢出', async ({ page }) => {
  const id = await openPrivate(page);
  await page.evaluate(() => {
    const editor = window.probe!.editor;
    editor.replaceBlocks(editor.document, [
      { type: 'heading', props: { level: 2 }, content: '歷史標題區塊' },
      { type: 'bulletListItem', content: [{ type: 'text', text: '粗體內容', styles: { bold: true } }], children: [{ type: 'paragraph', content: '巢狀舊內容' }] },
    ]);
  });
  await saved(page);
  const old = await version(page, id);
  await write(page, '目前內容不應被預覽改變');
  const current = await blocks(page);
  const dialog = await history(page);
  await dialog.locator(`[data-version-id="${old.id}"]`).click();
  const preview = dialog.getByRole('region', { name: '版本預覽' });
  await expect(preview).toContainText('歷史標題區塊');
  await expect(preview).toContainText('巢狀舊內容');
  await expect(preview.locator('strong')).toContainText('粗體內容');
  await expect(preview.locator('[contenteditable="true"]')).toHaveCount(0);
  expect(await blocks(page)).toEqual(current);
  const width = await dialog.evaluate(element => ({ scroll: element.scrollWidth, width: element.clientWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.width + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test('HIST-03 HIST-04：還原保護目前版本並隔離第二裝置的舊世代', async ({ page, browser }) => {
  const id = await openPrivate(page);
  await write(page, '較早的正文內容');
  const old = await version(page, id);
  const currentInfo = await (await page.request.get(`/api/pages/${id}`)).json() as { sync_generation: string };
  await write(page, '還原前的最新正文');
  const secondContext = await browser.newContext({ storageState: await page.context().storageState(), ignoreHTTPSErrors: true });
  const second = await secondContext.newPage();
  try {
    await second.goto(page.url());
    await expect(second.getByTestId('ready')).toHaveText('可編輯');
    await saved(second);
    const dialog = await history(page);
    await dialog.locator(`[data-version-id="${old.id}"]`).click();
    await expect(dialog.getByRole('region', { name: '版本預覽' })).toContainText('較早的正文內容');
    await dialog.getByRole('button', { name: '還原此版本', exact: true }).click();
    await dialog.getByRole('button', { name: '確認還原版本', exact: true }).click();
    await expect(page.getByTestId('ready')).toHaveText('可編輯');
    await expect(page.locator('.editor-document .tiptap')).toContainText('較早的正文內容');
    await expect(page.locator('.editor-document .tiptap')).not.toContainText('還原前的最新正文');
    const restoredInfo = await (await page.request.get(`/api/pages/${id}`)).json() as { sync_generation: string };
    expect(restoredInfo.sync_generation).not.toBe(currentInfo.sync_generation);
    await second.reload();
    await expect(second.getByText('本機修改已另外保留', { exact: true })).toBeVisible();
    await expect(second.getByRole('button', { name: '載入目前版本', exact: true })).toBeVisible();
    const again = await history(page);
    await expect(again).toContainText('還原前保存');
    const listing = await (await page.request.get(`/api/pages/${id}/history`)).json() as { versions: PageVersion[] };
    const before = listing.versions.find(item => item.reason === 'before_restore');
    expect(before).toBeDefined();
    await again.locator(`[data-version-id="${before!.id}"]`).click();
    await expect(again.getByRole('region', { name: '版本預覽' })).toContainText('還原前的最新正文');
  } finally { await secondContext.close(); }
});

test('HIST-06：清單與預覽錯誤可重試，離線保留正文', async ({ page, context }) => {
  const id = await openPrivate(page);
  await write(page, '故障期間仍要保留的正文');
  const old = await version(page, id);
  const listingPattern = `^/api/pages/${id}/history(?:\\?.*)?$`;
  // 在 fetch 邊界注入故障，確保 WebKit 的 service worker 也使用相同故障回應。
  await gate(page, [{ pattern: listingPattern, result: 503 }]);
  const dialog = await history(page);
  await expect(dialog).toContainText('測試錯誤');
  await setRule(page, { pattern: listingPattern, result: 'pass' });
  await dialog.getByRole('button', { name: '重試載入', exact: true }).click();
  await expect(dialog.locator(`[data-version-id="${old.id}"]`)).toBeVisible();
  const previewPattern = `^/api/pages/${id}/history/${old.id}$`;
  await setRule(page, { pattern: previewPattern, result: 503 });
  await dialog.locator(`[data-version-id="${old.id}"]`).click();
  await expect(dialog).toContainText('測試錯誤');
  await setRule(page, { pattern: previewPattern, result: 'pass' });
  await dialog.locator(`[data-version-id="${old.id}"]`).click();
  await expect(dialog.getByRole('region', { name: '版本預覽' })).toContainText('故障期間仍要保留的正文');
  await context.setOffline(true);
  await expect(dialog).toContainText('需要連線');
  await expect(dialog.getByRole('button', { name: '建立版本', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '還原此版本', exact: true })).toBeDisabled();
  await context.setOffline(false);
  expect(JSON.stringify(await blocks(page))).toContain('故障期間仍要保留的正文');
});

test('HIST-03 HIST-06：還原失敗保留目前內容並以相同操作識別重試', async ({ page }) => {
  const id = await openPrivate(page);
  await write(page, '重試還原的目標內容');
  const old = await version(page, id);
  await write(page, '服務失敗時的目前內容');
  const before = await blocks(page);
  const dialog = await history(page);
  await dialog.locator(`[data-version-id="${old.id}"]`).click();
  await page.evaluate(path => {
    const original = window.fetch;
    const failure = { ids: [] as string[], fail: true };
    (window as unknown as { historyRestoreFailure: typeof failure }).historyRestoreFailure = failure;
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      if (url.pathname === path && method === 'POST') {
        failure.ids.push((JSON.parse(String(init?.body)) as { request_id: string }).request_id);
        if (failure.fail) return Response.json({ message: '測試還原暫時失敗' }, { status: 503 });
      }
      return original(input, init);
    };
  }, `/api/pages/${id}/history/${old.id}/restore`);
  await dialog.getByRole('button', { name: '還原此版本', exact: true }).click();
  await dialog.getByRole('button', { name: '確認還原版本', exact: true }).click();
  await expect(dialog).toContainText('測試還原暫時失敗');
  expect(await blocks(page)).toEqual(before);
  await page.evaluate(() => { (window as unknown as { historyRestoreFailure: { fail: boolean } }).historyRestoreFailure.fail = false; });
  await dialog.getByRole('button', { name: '重試還原', exact: true }).click();
  await expect(page.locator('.editor-document .tiptap')).toContainText('重試還原的目標內容');
  const requestIds = await page.evaluate(() => (window as unknown as { historyRestoreFailure: { ids: string[] } }).historyRestoreFailure.ids);
  expect(requestIds).toHaveLength(2);
  expect(requestIds[0]).toBe(requestIds[1]);
});

test('HIST-01 HIST-03：尚在編輯的標題先保存，還原後標題與正文一致', async ({ page }) => {
  const id = await openPrivate(page);
  const title = page.getByLabel('文件標題', { exact: true });
  const oldTitle = await title.inputValue();
  await write(page, '與舊標題一起保存的正文');
  const old = await version(page, id);
  await write(page, '更新後的正文');
  await title.fill('尚未離開輸入欄的標題');
  const dialog = await history(page);
  const created = page.waitForResponse(response => response.url().endsWith(`/api/pages/${id}/history`) && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: '建立版本', exact: true }).click();
  expect((await created).status()).toBe(201);
  const listing = await (await page.request.get(`/api/pages/${id}/history`)).json() as { versions: PageVersion[] };
  expect(listing.versions.some(item => item.reason === 'manual' && item.title === '尚未離開輸入欄的標題')).toBe(true);
  await dialog.locator(`[data-version-id="${old.id}"]`).click();
  await dialog.getByRole('button', { name: '還原此版本', exact: true }).click();
  await dialog.getByRole('button', { name: '確認還原版本', exact: true }).click();
  await expect(page.getByLabel('文件標題')).toHaveValue(oldTitle);
  await expect(page.locator('.editor-document .tiptap')).toContainText('與舊標題一起保存的正文');
});

test('HIST-02：載入更多顯示較早版本且清單不重複', async ({ page }) => {
  const id = await openPrivate(page);
  let oldest: PageVersion | undefined;
  for (let index = 0; index < 22; index++) {
    await write(page, `分頁歷史內容 ${index}`);
    const item = await version(page, id);
    oldest ??= item;
  }
  const dialog = await history(page);
  await expect(dialog.locator(`[data-version-id="${oldest!.id}"]`)).toHaveCount(0);
  await dialog.getByRole('button', { name: '載入更多', exact: true }).click();
  await expect(dialog.locator(`[data-version-id="${oldest!.id}"]`)).toBeVisible();
  const ids = await dialog.locator('[data-version-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-version-id')));
  expect(new Set(ids).size).toBe(ids.length);
  await dialog.locator(`[data-version-id="${oldest!.id}"]`).click();
  await expect(dialog.getByRole('region', { name: '版本預覽' })).toContainText('分頁歷史內容 0');
});

test('HIST-04：伺服器切換中斷後，乾淨裝置開啟其他頁也能找到並繼續還原', async ({ page, browser }) => {
  const id = await openPrivate(page);
  await write(page, '跨裝置續作的目標內容');
  const old = await version(page, id);
  await write(page, '跨裝置續作前的受保護內容');
  const origin = new URL(page.url()).origin;
  const otherResponse = await page.request.post('/api/pages', { data: { title: '其他頁面' }, headers: { Origin: origin } });
  const other = await otherResponse.json() as { id: string };
  await page.request.post('/__test/history-failure', { data: { fail: true } });
  const failed = await page.request.post(`/api/pages/${id}/history/${old.id}/restore`, { data: { request_id: crypto.randomUUID() }, headers: { Origin: origin } });
  expect(failed.status()).toBe(503);
  const fresh = await browser.newContext({ storageState: await page.context().storageState(), ignoreHTTPSErrors: true });
  try {
    const clean = await fresh.newPage();
    await clean.goto(`${origin}/?page=${other.id}`);
    const recovery = clean.getByRole('region', { name: '繼續版本還原', exact: true });
    await expect(recovery).toBeVisible();
    await clean.reload();
    await expect(recovery).toBeVisible();
    await page.request.post('/__test/history-failure', { data: { fail: false } });
    await recovery.getByRole('button', { name: '繼續還原', exact: true }).click();
    await expect(clean).toHaveURL(new RegExp(`page=${id}`));
    await expect(clean.getByTestId('ready')).toHaveText('可編輯');
    await expect(clean.locator('.editor-document .tiptap')).toContainText('跨裝置續作的目標內容');
    const listing = await (await clean.request.get(`/api/pages/${id}/history`)).json() as { versions: PageVersion[] };
    const before = listing.versions.find(item => item.reason === 'before_restore');
    expect(before).toBeDefined();
    const preview = await (await clean.request.get(`/api/pages/${id}/history/${before!.id}`)).json();
    expect(JSON.stringify(preview)).toContain('跨裝置續作前的受保護內容');
  } finally {
    await page.request.post('/__test/history-failure', { data: { fail: false } });
    await fresh.close();
  }
});
