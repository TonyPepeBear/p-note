import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { open, saved, blocks } from './helpers';

test('PROBE-EDIT-01：基本區塊、格式與順序重開後保留', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const editor = window.probe!.editor;
    editor.replaceBlocks(editor.document, [
      { id: 'paragraph', type: 'paragraph', content: [{ type: 'text', text: '段落粗體', styles: { bold: true } }, { type: 'link', href: 'https://example.com', content: [{ type: 'text', text: '連結', styles: { italic: true } }] }] },
      { id: 'heading', type: 'heading', props: { level: 2 }, content: '標題' },
      { id: 'bullet', type: 'bulletListItem', content: '項目' },
      { id: 'number', type: 'numberedListItem', content: '編號' },
      { id: 'todo', type: 'checkListItem', props: { checked: true }, content: '待辦' },
      { id: 'quote', type: 'quote', content: '引用' },
      { id: 'divider', type: 'divider' },
    ]);
  });
  await saved(page);
  const before = await blocks(page);
  await page.reload();
  await expect(page.getByTestId('ready')).toHaveText('可編輯');
  expect(await blocks(page)).toEqual(before);
  await expect(page.locator('strong')).toContainText('段落粗體');
  await expect(page.locator('a[href="https://example.com"]')).toContainText('連結');
});

test('PROBE-EDIT-02：程式碼縮排、換行、語言及複製內容往返', async ({ page }) => {
  await open(page);
  const code = 'function hello() {\n  console.log("你好");\n}\n';
  await page.evaluate(code => {
    const editor = window.probe!.editor;
    editor.replaceBlocks(editor.document, [{ id: 'code', type: 'codeBlock', props: { language: 'javascript' }, content: code }]);
    editor.setTextCursorPosition('code', 'start');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { window.copiedCode = text; } } });
  }, code);
  await page.getByRole('button', { name: '複製程式碼', exact: true }).click();
  expect(await page.evaluate(() => window.copiedCode)).toBe(code);
  await saved(page);
  const before = await blocks(page);
  await page.reload();
  await expect(page.getByTestId('ready')).toHaveText('可編輯');
  expect(await blocks(page)).toEqual(before);
  expect((await blocks(page))[0].props).toMatchObject({ language: 'javascript' });
});

