import { test, expect } from '@playwright/test';
import { openPrivate, saved } from '../e2e/helpers';

test('BUILD-01：真實 dist 在 HTTPS Worker 登入、wss 保存與離線刷新可用', async ({ page, context, request }) => {
  await request.post('/__test/reset'); await request.post('/__test/control', { data: { now: Date.now() + 86400000 } });
  const response = await request.get('/'); expect(response.status()).toBe(200); const html = await response.text();
  expect(html).toMatch(/\/assets\/index-[\w-]+\.js/); expect(html).not.toContain('/src/client/main.tsx');
  const sockets: string[] = []; page.on('websocket', socket => sockets.push(socket.url()));
  await openPrivate(page);
  expect(sockets.filter(url => url.includes('/parties/sync/')).every(url => url.startsWith('wss:'))).toBe(true);
  expect(sockets.some(url => url.includes('/parties/sync/'))).toBe(true);
  await page.evaluate(() => window.probe!.editor.updateBlock(window.probe!.editor.document[0], { content: '建置版本的雲端正文' })); await saved(page);
  await context.setOffline(true);
  await page.evaluate(() => window.probe!.editor.updateBlock(window.probe!.editor.document[0], { content: '建置版本的離線草稿' }));
  await expect(page.getByTestId('local-status')).toHaveText('本機已儲存');
  await page.reload(); await expect(page.getByTestId('ready')).toHaveText('可編輯'); await expect(page.locator('.tiptap')).toContainText('建置版本的離線草稿');
  await context.setOffline(false); await saved(page); await page.reload(); await saved(page);
  await expect(page.locator('.tiptap')).toContainText('建置版本的離線草稿');
  for (const path of ['/probe', '/parties/rooms/test']) expect((await request.get(path)).status()).toBe(404);
});
