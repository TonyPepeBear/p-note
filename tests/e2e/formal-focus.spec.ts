import { test, expect } from '@playwright/test';
import { openPrivate, blocks, saved } from './helpers';
test.beforeEach(async ({ request }) => { await request.post('/__test/reset'); await request.post('/__test/control', { data: { now: Date.now() + 86400000 } }); });
test('EDIT-FOCUS-01：正式頁面縮小鍵盤可視範圍，游標所在段落仍可看見與操作', async ({ page }) => {
  await openPrivate(page);
  await page.evaluate(() => { const editor = window.probe!.editor; editor.updateBlock(editor.document[0], { content: '鍵盤佔位前' }); editor.setTextCursorPosition(editor.document[0], 'end'); editor.focus(); });
  await page.setViewportSize({ width: 390, height: 340 });
  await expect(page.locator('.tiptap')).toBeFocused();
  await expect.poll(() => page.evaluate(() => {
    const node = getSelection()?.anchorNode; const element = node instanceof Element ? node : node?.parentElement;
    const box = element?.closest('p')?.getBoundingClientRect();
    return !!box && box.top >= 0 && box.bottom <= innerHeight;
  })).toBe(true);
  await page.keyboard.insertText('仍可輸入'); await saved(page);
  expect(JSON.stringify(await blocks(page))).toContain('鍵盤佔位前仍可輸入');
});
