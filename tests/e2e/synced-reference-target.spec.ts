import { expect, test } from '@playwright/test';
import { openPrivate, saved } from './helpers';

test.setTimeout(60000);
test.beforeEach(async ({ request }) => {
  await request.post('/__test/reset');
  await request.post('/__test/control', { data: { now: Date.now() + 86400000 } });
});

test('SB-18：API 保留引用節點 ID 改指另一個已開啟的同步區塊，編輯只更新新目標', async ({ page, baseURL }) => {
  const pageId = await openPrivate(page);
  const headers = { Origin: baseURL! };
  const create = async (text: string) => {
    const response = await page.request.post('/api/synced-blocks', {
      headers, data: { blocks: [{ type: 'paragraph', content: text }] },
    });
    expect(response.status()).toBe(200);
    return response.json() as Promise<{ id: string }>;
  };
  const original = await create('原本的同步正文');
  const target = await create('新的同步正文');
  const references = [
    { id: 'retained-reference', type: 'syncedBlock', props: { syncedBlockId: original.id } },
    { id: 'existing-target-reference', type: 'syncedBlock', props: { syncedBlockId: target.id } },
  ];
  await page.evaluate(references => {
    const editor = window.probe!.editor;
    editor.replaceBlocks(editor.document, references);
  }, references);
  const first = page.getByTestId('synced-block').first();
  const second = page.getByTestId('synced-block').nth(1);
  const firstContent = first.locator('.synced-block-editor .tiptap');
  await expect(firstContent).toContainText('原本的同步正文');
  await expect(second.locator('.synced-block-editor .tiptap')).toContainText('新的同步正文');
  await saved(page);

  const keyInfo = await (await page.request.post('/api/keys', { headers, data: { name: '引用目標回歸測試' } })).json();
  const { key } = await (await page.request.post(`/api/keys/${keyInfo.id}/reveal`, { headers, data: {} })).json();
  const auth = { Authorization: 'Bearer ' + key };
  const path = `/api/v1/pages/${pageId}/content`;
  const before = await page.request.get(path, { headers: auth });
  expect(before.status()).toBe(200);
  // 第二個引用已載入同一份目標文件，取得現有 session 的微任務可能和 loading 狀態合併渲染。
  const switched = await page.request.put(path, {
    headers: { ...auth, 'If-Match': before.headers().etag },
    data: { blocks: [{ ...references[0], props: { syncedBlockId: target.id } }, references[1]] },
  });
  expect(switched.status()).toBe(200);
  await expect(first).toHaveAttribute('data-synced-block-id', target.id);
  await expect(firstContent).toContainText('新的同步正文');
  await expect(firstContent).not.toContainText('原本的同步正文');
  await saved(page);
  expect(await page.evaluate(() => window.probe!.editor.document[0].id)).toBe('retained-reference');

  await firstContent.locator('p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.insertText('只改新的目標');
  await saved(page);
  await expect(second.locator('.synced-block-editor .tiptap')).toContainText('只改新的目標');
  const read = async (id: string) => (await page.request.get(`/api/v1/synced-blocks/${id}/content`, { headers: auth, timeout: 8000 })).json();
  const originalBody = await read(original.id);
  const targetBody = await read(target.id);
  expect(JSON.stringify(originalBody.blocks)).toContain('原本的同步正文');
  expect(JSON.stringify(originalBody.blocks)).not.toContain('只改新的目標');
  expect(JSON.stringify(targetBody.blocks)).toContain('新的同步正文只改新的目標');
});