test('PROBE-EDIT-03：固定圖片引用同步及重開，兩端讀到相同原檔', async ({ page, context }) => {
  const room = await open(page);
  await page.getByRole('button', { name: '插入測試圖片' }).click();
  await saved(page);
  const peer = await context.newPage();
  await open(peer, room);
  await expect(peer.locator('img[src="/fixtures/pixel.png"]')).toBeVisible();
  expect(await peer.locator('img[src="/fixtures/pixel.png"]').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  const bytes = await readFile('public/fixtures/pixel.png');
  const response = await peer.request.get('/fixtures/pixel.png');
  expect(createHash('sha256').update(await response.body()).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'));
  await peer.reload();
  await expect(peer.locator('img[src="/fixtures/pixel.png"]')).toBeVisible();
});

test('PROBE-EDIT-04：觸控／鍵盤可插入移動刪除，縮小 viewport 保持焦點', async ({ page }, testInfo) => {
  await open(page);
  await page.evaluate(() => {
    const editor = window.probe!.editor;
    editor.replaceBlocks(editor.document, [
      { id: 'one', type: 'paragraph', content: '一' }, { id: 'two', type: 'paragraph', content: '二' },
    ]);
    editor.setTextCursorPosition('two', 'end');
  });
  const action = page.getByText('區塊操作', { exact: true });
  if (testInfo.project.use.hasTouch) await action.tap();
  else { await action.focus(); await page.keyboard.press('Enter'); }
  await page.getByRole('button', { name: '上移區塊' }).click();
  expect((await blocks(page)).map(block => block.id)).toEqual(['two', 'one']);
  await page.getByRole('button', { name: '插入段落' }).click();
  await page.keyboard.insertText('新段落');
  await page.setViewportSize({ width: 390, height: 340 });
  await expect(page.locator('.tiptap')).toBeFocused();
  const box = await page.locator('.tiptap').boundingBox();
  expect(box?.width).toBeLessThanOrEqual(390);
  expect((await blocks(page)).some(block => JSON.stringify(block).includes('新段落'))).toBe(true);
  await page.getByRole('button', { name: '刪除區塊' }).click();
  expect((await blocks(page)).map(block => block.id)).toEqual(['two', 'one']);
  await saved(page);
});

test('PROBE-EDIT-05：中文 composition、換行與游標在另一端同步', async ({ page, context }) => {
  await page.clock.install({ time: new Date('2026-10-13T00:00:00Z') });
  const room = await open(page);
  const peer = await context.newPage();
  await open(peer, room);
  await page.locator('.tiptap').click();
  await page.locator('.tiptap').dispatchEvent('compositionstart', { data: '' });
  await page.locator('.tiptap').dispatchEvent('compositionupdate', { data: '中文選字' });
  await page.locator('.tiptap').dispatchEvent('beforeinput', { inputType: 'insertCompositionText', data: '中文選字', isComposing: true });
  await page.keyboard.insertText('中文選字');
  await page.locator('.tiptap').dispatchEvent('compositionend', { data: '中文選字' });
  // Safari 會抑制選字結束後 500 ms 內的按鍵；用可控時鐘模擬下一次獨立輸入。
  await page.clock.fastForward(501);
  await expect.poll(() => page.evaluate(() => window.probe!.editor.prosemirrorView.composing)).toBe(false);
  await page.keyboard.press('Enter');
  await page.clock.fastForward(201);
  await expect.poll(async () => (await blocks(page)).length).toBe(2);
  await page.keyboard.insertText('第二段');
  await saved(page);
  await expect.poll(() => blocks(peer)).toEqual(await blocks(page));
  expect((await blocks(page)).map(block => block.content)).toEqual([
    [{ type: 'text', text: '中文選字', styles: {} }], [{ type: 'text', text: '第二段', styles: {} }],
  ]);
  const selection = await page.evaluate(() => {
    const selection = window.getSelection()!;
    const anchor = selection.anchorNode!;
    const paragraph = (anchor instanceof Element ? anchor : anchor.parentElement)!.closest('p')!;
    const prefix = document.createRange();
    prefix.selectNodeContents(paragraph);
    prefix.setEnd(anchor, selection.anchorOffset);
    return { collapsed: selection.isCollapsed, offset: prefix.toString().length };
  });
  expect(selection).toEqual({ collapsed: true, offset: 3 });
});

test('PROBE-SYNC-04：延遲舊確認不會把後續輸入顯示成已儲存', async ({ page }) => {
  await open(page);
  await saved(page);
  await page.evaluate(() => {
    const provider = window.probe!.provider;
    const emit = provider.emit.bind(provider);
    window.delayedReceipts = [];
    provider.emit = (name, args) => {
      if (name === 'custom-message') window.delayedReceipts!.push(args[0]);
      else emit(name, args);
    };
    window.releaseReceipt = index => emit('custom-message', [window.delayedReceipts![index]]);
    const editor = window.probe!.editor;
    editor.updateBlock(editor.document[0].id, { content: '第一次輸入' });
  });
  await expect.poll(() => page.evaluate(() => window.delayedReceipts!.length)).toBe(1);
  await page.evaluate(() => {
    const editor = window.probe!.editor;
    editor.updateBlock(editor.document[0].id, { content: '第二次輸入' });
  });
  await expect.poll(() => page.evaluate(() => window.delayedReceipts!.length)).toBe(2);
  await page.evaluate(() => window.releaseReceipt!(0));
  await expect(page.getByTestId('cloud-status')).toHaveText('同步中');
  await page.evaluate(() => window.releaseReceipt!(1));
  await saved(page);
});
