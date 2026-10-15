import { expect, test, type Locator, type Page } from '@playwright/test';
import { openPrivate, saved, blocks, gate, openImageUpload } from './helpers';
import { images } from '../fixtures/images';

test.setTimeout(60000);

test.beforeEach(async ({ request }) => {
  await request.post('/__test/reset');
  await request.post('/__test/control', { data: { now: Date.now() + 86400000 } });
});

const references = (page: Page) => page.getByTestId('synced-block');
const content = (reference: Locator) => reference.locator('.synced-block-editor .tiptap');

// 協作游標的擁有者標籤不是正文，不得把顯示「我」誤判為內容變更。
async function text(reference: Locator) {
  return content(reference).evaluate(element => {
    const clone = element.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.bn-collaboration-cursor__base').forEach(cursor => cursor.remove());
    return (clone.textContent ?? '').replace(/\u200b/g, '');
  });
}

async function action(page: Page, name: string) {
  await page.getByRole('button', { name: '同步區塊操作', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

async function visit(page: Page, id: string) {
  await page.goto('/?page=' + encodeURIComponent(id));
  await expect(page.getByTestId('ready')).toHaveText('可編輯');
  await saved(page);
}

async function note(page: Page, title: string) {
  const response = await page.request.post('/api/pages', {
    data: { title }, headers: { Origin: new URL(page.url()).origin },
  });
  expect(response.status()).toBe(200);
  return response.json() as Promise<{ id: string; title: string }>;
}

async function convert(page: Page, text = '共同編輯的原文') {
  await page.evaluate(text => {
    const editor = window.probe!.editor;
    editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: text }]);
    editor.setTextCursorPosition(editor.document[0], 'end');
  }, text);
  await action(page, '轉成同步區塊');
  await expect(references(page)).toHaveCount(1);
  await expect(content(references(page))).toContainText(text);
  await saved(page);
  return (await references(page).getAttribute('data-synced-block-id'))!;
}

// 只替代 OS 剪貼簿邊界，複製按鈕與真實 paste 事件仍走產品流程。
async function copy(page: Page, reference = references(page).first()) {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text: string) => { window.copiedCode = text; },
    } });
  });
  await reference.getByRole('button', { name: '複製同步區塊', exact: true }).click();
  return (await page.evaluate(() => window.copiedCode))!;
}

async function paste(page: Page, text: string, target = page.locator('.tiptap').first()) {
  await target.evaluate((element, text) => {
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', text);
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
  }, text);
}

