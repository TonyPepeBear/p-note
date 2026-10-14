import { expect, test, type Page } from '@playwright/test';
import { openPrivate, saved, showNavigation } from './helpers';

test.beforeEach(async ({ request }) => {
  await request.post('/__test/reset');
  await request.post('/__test/control', { data: { now: Date.now() + 86400000 } });
});

test('PWA-01：manifest 與一般、遮罩和 Apple 圖示提供有效安裝資訊', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#ffffff');
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ id: '/', name: 'p-note 私人筆記', short_name: 'p-note', lang: 'zh-TW', start_url: '/', scope: '/', display: 'standalone' });
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ sizes: '192x192', purpose: 'any' }),
    expect.objectContaining({ sizes: '512x512', purpose: 'any' }),
    expect.objectContaining({ sizes: '512x512', purpose: 'maskable' }),
  ]));
  for (const icon of [...manifest.icons, { src: await page.locator('link[rel="apple-touch-icon"]').getAttribute('href'), sizes: '180x180' }]) {
    const result = await page.request.get(icon.src);
    expect(result.status()).toBe(200);
    expect(result.headers()['content-type']).toContain('image/png');
    expect(await page.evaluate(async (src) => {
      const image = new Image(); image.src = src; await image.decode();
      return `${image.naturalWidth}x${image.naturalHeight}`;
    }, icon.src)).toBe(icon.sizes);
  }
});

test('PWA-02：原生安裝取消、替代說明與獨立模式', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '安裝 p-note', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '安裝 p-note' })).toContainText('加入主畫面');
  await page.getByRole('button', { name: '關閉安裝說明' }).click();
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, { prompt: async () => { document.body.dataset.prompted = '1'; }, userChoice: Promise.resolve({ outcome: 'dismissed' }) });
    dispatchEvent(event);
  });
  await page.getByRole('button', { name: '安裝 p-note', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-prompted', '1');
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  await page.addInitScript(() => {
    const native = matchMedia;
    window.matchMedia = (query) => query === '(display-mode: standalone)' ? Object.defineProperty(native(query), 'matches', { value: true }) : native(query);
  });
  await page.reload();
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '安裝 p-note', exact: true })).toHaveCount(0);
});

test('PWA-03：未登入也能準備離線外殼、manifest 與圖示', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  expect(await page.evaluate(async () => (await fetch('/manifest.webmanifest')).ok)).toBe(true);
  expect(await page.evaluate(async () => (await fetch('/icons/icon-192.png')).ok)).toBe(true);
  await page.getByRole('button', { name: '安裝 p-note', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '安裝 p-note' })).toContainText('加入主畫面');
});

test('PWA-04：離線重開同筆記保留草稿，未知筆記明確拒絕', async ({ page, context }) => {
  const id = await openPrivate(page);
  await context.setOffline(true);
  await page.evaluate(() => window.probe!.editor.updateBlock(window.probe!.editor.document[0], { content: 'PWA 離線草稿' }));
  await expect(page.getByTestId('local-status')).toHaveText('本機已儲存');
  await page.reload();
  await expect(page.locator('.tiptap')).toContainText('PWA 離線草稿');
  await page.goto(`/?page=${id}&new=0`);
  await expect(page.locator('.tiptap')).toContainText('PWA 離線草稿');
  await page.goto('/?page=pwa-not-downloaded');
  await expect(page.getByRole('alert')).toContainText('尚未下載');
  await context.setOffline(false);
  await page.goto('/?page=' + id);
  await saved(page);
  await expect(page.locator('.tiptap')).toContainText('PWA 離線草稿');
});

async function waitingUpdate(page: Page) {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const waiting = { postMessage: async () => {
      const cache = window.probe!.cache;
      const request = cache.db!.transaction('updates', 'readonly').objectStore('updates').count();
      request.onsuccess = () => { document.body.dataset.activated = String(request.result > 0); };
    } };
    Object.defineProperty(registration, 'waiting', { configurable: true, value: waiting });
    registration!.dispatchEvent(new Event('updatefound'));
  });
}

for (const fail of [false, true]) test(`PWA-06：${fail ? '保存失敗不啟用且保留可編輯草稿' : '保存成功才送出新版啟用訊息'}`, async ({ page }) => {
  await openPrivate(page);
  await page.evaluate(() => { document.body.dataset.marker = '原分頁'; navigator.serviceWorker.dispatchEvent(new Event('controllerchange')); });
  await expect(page.locator('body')).toHaveAttribute('data-marker', '原分頁');
  await showNavigation(page);
  await waitingUpdate(page);
  await page.evaluate((fail) => {
    if (fail) {
      const native = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (...args) {
        if (args[1] === 'readwrite') throw new DOMException('測試容量不足', 'QuotaExceededError');
        return Reflect.apply(native, this, args);
      };
    }
    window.probe!.editor.updateBlock(window.probe!.editor.document[0], { content: '更新前最後的字' });
  }, fail);
  await page.getByRole('button', { name: '更新 p-note', exact: true }).filter({ visible: true }).click();
  if (fail) {
    await expect(page.getByRole('alert').filter({ hasText: '本機儲存失敗' }).first()).toBeVisible();
    await expect(page.locator('body')).not.toHaveAttribute('data-activated');
    await expect(page.locator('.tiptap')).toHaveAttribute('contenteditable', 'true');
  } else await expect(page.locator('body')).toHaveAttribute('data-activated', 'true');
  await expect(page.locator('.tiptap')).toContainText('更新前最後的字');
  await expect(page.locator('body')).toHaveAttribute('data-marker', '原分頁');
});

test('PWA-06：真實新版等待套用，重新載入後保留草稿且其他分頁不重載', async ({ page, context }) => {
  const id = await openPrivate(page);
  const other = await context.newPage();
  await other.goto('/?page=' + id); await saved(other);
  await other.evaluate(() => { document.body.dataset.marker = '保留分頁'; });
  await page.evaluate(async () => {
    document.body.dataset.marker = '更新分頁';
    await navigator.serviceWorker.register('/__test/pwa-sw', { scope: '/', updateViaCache: 'none' });
  });
  await showNavigation(page);
  await expect(page.getByRole('button', { name: '更新 p-note', exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-marker', '更新分頁');
  await page.evaluate(() => window.probe!.editor.updateBlock(window.probe!.editor.document[0], { content: '真實更新保留的字' }));
  await page.getByRole('button', { name: '更新 p-note', exact: true }).filter({ visible: true }).click();
  await expect(page.locator('body')).not.toHaveAttribute('data-marker');
  await expect(page.getByTestId('ready')).toHaveText('可編輯');
  await expect(page.locator('.tiptap')).toContainText('真實更新保留的字');
  await expect(other.locator('body')).toHaveAttribute('data-marker', '保留分頁');
  await saved(page);
});
