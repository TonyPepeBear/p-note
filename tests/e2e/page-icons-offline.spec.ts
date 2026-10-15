import { expect, test } from '@playwright/test';
import { blocks, openPrivate, saved } from './helpers';
import { origin } from './ports';

test.beforeEach(async ({ request }) => { await request.post('/__test/reset'); });

test('ICON-03：切換離線保留未下載目標的行內圖示且不改正文', async ({ page, context }) => {
  await openPrivate(page);
  const sourceResponse = await page.request.post('/api/pages', {
    headers: { Origin: origin }, data: { title: '離線引用來源', parent_id: null },
  });
  expect(sourceResponse.status()).toBe(200);
  const source = await sourceResponse.json() as { id: string };
  const targetResponse = await page.request.post('/api/pages', {
    headers: { Origin: origin }, data: { title: '尚未下載的目標', parent_id: null, icon: '🧭' },
  });
  expect(targetResponse.status()).toBe(200);
  const target = await targetResponse.json() as { id: string; owner_id: string };

  await page.goto('/?page=' + source.id);
  await expect(page.getByTestId('ready')).toHaveText('可編輯');
  await saved(page);
  await page.evaluate(id => {
    const editor = window.probe!.editor;
    editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: [
      '離線仍保留的參考：', { type: 'link', href: '/?page=' + id, content: '尚未下載的目標' },
    ] }]);
  }, target.id);
  await saved(page);
  const before = await blocks(page);
  const inline = page.locator('.tiptap .note-inline-icon[data-note-link-id="' + target.id + '"] .page-icon-trigger');
  await expect(inline.locator('[data-page-icon="🧭"]')).toBeVisible();
  await expect(inline).toBeEnabled();
  const targetCached = () => page.evaluate(({ owner_id, id }) =>
    localStorage.getItem('p-note:page:' + owner_id + ':' + id) !== null, target);
  expect(await targetCached()).toBe(false);

  await context.setOffline(true);
  await page.waitForFunction(() => !navigator.onLine);
  await expect(inline).toBeDisabled();
  await expect(inline.locator('[data-page-icon="🧭"]')).toBeVisible();
  await expect(page).toHaveURL(new RegExp('page=' + source.id));
  expect(await blocks(page)).toEqual(before);
  expect(await targetCached()).toBe(false);
});
