import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { blocks, open, saved } from './helpers';
import { origin, api } from './ports';

test('PROBE-SYNC-01：隔離裝置同時修改不同區塊，兩端與本機快照收斂', async ({ page, browser }) => {
  const room = await open(page);
  await page.evaluate(() => window.probe!.editor.replaceBlocks(window.probe!.editor.document, [
    { id: 'desktop', type: 'paragraph', content: '電腦' }, { id: 'phone', type: 'paragraph', content: '手機' },
  ]));
  await saved(page);
  const otherContext = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: origin });
  try {
    const peer = await otherContext.newPage();
    await open(peer, room);
    await Promise.all([
      page.evaluate(() => window.probe!.editor.updateBlock('desktop', { content: '電腦寫入' })),
      peer.evaluate(() => window.probe!.editor.updateBlock('phone', { content: '手機寫入' })),
    ]);
    await saved(page);
    await saved(peer);
    await expect.poll(() => blocks(peer)).toEqual(await blocks(page));
    expect(JSON.stringify(await blocks(page))).toContain('電腦寫入');
    expect(JSON.stringify(await blocks(page))).toContain('手機寫入');
    await page.reload();
    await expect(page.getByTestId('ready')).toHaveText('可編輯');
    await expect.poll(() => blocks(page)).toEqual(await blocks(peer));
  } finally {
    await otherContext.close();
  }
});

test('PROBE-SYNC-08：離線修改並刷新後保留，重連合併在線裝置且收到持久確認', async ({ page, context, browser }) => {
  const room = await open(page);
  await page.evaluate(() => window.probe!.editor.replaceBlocks(window.probe!.editor.document, [
    { id: 'offline', type: 'paragraph', content: '離線端' }, { id: 'online', type: 'paragraph', content: '在線端' },
  ]));
  await saved(page);
  const otherContext = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: origin });
  try {
    const peer = await otherContext.newPage();
    await open(peer, room);
    await context.setOffline(true);
    await expect(page.getByTestId('cloud-status')).toHaveText('離線，待同步');
    await page.evaluate(() => window.probe!.editor.updateBlock('offline', { content: '離線修改保留' }));
    await expect(page.getByTestId('local-status')).toHaveText('本機已儲存');
    await peer.evaluate(() => window.probe!.editor.updateBlock('online', { content: '在線修改保留' }));
    await saved(peer);
    await page.reload();
    await expect(page.getByTestId('ready')).toHaveText('可編輯');
    expect(JSON.stringify(await blocks(page))).toContain('離線修改保留');
    await context.setOffline(false);
    await saved(page);
    await expect.poll(() => blocks(peer)).toEqual(await blocks(page));
    expect(JSON.stringify(await blocks(peer))).toContain('在線修改保留');
    expect(JSON.stringify(await blocks(peer))).toContain('離線修改保留');
    const name = await page.evaluate(() => window.probe!.room);
    const response = await page.request.get(`${api}/parties/rooms/${name}/state`);
    expect(response.status()).toBe(200);
    const local = await page.evaluate(async () => Array.from(await window.probe!.localState()));
    const serverDoc = new Y.Doc();
    const localDoc = new Y.Doc();
    Y.applyUpdate(serverDoc, new Uint8Array(await response.body()));
    Y.applyUpdate(localDoc, new Uint8Array(local));
    expect(serverDoc.getXmlFragment('body').toString()).toBe(localDoc.getXmlFragment('body').toString());
    expect(Y.encodeStateVector(serverDoc)).toEqual(Y.encodeStateVector(localDoc));
    serverDoc.destroy();
    localDoc.destroy();
  } finally {
    await context.setOffline(false);
    await otherContext.close();
  }
});

test('PROBE-SYNC-09：未下載頁面不可離線編輯；IndexedDB 寫入失敗不宣稱已本機保存', async ({ page, context }) => {
  const room = await open(page);
  await saved(page);
  await context.setOffline(true);
  await page.goto(`/probe?page=${randomUUID()}`);
  await expect(page.getByRole('alert')).toHaveText('此頁尚未下載，請連線後再開啟');
  await expect(page.locator('.tiptap')).toHaveCount(0);
  await context.setOffline(false);
  await open(page, room);
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
      if (args[1] === 'readwrite') {
        IDBDatabase.prototype.transaction = original;
        throw new DOMException('測試容量不足', 'QuotaExceededError');
      }
      return original.apply(this, args);
    };
    const editor = window.probe!.editor;
    editor.updateBlock(editor.document[0].id, { content: '仍在記憶體中' });
  });
  await expect(page.getByTestId('local-status')).toHaveText('本機儲存失敗');
  expect(JSON.stringify(await blocks(page))).toContain('仍在記憶體中');
});

test('PROBE-SYNC-12：同瀏覽器兩分頁收斂，不同 owner／世代快取隔離', async ({ page, context }) => {
  const room = await open(page);
  await page.evaluate(() => window.probe!.editor.replaceBlocks(window.probe!.editor.document, [
    { id: 'a', type: 'paragraph', content: '甲' }, { id: 'b', type: 'paragraph', content: '乙' },
  ]));
  await saved(page);
  const peer = await context.newPage();
  await open(peer, room);
  await Promise.all([
    page.evaluate(() => window.probe!.editor.updateBlock('a', { content: '第一分頁' })),
    peer.evaluate(() => window.probe!.editor.updateBlock('b', { content: '第二分頁' })),
  ]);
  await saved(page);
  await saved(peer);
  await expect.poll(() => blocks(peer)).toEqual(await blocks(page));
  const cacheName = await page.evaluate(() => window.probe!.cache.name);
  for (const [owner, generation] of [['another-owner', 'g1'], ['owner', 'g2']]) {
    const isolated = await context.newPage();
    await open(isolated, room, owner, generation);
    expect(await isolated.evaluate(() => window.probe!.cache.name)).not.toBe(cacheName);
    expect(JSON.stringify(await blocks(isolated))).not.toContain('第一分頁');
    await isolated.close();
  }
});
