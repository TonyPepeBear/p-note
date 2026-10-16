import { expect, test } from '@playwright/test';
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

test('PWA-UI-01：手機關閉安裝說明後保留導覽與焦點，仍可開啟原文件', async ({ page }, info) => {
  test.setTimeout(45000);
  await page.setViewportSize({ width: 375, height: 812 });
  // 固定使用瀏覽器不提供原生提示時的替代說明流程。
  await page.addInitScript(() => {
    addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  });
  const id = await openPrivate(page);
  await page.evaluate(() => {
    window.probe!.editor.updateBlock(window.probe!.editor.document[0], {
      content: '關閉安裝說明後保留的原文件',
    });
  });
  await saved(page);
  await showNavigation(page);
  const drawer = page.getByRole('dialog', { name: '導覽', exact: true });
  const install = drawer.getByRole('button', { name: '安裝 p-note', exact: true });
  await install.click();
  const help = page.getByRole('dialog', { name: '安裝 p-note', exact: true });
  await expect(help).toBeVisible();
  await expect(help).toContainText('加入主畫面');
  // 真正點擊浮層，避免只驗證 DOM 可見卻被導覽抽屜遮住。
  await help.getByRole('button', { name: '知道了', exact: true }).click();
  await expect(help).toBeHidden();
  await expect(drawer).toBeVisible();
  await expect(install).toBeFocused();
  await install.click();
  await expect(help).toBeVisible();
  await expect(help).toHaveCSS('opacity', '1');
  await page.screenshot({ path: `test-results/screenshots/redesign-${info.project.name}-install.png`, fullPage: true, animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();
  await expect(drawer).toBeVisible();
  await expect(install).toBeFocused();
  await drawer.getByRole('button', { name: '今天', exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByTestId('ready')).toHaveText('可編輯');
  expect(new URL(page.url()).searchParams.get('page')).toBe(id);
  await expect(page.locator('.tiptap')).toContainText('關閉安裝說明後保留的原文件');
  await page.locator('.tiptap').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('，可以繼續書寫');
  await expect(page.locator('.tiptap')).toContainText('可以繼續書寫');
  await saved(page);
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

test('PWA-06：等待中的舊版更新不顯示手動入口，控制權變更仍可編輯', async ({ page }) => {
  await openPrivate(page);
  await page.evaluate(async () => {
    document.body.dataset.marker = '原分頁';
    const registration = await navigator.serviceWorker.getRegistration();
    Object.defineProperty(registration, 'waiting', { configurable: true, value: { postMessage() {} } });
    registration!.dispatchEvent(new Event('updatefound'));
    navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));
  });
  await showNavigation(page);
  await expect(page.getByRole('button', { name: '更新 p-note', exact: true })).toHaveCount(0);
  await expect(page.locator('body')).toHaveAttribute('data-marker', '原分頁');
  expect(await page.evaluate(() => document.body.inert)).toBe(false);
  await page.evaluate(() => window.probe!.editor.updateBlock(window.probe!.editor.document[0], { content: '仍可編輯的字' }));
  await expect(page.locator('.tiptap')).toHaveAttribute('contenteditable', 'true');
  await expect(page.locator('.tiptap')).toContainText('仍可編輯的字');
  await saved(page);
});

test('PWA-06：真實新版自動啟用不重載分頁，保留草稿與舊版雜湊資源', async ({ page, context }) => {
  const id = await openPrivate(page);
  const other = await context.newPage();
  await other.goto('/?page=' + id); await saved(other);
  await other.evaluate(() => { document.body.dataset.marker = '保留分頁'; });
  await page.evaluate(() => window.probe!.editor.updateBlock(window.probe!.editor.document[0], { content: '真實更新保留的字' }));
  await expect(page.getByTestId('local-status')).toHaveText('本機已儲存');
  const oldCaches = await page.evaluate(async () => {
    document.body.dataset.marker = '更新分頁';
    const names = await caches.keys();
    const cache = await caches.open(names.find(name => name.startsWith('p-note-shell-'))!);
    await cache.put('/assets/pwa-old-fixture.js', new Response('舊版雜湊資源', { headers: { 'Content-Type': 'application/javascript' } }));
    await navigator.serviceWorker.register('/__test/pwa-sw', { scope: '/', updateViaCache: 'none' });
    return names;
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.endsWith('/__test/pwa-sw'));
  await other.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.endsWith('/__test/pwa-sw'));
  const cacheNames = await page.evaluate(() => caches.keys());
  expect(cacheNames).toEqual(expect.arrayContaining(oldCaches));
  expect(cacheNames.some(name => name.endsWith('-test-update'))).toBe(true);
  expect(await page.evaluate(async () => (await fetch('/assets/pwa-old-fixture.js')).text())).toBe('舊版雜湊資源');
  await expect(page.locator('body')).toHaveAttribute('data-marker', '更新分頁');
  await expect(other.locator('body')).toHaveAttribute('data-marker', '保留分頁');
  await expect(page.locator('.tiptap')).toContainText('真實更新保留的字');
  await expect(page.locator('.tiptap')).toHaveAttribute('contenteditable', 'true');
  expect(await page.evaluate(() => document.body.inert)).toBe(false);
  await showNavigation(page);
  await expect(page.getByRole('button', { name: '更新 p-note', exact: true })).toHaveCount(0);
  await other.evaluate(() => window.probe!.editor.updateBlock(window.probe!.editor.document[0], { content: '啟用後繼續書寫' }));
  await expect(other.locator('.tiptap')).toContainText('啟用後繼續書寫');
  await saved(other);
});
