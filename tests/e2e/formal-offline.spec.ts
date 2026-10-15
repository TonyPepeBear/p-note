import { expect, test } from '@playwright/test';
import { openPrivate, saved, blocks } from './helpers';
test.beforeEach(async ({ request }) => { await request.post('/__test/reset'); await request.post('/__test/control', { data: { now: Date.now() + 86400000 } }); });

test('SYNC-01：正式有權限雙 context 併發編輯不同段落，持久確認後內容相同', async ({ page, browser }) => {
  const id = await openPrivate(page);
  await page.evaluate(() => window.probe!.editor.replaceBlocks(window.probe!.editor.document, [{ id: 'a', type: 'paragraph', content: '甲' }, { id: 'b', type: 'paragraph', content: '乙' }]));
  await saved(page);
  const otherContext = await browser.newContext({ ignoreHTTPSErrors: true, storageState: await page.context().storageState() });
  try {
    const other = await otherContext.newPage(); await openPrivate(other, id);
    await Promise.all([page.evaluate(() => window.probe!.editor.updateBlock('a', { content: '電腦' })), other.evaluate(() => window.probe!.editor.updateBlock('b', { content: '手機' }))]);
    await saved(page); await saved(other); await expect.poll(() => blocks(other)).toEqual(await blocks(page));
    expect(JSON.stringify(await blocks(page))).toContain('電腦'); expect(JSON.stringify(await blocks(page))).toContain('手機');
    await other.reload(); await saved(other); expect(await blocks(other)).toEqual(await blocks(page));
  } finally { await otherContext.close(); }
});

test('SYNC-08：正式頁面離線修改／刷新保留，重連同世代合併雙方修改', async ({ page, browser }) => {
  await openPrivate(page);
  await page.evaluate(() => window.probe!.editor.replaceBlocks(window.probe!.editor.document, [{ id: 'a', type: 'paragraph', content: '原甲' }, { id: 'b', type: 'paragraph', content: '原乙' }]));
  await saved(page);
  const otherContext = await browser.newContext({ ignoreHTTPSErrors: true, storageState: await page.context().storageState() });
  try {
    const other = await otherContext.newPage();
    await other.goto(page.url());
    await expect(other.getByTestId('ready')).toBeVisible({ timeout: 15000 });
    await expect(other.getByTestId('ready')).toHaveText('可編輯', { timeout: 15000 });
    await saved(other);
    await page.context().setOffline(true); await expect(page.getByTestId('cloud-status')).toHaveText('離線，待同步');
    await page.evaluate(() => window.probe!.editor.updateBlock('a', { content: '離線草稿' }));
    await expect(page.getByTestId('local-status')).toHaveText('本機已儲存');
    await other.evaluate(() => window.probe!.editor.updateBlock('b', { content: '在線修改' })); await saved(other);
    await page.reload(); await expect(page.getByTestId('ready')).toHaveText('可編輯');
    expect(JSON.stringify(await blocks(page))).toContain('離線草稿');
    await page.context().setOffline(false); await saved(page); await saved(other);
    await expect.poll(() => blocks(page)).toEqual(await blocks(other));
    expect(JSON.stringify(await blocks(page))).toContain('離線草稿'); expect(JSON.stringify(await blocks(page))).toContain('在線修改');
  } finally { await page.context().setOffline(false); await otherContext.close(); }
});

test('SYNC-09：正式未下載頁面／IndexedDB 故障不宣稱本機保存成功', async ({ page }) => {
  await openPrivate(page); await saved(page);
  await page.evaluate(() => {
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) { if (args[1] === 'readwrite') throw new DOMException('測試容量不足','QuotaExceededError'); return Reflect.apply(transaction,this,args); };
    const editor=window.probe!.editor; editor.updateBlock(editor.document[0], { content: '還在記憶體' });
  });
  await expect(page.getByTestId('local-status')).toHaveText('本機儲存失敗');
  expect(JSON.stringify(await blocks(page))).toContain('還在記憶體');
  await page.context().setOffline(true); await page.goto('/?page=not-downloaded');
  await expect(page.getByRole('alert')).toContainText('尚未下載'); await expect(page.getByTestId('ready')).toHaveCount(0);
});

test('SYNC-12：正式跨分頁中文收斂，API 權限拒絕其他 owner 與世代', async ({ page, context }) => {
  const id=await openPrivate(page); const other=await context.newPage(); await openPrivate(other,id);
  await page.evaluate(() => window.probe!.editor.replaceBlocks(window.probe!.editor.document,[{id:'a',type:'paragraph',content:'甲'},{id:'b',type:'paragraph',content:'乙'}])); await saved(page);
  await expect.poll(() => blocks(other)).toEqual(await blocks(page));
  await Promise.all([page.evaluate(() => window.probe!.editor.updateBlock('a',{content:'第一分頁中文'})),other.evaluate(() => window.probe!.editor.updateBlock('b',{content:'第二分頁中文'}))]);
  await saved(page); await saved(other); await expect.poll(() => blocks(other)).toEqual(await blocks(page));
  const metadata=await (await page.request.get('/api/pages/'+id)).json() as {owner_id:string;sync_generation:string};
  expect((await page.request.get(`/parties/sync/forged?page=${id}&generation=other`)).status()).toBe(409);
  expect((await page.request.get('/api/pages/another-owner-page')).status()).toBe(404);
  const scope=await page.evaluate(() => window.probe!.cache.name);
  expect(scope).not.toContain(metadata.owner_id); expect(scope).not.toContain(metadata.sync_generation);
});
