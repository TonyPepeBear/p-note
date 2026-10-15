import { expect, test } from '@playwright/test';
import { blocks, openPageActions, openPrivate, saved } from './helpers';

test.setTimeout(60000);
test.beforeEach(async ({ request }) => {
  await request.post('/__test/reset');
  await request.post('/__test/control', { data: { now: Date.now() + 86400000 } });
});

test('SB-18 HIST-02：歷史同步引用以唯讀外框及 ID 預覽，不載入目前內容或建立同步連線', async ({ page }) => {
  const id = await openPrivate(page);
  const headers = { Origin: new URL(page.url()).origin };
  const created = await page.request.post('/api/synced-blocks', {
    headers, data: { blocks: [{ type: 'paragraph', content: '同步內容不屬於頁面歷史快照' }] },
  });
  expect(created.status()).toBe(200);
  const synced = await created.json() as { id: string };
  await page.evaluate(syncedId => {
    const editor = window.probe!.editor;
    editor.replaceBlocks(editor.document, [
      { type: 'paragraph', content: '引用前的歷史文字' },
      { type: 'syncedBlock', props: { syncedBlockId: syncedId } },
      { type: 'syncedBlock', props: { syncedBlockId: syncedId } },
    ]);
  }, synced.id);
  await expect(page.getByTestId('synced-block')).toHaveCount(2);
  await saved(page);
  const snapshot = await page.request.post(`/api/pages/${id}/history`, { headers, data: {} });
  expect(snapshot.status()).toBe(201);
  const version = await snapshot.json() as { id: string };
  await page.evaluate(() => {
    const editor = window.probe!.editor;
    editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: '目前頁面仍保持一般正文' }]);
  });
  await expect(page.getByTestId('synced-block')).toHaveCount(0);
  await saved(page);
  const current = await blocks(page);
  const syncConnections: string[] = [];
  const contentRequests: string[] = [];
  page.on('websocket', socket => {
    if (new URL(socket.url()).searchParams.has('syncedBlock')) syncConnections.push(socket.url());
  });
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/synced-blocks/')) contentRequests.push(request.url());
  });
  await openPageActions(page);
  await page.getByRole('menuitem', { name: '版本歷史', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '版本歷史', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.locator(`[data-version-id="${version.id}"]`).click();
  const preview = dialog.getByRole('region', { name: '版本預覽' });
  const references = preview.getByTestId('history-synced-block');
  await expect(preview).toContainText('引用前的歷史文字');
  await expect(references).toHaveCount(2);
  for (const reference of await references.all()) {
    await expect(reference).toHaveAttribute('data-synced-block-id', synced.id);
    await expect(reference).toContainText('ID：' + synced.id);
    await expect(reference).toContainText('此版本只保存引用');
    expect(await reference.evaluate(element => Number.parseFloat(getComputedStyle(element).borderTopWidth))).toBeGreaterThan(0);
  }
  await expect(preview.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(preview).not.toContainText('同步內容不屬於頁面歷史快照');
  await expect(preview.getByRole('button', { name: '解除同步', exact: true })).toHaveCount(0);
  expect(syncConnections).toEqual([]);
  expect(contentRequests).toEqual([]);
  expect(await blocks(page)).toEqual(current);
});
