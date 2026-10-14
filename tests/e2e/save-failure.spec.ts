import { test, expect } from '@playwright/test';
import { openPrivate, saved, blocks } from './helpers';

test.beforeEach(async ({ request }) => { await request.post('/__test/reset'); await request.post('/__test/control', { data: { now: Date.now() + 86400000 } }); });
test('SYNC-03：SQLite 寫入失敗時保留本機草稿，不確認／廣播，解除故障後可重試', async ({ page, browser }) => {
  const id = await openPrivate(page);
  await page.evaluate(() => window.probe!.editor.updateBlock(window.probe!.editor.document[0], { content: '雲端原稿' })); await saved(page);
  const peerContext = await browser.newContext({ storageState: { cookies: (await page.context().storageState()).cookies, origins: [] } });
  const room = await page.evaluate(() => window.probe!.room);
  const control = async (fail: boolean) => {
    const response = await page.request.post('/__test/storage-failure', { data: { room, fail } }); expect(response.status()).toBe(200);
    return response.json() as Promise<{ state: string }>;
  };
  try {
    const peer = await peerContext.newPage(); await openPrivate(peer, id);
    const before = await control(true);
    await page.evaluate(() => window.probe!.editor.updateBlock(window.probe!.editor.document[0], { content: '故障時保留的本機草稿' }));
    await expect(page.getByTestId('local-status')).toHaveText('本機已儲存');
    await expect(page.getByTestId('cloud-status')).toHaveText('雲端儲存失敗，可重試');
    expect(JSON.stringify(await blocks(page))).toContain('故障時保留的本機草稿');
    expect(JSON.stringify(await blocks(peer))).toContain('雲端原稿'); expect(JSON.stringify(await blocks(peer))).not.toContain('故障時保留的本機草稿');
    expect(await control(true)).toEqual(before);
    await control(false); await page.getByRole('button', { name: '重試儲存', exact: true }).click(); await saved(page);
    await expect.poll(() => blocks(peer)).toEqual(await blocks(page));
    await peer.reload(); await saved(peer); expect(JSON.stringify(await blocks(peer))).toContain('故障時保留的本機草稿');
  } finally { await control(false); await peerContext.close(); }
});