async function append(page: Page, reference: Locator, text: string) {
  await content(reference).locator('p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(text);
}

async function addReference(page: Page, id: string, count = 1) {
  await page.evaluate(({ id, count }) => {
    const editor = window.probe!.editor;
    editor.replaceBlocks(editor.document, [
      ...Array.from({ length: count }, () => ({ type: 'syncedBlock', props: { syncedBlockId: id } })),
      { type: 'paragraph', content: '獨立正文' },
    ]);
  }, { id, count });
  await expect(references(page)).toHaveCount(count);
  await saved(page);
}

for (const multiple of [false, true]) {
  test(`SB-01：${multiple ? '多個區塊' : '單一區塊'}轉換保留內容、順序及格式，重開維持引用`, async ({ page }) => {
    await openPrivate(page);
    await page.evaluate(multiple => {
      const editor = window.probe!.editor;
      editor.replaceBlocks(editor.document, [
        { type: 'paragraph', content: [{ type: 'text', text: '同步粗體原文', styles: { bold: true } }] },
        ...(multiple ? [{ type: 'heading', props: { level: 2 }, content: '第二個標題' }] : []),
      ]);
      if (multiple) editor.setSelection(editor.document[0], editor.document[1]);
      else editor.setTextCursorPosition(editor.document[0], 'end');
    }, multiple);
    await action(page, '轉成同步區塊');
    await expect(references(page)).toHaveCount(1);
    await expect(content(references(page)).locator('strong')).toHaveText('同步粗體原文');
    if (multiple) await expect(content(references(page)).locator('h2')).toHaveText('第二個標題');
    const before = await blocks(page);
    expect(before.filter(block => block.type === 'syncedBlock')).toHaveLength(1);
    await saved(page); await page.reload();
    await expect(page.getByTestId('ready')).toHaveText('可編輯'); await saved(page);
    expect(await blocks(page)).toEqual(before);
    await expect(content(references(page))).toContainText('同步粗體原文');
  });
}

test('SB-01：斜線選單建立空白同步區塊，可輸入並重開', async ({ page }) => {
  await openPrivate(page);
  await page.locator('.tiptap').click(); await page.keyboard.type('/');
  await page.getByRole('option', { name: /同步區塊/ }).click();
  await expect(references(page)).toHaveCount(1);
  await append(page, references(page), '從空白開始'); await saved(page);
  await page.reload(); await expect(page.getByTestId('ready')).toHaveText('可編輯'); await saved(page);
  await expect(content(references(page))).toContainText('從空白開始');
});

test('SB-02：複製到筆記、日記及同頁多個位置都指向相同內容', async ({ page, context }) => {
  const journal = await openPrivate(page); const id = await convert(page);
  const copied = await copy(page); expect(copied).toBe('p-note-synced-block:' + id);
  const target = await note(page, '另一份引用筆記');
  await visit(page, target.id); await paste(page, copied); await saved(page);
  await paste(page, copied); await saved(page);
  await expect(references(page)).toHaveCount(2);
  expect(await references(page).evaluateAll(items => items.map(item => item.getAttribute('data-synced-block-id')))).toEqual([id, id]);
  const peer = await context.newPage(); await visit(peer, journal);
  await paste(peer, copied); await saved(peer); await expect(references(peer)).toHaveCount(2);
  await append(page, references(page).first(), '所有引用同步'); await saved(page);
  for (const reference of await references(page).all()) await expect(content(reference)).toContainText('所有引用同步');
  for (const reference of await references(peer).all()) await expect(content(reference)).toContainText('所有引用同步');
  const all = await (await page.request.get('/api/synced-blocks')).json();
  expect(all.map((item: { id: string }) => item.id)).toEqual([id]);
});

test('SB-03：現有區塊、圖片、程式碼與筆記連結往返，貼入巢狀同步引用遭拒', async ({ page }) => {
  await openPrivate(page); const target = await note(page, '同步內連結目標');
  await openImageUpload(page);
  await page.getByLabel('圖片原檔', { exact: true }).setInputFiles({ name: '原圖.png', mimeType: 'image/png', buffer: Buffer.from(images.png) });
  await page.getByRole('button', { name: '上傳圖片', exact: true }).click();
  await expect(page.locator('.bn-block-content[data-content-type="image"]')).toHaveCount(1); await saved(page);
  await page.evaluate(target => {
    const editor = window.probe!.editor;
    const image = editor.document.find(block => block.type === 'image')!;
    editor.replaceBlocks(editor.document, [
      { type: 'paragraph', content: [{ type: 'text', text: '粗斜體', styles: { bold: true, italic: true } }] },
      { type: 'heading', props: { level: 2 }, content: '共用標題' },
      { type: 'bulletListItem', content: '項目' }, { type: 'numberedListItem', content: '編號' },
      { type: 'checkListItem', props: { checked: true }, content: '完成事項' }, { type: 'quote', content: '引用文字' },
      { type: 'divider' }, image,
      { type: 'codeBlock', props: { language: 'javascript' }, content: 'const sync = "中文";\n  sync;' },
      { type: 'paragraph', content: [{ type: 'link', href: '/?page=' + target, content: '同步內連結目標' }] },
      { type: 'paragraph', content: '' },
    ]);
    editor.setSelection(editor.document[0], editor.document.at(-1)!);
  }, target.id);
  await action(page, '轉成同步區塊'); await saved(page);
  const inner = content(references(page));
  await expect(inner.locator('strong em, em strong')).toHaveText('粗斜體');
  await expect(inner.locator('h2')).toHaveText('共用標題');
  await expect(inner).toContainText('項目'); await expect(inner).toContainText('編號');
  await expect(inner).toContainText('完成事項'); await expect(inner).toContainText('引用文字');
  await expect(inner.locator('img')).toHaveCount(1);
  await expect(inner.locator('pre')).toContainText('const sync = "中文";');
  await expect(inner.locator('a')).toHaveAttribute('href', '/?page=' + target.id);
  await expect(inner.locator('.note-inline-icon .page-icon-trigger')).toHaveCount(1);
  const original = await inner.innerText(); const copied = await copy(page);
  await paste(page, copied, inner);
  await expect(references(page).getByRole('alert')).toContainText('同步區塊不能放在另一個同步區塊裡');
  await expect(references(page)).toHaveCount(1); expect(await inner.innerText()).toBe(original);
  await page.reload(); await expect(page.getByTestId('ready')).toHaveText('可編輯'); await saved(page);
  await expect(content(references(page)).locator('img')).toHaveCount(1);
  await expect(content(references(page)).locator('pre')).toContainText('  sync;');
  await content(references(page)).locator('p').last().click(); await page.keyboard.press('End');
  await page.keyboard.type('[['); await page.keyboard.insertText('同步內連結');
  await page.getByRole('option', { name: /同步內連結目標/ }).click(); await saved(page);
  await expect(content(references(page)).locator('a')).toHaveCount(2);
  // 段落已有可導覽的連結，將原生選取收合到尾端後再以真實鍵盤輸入，不點擊連結本身。
  await content(references(page)).evaluate(element => {
    const paragraphs = element.querySelectorAll('p');
    const paragraph = paragraphs[paragraphs.length - 1];
    (element as HTMLElement).focus();
    const selection = getSelection();
    selection?.selectAllChildren(paragraph);
    selection?.collapseToEnd();
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.keyboard.type('[['); await page.keyboard.insertText('同步內連結');
  const iconOption = page.locator('.note-link-option-row').filter({ hasText: target.title });
  await iconOption.getByRole('button', { name: '新增「' + target.title + '」圖示', exact: true }).click();
  const iconDialog = page.getByRole('dialog', { name: '頁面圖示', exact: true });
  await expect(iconDialog).toHaveCount(1);
  await iconDialog.getByLabel('自訂 emoji', { exact: true }).fill('🌱');
  await iconDialog.getByRole('button', { name: '套用圖示', exact: true }).click();
  await expect(iconDialog).toHaveCount(0);
  await expect(content(references(page)).locator('.note-inline-icon [data-page-icon="🌱"]')).toHaveCount(2);
});

test('SB-04：不同引用頁與隔離裝置並行編輯合併，重新開啟仍一致', async ({ page, browser }) => {
  const source = await openPrivate(page); const id = await convert(page, '共同起點');
  const target = await note(page, '裝置二引用');
  await visit(page, target.id); await addReference(page, id, 2); await visit(page, source);
  const peerContext = await browser.newContext({ ignoreHTTPSErrors: true, storageState: { cookies: (await page.context().storageState()).cookies, origins: [] } });
  try {
    const peer = await peerContext.newPage(); await openPrivate(peer, target.id);
    await Promise.all([append(page, references(page), '甲裝置'), append(peer, references(peer).first(), '乙裝置')]);
    await saved(page); await saved(peer);
    await expect(content(references(page))).toContainText('甲裝置'); await expect(content(references(page))).toContainText('乙裝置');
    const final = await text(references(page));
    for (const reference of await references(peer).all()) await expect.poll(() => text(reference)).toBe(final);
    await peer.reload(); await expect(peer.getByTestId('ready')).toHaveText('可編輯'); await saved(peer);
    for (const reference of await references(peer).all()) await expect.poll(() => text(reference)).toBe(final);
  } finally { await peerContext.close(); }
});

test('SB-05：任一同步文件持久保存失敗，整頁不能宣告已儲存且重試後才更新其他引用', async ({ page, context }) => {
  const source = await openPrivate(page); const id = await convert(page, '持久原稿');
  const info = await (await page.request.get('/api/synced-blocks/' + id)).json();
  const peer = await context.newPage(); await visit(peer, source);
  const control = async (fail: boolean) => expect((await page.request.post('/__test/storage-failure', { data: { room: info.room, fail } })).status()).toBe(200);
  try {
    await control(true); await append(page, references(page), '未持久草稿');
    await expect(page.getByTestId('local-status')).toHaveText('本機已儲存');
    await expect(references(page).getByRole('alert')).toContainText('儲存失敗');
    await expect(page.getByTestId('cloud-status')).not.toHaveText('雲端已儲存');
    await expect.poll(() => text(references(peer))).toBe('持久原稿');
    await control(false); await references(page).getByRole('button', { name: '重試同步區塊', exact: true }).click();
    await saved(page); await expect(content(references(peer))).toContainText('未持久草稿');
  } finally { await control(false); }
});

test('SB-06：載入失敗不建立空白正文且只影響該區塊，重試取回原稿', async ({ page, browser }) => {
  const source = await openPrivate(page); const id = await convert(page, '載入錯誤仍保留原稿');
  const target = await note(page, '載入隔離頁');
  const freshContext = await browser.newContext({ ignoreHTTPSErrors: true, storageState: { cookies: (await page.context().storageState()).cookies, origins: [] } });
  const fresh = await freshContext.newPage();
  await gate(fresh, [{ pattern: '^/api/synced-blocks/' + id + '$', result: 503 }], true);
  await fresh.goto('/?page=' + target.id); await expect(fresh.getByTestId('ready')).toHaveText('可編輯');
  await fresh.evaluate(id => {
    const editor = window.probe!.editor;
    editor.replaceBlocks(editor.document, [{ type: 'syncedBlock', props: { syncedBlockId: id } }, { type: 'paragraph', content: '其他內容' }]);
  }, id);
  await expect(references(fresh).getByRole('alert')).toContainText('載入失敗');
  await expect(content(references(fresh))).toHaveCount(0);
  await fresh.evaluate(() => { const editor = window.probe!.editor; editor.updateBlock(editor.document.at(-1)!, { content: '錯誤時其他區塊仍能編輯' }); });
  await expect(fresh.getByTestId('local-status')).toHaveText('本機已儲存');
  expect(JSON.stringify(await blocks(fresh))).toContain('錯誤時其他區塊仍能編輯');
  await gate(fresh, []); await references(fresh).getByRole('button', { name: '重試同步區塊', exact: true }).click();
  await expect(content(references(fresh))).toHaveText('載入錯誤仍保留原稿'); await saved(fresh);
  await visit(page, source); await expect(content(references(page))).toHaveText('載入錯誤仍保留原稿');
  await freshContext.close();
});

test('SB-06：同步區塊本機保存失敗保留草稿與其他正文編輯，恢復後可保存', async ({ page }) => {
  await openPrivate(page); const id = await convert(page, '本機原稿');
  const info = await (await page.request.get('/api/synced-blocks/' + id)).json();
  await page.evaluate(room => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
      if (this.name === 'p-note:' + room && args[1] === 'readwrite') throw new Error('測試同步區塊本機交易失敗');
      return original.apply(this, args);
    };
    addEventListener('fixture-local-ready', () => { IDBDatabase.prototype.transaction = original; }, { once: true });
  }, info.room);
  await append(page, references(page), '保留未保存草稿');
  await expect(references(page).getByRole('alert')).toContainText('本機儲存失敗');
  await expect(content(references(page))).toContainText('保留未保存草稿');
  await page.evaluate(() => { const editor = window.probe!.editor; editor.insertBlocks([{ type: 'paragraph', content: '其餘頁面仍能編輯' }], editor.document[0], 'after'); });
  expect(JSON.stringify(await blocks(page))).toContain('其餘頁面仍能編輯');
  await page.evaluate(() => dispatchEvent(new Event('fixture-local-ready')));
  await references(page).getByRole('button', { name: '重試同步區塊', exact: true }).click(); await saved(page);
  await page.reload(); await expect(page.getByTestId('ready')).toHaveText('可編輯'); await saved(page);
  await expect(content(references(page))).toContainText('保留未保存草稿');
});

test('SB-07：已下載同步正文離線刷新保留，重連與另一裝置修改合併', async ({ page, context, browser }) => {
  const source = await openPrivate(page); await convert(page, '離線共同起點');
  const peerContext = await browser.newContext({ ignoreHTTPSErrors: true, storageState: { cookies: (await context.storageState()).cookies, origins: [] } });
  try {
    const peer = await peerContext.newPage(); await openPrivate(peer, source);
    await context.setOffline(true); await append(page, references(page), '離線更新');
    await expect(page.getByTestId('local-status')).toHaveText('本機已儲存');
    await page.reload(); await expect(page.getByTestId('ready')).toHaveText('可編輯');
    await expect(content(references(page))).toContainText('離線更新');
    await expect(page.getByTestId('cloud-status')).not.toHaveText('雲端已儲存');
    await append(peer, references(peer), '連線更新'); await saved(peer);
    await context.setOffline(false); await saved(page);
    await expect(content(references(page))).toContainText('連線更新');
    await expect(content(references(peer))).toContainText('離線更新');
    await page.reload(); await expect(page.getByTestId('ready')).toHaveText('可編輯'); await saved(page);
    await expect(content(references(page))).toContainText('離線更新'); await expect(content(references(page))).toContainText('連線更新');
  } finally { await context.setOffline(false); await peerContext.close(); }
});

test('SB-08：未下載引用離線不可編輯，離線建立被拒且其他正文可編輯', async ({ page, context }) => {
  await openPrivate(page);
  const response = await page.request.post('/api/synced-blocks', { data: { blocks: [{ type: 'paragraph', content: '尚未下載的原文' }] }, headers: { Origin: new URL(page.url()).origin } });
  expect(response.status()).toBe(200); const { id } = await response.json();
  await gate(page, [{ pattern: '^/api/synced-blocks/' + id + '$', hold: true }]);
  await page.evaluate(id => {
    const editor = window.probe!.editor;
    editor.replaceBlocks(editor.document, [{ type: 'syncedBlock', props: { syncedBlockId: id } }, { type: 'paragraph', content: '可離線編輯' }]);
  }, id);
  await expect(page.getByTestId('local-status')).toHaveText('本機已儲存');
  await context.setOffline(true); await page.reload();
  await expect(page.getByTestId('ready')).toHaveText('可編輯');
  await expect(references(page).getByRole('alert')).toContainText('離線無法載入');
  await expect(content(references(page))).toHaveCount(0);
  await page.evaluate(() => { const editor = window.probe!.editor; editor.updateBlock(editor.document.at(-1)!, { content: '離線其他正文更新' }); });
  await expect(page.getByTestId('local-status')).toHaveText('本機已儲存');
  await action(page, '新增同步區塊'); await expect(page.getByRole('alert').filter({ hasText: '離線時不能建立同步區塊' })).toBeVisible();
  await action(page, '轉成同步區塊'); await expect(references(page)).toHaveCount(1);
  await context.setOffline(false);
  // 恢復連線會自動下載，成功後重試按鈕已不在畫面上。
  await expect(content(references(page))).toHaveText('尚未下載的原文'); await saved(page);
  const all = await (await page.request.get('/api/synced-blocks')).json(); expect(all).toHaveLength(1);
});

test('SB-09：解除同步保留當下格式，其他引用繼續更新且不改一般區塊', async ({ page, context }) => {
  const source = await openPrivate(page); const id = await convert(page, '解除前原文');
  await append(page, references(page), '當下快照'); await saved(page);
  const target = await note(page, '解除同步來源');
  const peer = await context.newPage(); await visit(peer, target.id); await addReference(peer, id);
  await references(page).getByRole('button', { name: '解除同步', exact: true }).click();
  await expect(references(page)).toHaveCount(0); await saved(page);
  expect(JSON.stringify(await blocks(page))).toContain('解除前原文當下快照');
  await append(peer, references(peer), '後續同步更新'); await saved(peer);
  expect(JSON.stringify(await blocks(page))).not.toContain('後續同步更新');
  await page.evaluate(() => { const editor = window.probe!.editor; editor.updateBlock(editor.document[0], { content: '只改一般區塊' }); }); await saved(page);
  await expect(content(references(peer))).not.toContainText('只改一般區塊');
  await visit(page, source); expect(JSON.stringify(await blocks(page))).toContain('只改一般區塊');
});

test('SB-10：移除最後引用保留同步原文，管理清單可恢復相同 ID', async ({ page }) => {
  await openPrivate(page); const id = await convert(page, '孤立後仍保留的內容');
  await page.evaluate(() => { const editor = window.probe!.editor; editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: '移除引用' }]); });
  await saved(page); await expect(references(page)).toHaveCount(0);
  const all = await (await page.request.get('/api/synced-blocks')).json();
  expect(all.find((item: { id: string }) => item.id === id)).toMatchObject({ reference_count: 0 });
  await action(page, '引用既有同步區塊');
  await page.getByRole('dialog').getByRole('button', { name: id, exact: true }).click();
  await expect(references(page)).toHaveAttribute('data-synced-block-id', id);
  await expect(content(references(page))).toHaveText('孤立後仍保留的內容'); await saved(page);
});

