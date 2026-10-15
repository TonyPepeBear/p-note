import { test, expect } from '@playwright/test';
import { openPrivate } from './helpers';

test.beforeEach(async ({ request }) => { await request.post('/__test/reset'); });

test('SB-18：引用 JSON、展開內容與獨立 ETag 不讓頁面更新覆蓋同步內容', async ({ page, baseURL }) => {
  const pageId = await openPrivate(page);
  const headers = { Origin: baseURL! };
  const created = await page.request.post('/api/synced-blocks', { headers, data: { blocks: [{ type: 'paragraph', content: '共用正文' }] } });
  expect(created.status()).toBe(200);
  const synced = await created.json();
  const keyInfo = await (await page.request.post('/api/keys', { headers, data: { name: '同步區塊 API' } })).json();
  const { key } = await (await page.request.post(`/api/keys/${keyInfo.id}/reveal`, { headers, data: {} })).json();
  const auth = { Authorization: 'Bearer ' + key };
  const path = `/api/v1/pages/${pageId}/content`;
  const blockPath = `/api/v1/synced-blocks/${synced.id}/content`;
  const original = await page.request.get(path, { headers: auth });
  const references = ['first-reference', 'second-reference'].map(id => ({ id, type: 'syncedBlock', props: { syncedBlockId: synced.id } }));
  const updated = await page.request.put(path, { headers: { ...auth, 'If-Match': original.headers().etag }, data: { blocks: references } });
  expect(updated.status()).toBe(200);
  const plain = await (await page.request.get(path, { headers: auth })).json();
  expect(plain.blocks).toHaveLength(2);
  expect(plain.blocks[0]).toMatchObject(references[0]);
  expect(plain.syncedBlocks).toBeUndefined();
  expect(JSON.stringify(plain)).not.toContain('共用正文');
  const expanded = await (await page.request.get(path + '?expandSyncedBlocks=true', { headers: auth })).json();
  expect(expanded.blocks).toEqual(plain.blocks);
  expect(JSON.stringify(expanded.syncedBlocks[synced.id].blocks)).toContain('共用正文');
  const current = await page.request.get(blockPath, { headers: auth });
  expect(current.status()).toBe(200);
  const put = await page.request.put(blockPath, { headers: { ...auth, 'If-Match': current.headers().etag }, data: { blocks: [{ type: 'codeBlock', props: { language: 'javascript' }, content: 'const shared = true;' }] } });
  expect(put.status()).toBe(200);
  expect((await page.request.put(blockPath, { headers: { ...auth, 'If-Match': current.headers().etag }, data: { blocks: [] } })).status()).toBe(412);
  expect((await page.request.put(blockPath, { headers: auth, data: { blocks: [] } })).status()).toBe(428);
  const currentPage = await page.request.get(path, { headers: auth });
  for (const bad of [
    { blocks: [{ ...references[0], content: '不能從頁面寫入' }] },
    { blocks: [{ ...references[0], children: [{ type: 'paragraph', content: '不能內嵌' }] }] },
    { blocks: [{ type: 'syncedBlock', props: { syncedBlockId: 'missing-block' } }] },
  ]) expect((await page.request.put(path, { headers: { ...auth, 'If-Match': currentPage.headers().etag }, data: bad })).status()).toBe(400);
  expect((await page.request.put(blockPath, { headers: { ...auth, 'If-Match': put.headers().etag }, data: { blocks: references } })).status()).toBe(400);
  expect((await page.request.get('/api/v1/synced-blocks/missing-block/content', { headers: auth })).status()).toBe(404);
  expect(JSON.stringify(await (await page.request.get(blockPath, { headers: auth })).json())).toContain('const shared = true;');
});
