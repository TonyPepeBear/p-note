import { test, expect } from '@playwright/test';
import { openPrivate, saved, blocks } from './helpers';
import { origin } from './ports';

test.beforeEach(async ({ request }) => { await request.post('/__test/reset'); await request.post('/__test/control', { data: { now: Date.now() + 86400000 } }); });

for (const [idCase, action] of [['SYNC-10', 'delete'], ['SYNC-11', 'restore'], ['BACKUP-09', 'restore']] as const) test(`${idCase}：舊離線日記可唯讀檢視與另存筆記，不能回寫原頁或另建同日期日記`, async ({ page, browser }) => {
  // 多個裝置、離線刷新、覆蓋還原與另存需完整流程時間；個別斷言仍保留原本逾時。
  test.setTimeout(60_000);
  const id = await openPrivate(page);
  await page.evaluate(() => window.probe!.editor.replaceBlocks(window.probe!.editor.document, [{ type: 'paragraph', content: '雲端原稿' }])); await saved(page);
  const otherContext = await browser.newContext({ ignoreHTTPSErrors: true, storageState: await page.context().storageState() });
  try {
    const other = await otherContext.newPage(); await openPrivate(other, id);
    const original = await (await other.request.get('/api/pages/' + id)).json();
    const headers = { Origin: origin };
    const backup = action === 'restore' ? await (await other.request.post('/api/backups', { headers, data: {} })).json() : undefined;
    await page.context().setOffline(true);
    await page.evaluate(() => window.probe!.editor.updateBlock(window.probe!.editor.document[0], { content: '只在舊裝置的草稿' }));
    await expect(page.getByTestId('local-status')).toHaveText('本機已儲存');
    const response = action === 'delete'
      ? await other.request.post(`/api/pages/${id}/delete`, { headers, data: {} })
      : await other.request.post(`/api/backups/${backup.id}/restore`, { headers, data: { request_id: 'restore-offline-test' } });
    expect(response.status()).toBe(200);
    await page.context().setOffline(false);
    await expect(page.getByRole('button', { name: '檢視本機草稿', exact: true })).toBeVisible();
    // 刷新後不能只依賴舊分頁的記憶體或 sessionStorage 世代。
    await page.evaluate(() => sessionStorage.removeItem('p-note-scope')); await page.reload();
    await page.getByRole('button', { name: '檢視本機草稿', exact: true }).click();
    await expect(page.locator('.tiptap')).toHaveAttribute('contenteditable', 'false');
    await expect(page.locator('.tiptap')).toContainText('只在舊裝置的草稿');
    if (idCase === 'SYNC-11') {
      await page.getByRole('button', { name: '載入目前版本', exact: true }).click(); await saved(page);
      await expect(page.locator('.tiptap')).toContainText('雲端原稿');
      await expect(page.getByRole('combobox', { name: '本機舊版本', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '檢視舊版本', exact: true }).click();
      await page.getByRole('button', { name: '檢視本機草稿', exact: true }).click();
      await expect(page.locator('.tiptap')).toHaveAttribute('contenteditable', 'false');
      await expect(page.locator('.tiptap')).toContainText('只在舊裝置的草稿');
    }
    const current = await other.request.get('/api/pages/' + id);
    expect(current.status()).toBe(action === 'delete' ? 409 : 200);
    if (action === 'restore') expect((await current.json()).sync_generation).not.toBe(original.sync_generation);
    await page.getByRole('button', { name: '另存為筆記', exact: true }).click(); await saved(page);
    const forkId = new URL(page.url()).searchParams.get('page')!; expect(forkId).not.toBe(id);
    const fork = await (await page.request.get('/api/pages/' + forkId)).json();
    expect(fork.kind).toBe('note'); expect(fork.journal_date).toBeNull(); expect(fork.parent_id).toBeNull(); expect(fork.owner_id).toBe(original.owner_id);
    expect(JSON.stringify(await blocks(page))).toContain('只在舊裝置的草稿');
    await page.reload(); await saved(page); expect(JSON.stringify(await blocks(page))).toContain('只在舊裝置的草稿');
    const journals = await (await page.request.get('/api/journals?month=' + original.journal_date.slice(0, 7))).json();
    expect(journals.filter((row: { journal_date: string }) => row.journal_date === original.journal_date)).toHaveLength(action === 'delete' ? 0 : 1);
    if (action === 'restore') {
      // 新 context 沒有舊快取，讀到的仍是還原正文。
      const cleanContext = await browser.newContext({ ignoreHTTPSErrors: true, storageState: { cookies: (await otherContext.storageState()).cookies, origins: [] } });
      try {
        const clean = await cleanContext.newPage(); await openPrivate(clean, id);
        expect(JSON.stringify(await blocks(clean))).toContain('雲端原稿'); expect(JSON.stringify(await blocks(clean))).not.toContain('只在舊裝置的草稿');
      } finally { await cleanContext.close(); }
    } else expect((await page.request.get('/api/pages/' + id)).status()).toBe(409);
  } finally { await page.context().setOffline(false); await otherContext.close(); }
});