test('SB-11：引用頁進垃圾桶與還原只改引用清單，同步原文及其他頁仍可編輯', async ({ page, context }) => {
  await openPrivate(page); const id = await convert(page, '不跟著頁面刪除');
  const target = await note(page, '可刪除引用頁'); const peer = await context.newPage();
  await visit(peer, target.id); await addReference(peer, id);
  await expect(references(page).getByRole('button', { name: '已在 2 個頁面使用', exact: true })).toBeVisible();
  const post = (suffix: string) => page.request.post('/api/pages/' + target.id + suffix, { data: {}, headers: { Origin: new URL(page.url()).origin } });
  expect((await post('/delete')).status()).toBe(200);
  await expect(references(page).getByRole('button', { name: '已在 1 個頁面使用', exact: true })).toBeVisible();
  await append(page, references(page), '垃圾桶期間更新'); await saved(page);
  expect((await page.request.get('/api/synced-blocks/' + id)).status()).toBe(200);
  expect((await post('/restore')).status()).toBe(200);
  await expect(references(page).getByRole('button', { name: '已在 2 個頁面使用', exact: true })).toBeVisible();
  await visit(peer, target.id); await expect(content(references(peer))).toContainText('垃圾桶期間更新');
});

test('SB-12：同頁重複引用只計一頁，引用清單列可見標題且能跳轉', async ({ page, context }) => {
  await openPrivate(page); const id = await convert(page);
  const target = await note(page, '引用清單目標'); const peer = await context.newPage();
  await visit(peer, target.id); await addReference(peer, id, 2);
  const trigger = references(page).getByRole('button', { name: '已在 2 個頁面使用', exact: true });
  await expect(trigger).toBeVisible(); await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: target.title, exact: true })).toHaveCount(1);
  await dialog.getByRole('button', { name: target.title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp('page=' + target.id));
  await expect(page.getByLabel('文件標題')).toHaveValue(target.title);
  await expect(references(page)).toHaveCount(2); await saved(page);
});

test('SB-21：手機可直接點擊操作，鍵盤可開清單與解除同步，外框及窄畫面可辨識', async ({ page }, info) => {
  await openPrivate(page);
  const trigger = page.getByRole('button', { name: '同步區塊操作', exact: true });
  if (info.project.use.hasTouch) await trigger.tap();
  else { await trigger.focus(); await page.keyboard.press('Enter'); }
  const create = page.getByRole('menuitem', { name: '新增同步區塊', exact: true });
  if (info.project.use.hasTouch) await create.tap(); else { await create.focus(); await page.keyboard.press('Enter'); }
  await expect(content(references(page))).toBeVisible(); await saved(page);
  await append(page, references(page), '手機選取格式文字'); await saved(page);
  const selectInnerText = async () => {
    await content(references(page)).locator('p').last().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+Home');
    await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe('手機選取格式文字');
    // 浮動格式列依瀏覽器與可用空間透過 portal 呈現在頁面層，文字選取仍須屬於內層正文。
    await expect(page.getByRole('toolbar')).toBeVisible();
  };
  if (info.project.use.hasTouch) await selectInnerText();
  expect(await references(page).evaluate(element => Number.parseFloat(getComputedStyle(element).borderTopWidth))).toBeGreaterThan(0);
  const usage = references(page).getByRole('button', { name: /已在 1 個頁面使用/ });
  if (info.project.use.hasTouch) await usage.tap(); else { await usage.focus(); await page.keyboard.press('Enter'); }
  const referencesDialog = page.getByRole('dialog', { name: '同步區塊引用', exact: true });
  await expect(referencesDialog).toContainText('同步區塊 ID'); await page.keyboard.press('Escape');
  await expect(referencesDialog).toBeHidden();
  await page.setViewportSize({ width: 390, height: 500 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await selectInnerText();
  const unlink = references(page).getByRole('button', { name: '解除同步', exact: true });
  await expect(unlink).toBeVisible();
  if (info.project.use.hasTouch) await unlink.tap(); else { await unlink.focus(); await page.keyboard.press('Enter'); }
  await expect(references(page)).toHaveCount(0); await saved(page);
});

test('SB-22：中文選字期間跨文件同步不重建活動編輯器或重置游標，結束後雙端一致', async ({ page, context }) => {
  await page.clock.install({ time: new Date('2026-10-15T00:00:00Z') });
  const source = await openPrivate(page); await convert(page, '選字前');
  await action(page, '新增同步區塊'); await expect(references(page)).toHaveCount(2); await saved(page);
  const peer = await context.newPage(); await visit(peer, source);
  const active = content(references(page).first());
  await active.locator('p').click(); await page.keyboard.press('End');
  await active.evaluate(element => { (window as unknown as { composingElement: Element }).composingElement = element; });
  await active.dispatchEvent('compositionstart', { data: '' });
  await active.dispatchEvent('compositionupdate', { data: '中文選字' });
  await active.dispatchEvent('beforeinput', { inputType: 'insertCompositionText', data: '中文選字', isComposing: true });
  await page.keyboard.insertText('中文選字');
  const cursor = await active.evaluate(() => {
    const selection = getSelection()!; return { text: selection.anchorNode?.textContent, offset: selection.anchorOffset };
  });
  await append(peer, references(peer).last(), '另一份文件更新'); await saved(peer);
  await expect(content(references(page).last())).toContainText('另一份文件更新');
  expect(await active.evaluate(element => (window as unknown as { composingElement: Element }).composingElement === element)).toBe(true);
  expect(await active.evaluate(() => { const selection = getSelection()!; return { text: selection.anchorNode?.textContent, offset: selection.anchorOffset }; })).toEqual(cursor);
  await expect(active).toBeFocused(); await expect(active).toContainText('中文選字');
  await active.dispatchEvent('compositionend', { data: '中文選字' }); await page.clock.fastForward(501);
  await saved(page); await expect.poll(() => text(references(peer).first())).toBe(await text(references(page).first()));
});
