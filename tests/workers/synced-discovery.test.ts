import { env, exports } from 'cloudflare:workers';
import { reset } from 'cloudflare:test';
import { afterEach, expect, it } from 'vitest';
import { authenticated, origin } from './helpers';

afterEach(async () => { await reset(); });

async function fixture() {
  const auth = await authenticated();
  const first = await auth.note('第一來源'); const second = await auth.note('第二來源');
  const target = await auth.note('連結目標');
  await env.DB.prepare('INSERT INTO synced_blocks VALUES (?, ?, ?, ?, ?)').bind('shared-discovery', first.owner_id, 'block-generation', auth.now, auth.now).run();
  await env.DB.prepare('INSERT INTO synced_block_search VALUES (?, ?, ?, ?, ?, ?)')
    .bind('shared-discovery', first.owner_id, '只有同步內容裡的搜尋詞', JSON.stringify([target.id, target.id]), 'block-generation', 1).run();
  for (const page of [first, second]) {
    await env.DB.prepare('INSERT INTO page_synced_blocks VALUES (?, ?)').bind(page.id, 'shared-discovery').run();
    await env.DB.prepare('INSERT INTO page_search (page_id, owner_id, plain_text, summary, indexed_generation, indexed_checkpoint, linked_pages) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(page.id, page.owner_id, '', '', page.sync_generation, 1, page.id === first.id ? JSON.stringify([target.id]) : '[]').run();
  }
  const search = async () => (await auth.get('/api/search?q=' + encodeURIComponent('只有同步內容'))).json<{ id: string; summary: string }[]>();
  const backlinks = async () => (await auth.get('/api/pages/' + target.id + '/backlinks')).json<{ id: string }[]>();
  return { auth, first, second, target, search, backlinks };
}

it('SB-13：同步文字搜尋涵蓋每個可見引用頁，排除垃圾桶與舊世代索引', async () => {
  const { auth, first, second, search } = await fixture();
  expect((await search()).map(page => page.id).sort()).toEqual([first.id, second.id].sort());
  expect((await search()).every(page => page.summary.includes('只有同步內容'))).toBe(true);
  await auth.post('/api/pages/' + second.id + '/delete', {});
  expect((await search()).map(page => page.id)).toEqual([first.id]);
  await auth.post('/api/pages/' + second.id + '/restore', {});
  expect((await search()).length).toBe(2);
  await env.DB.prepare('UPDATE synced_block_search SET indexed_generation = ?').bind('old-block-generation').run();
  expect(await search()).toEqual([]);
});

it('SB-14：同步內連結依每個引用頁產生反向連結，以頁 ID 去重並排除隱藏頁', async () => {
  const { auth, first, second, backlinks } = await fixture();
  expect((await backlinks()).map(page => page.id).sort()).toEqual([first.id, second.id].sort());
  await auth.post('/api/pages/' + second.id + '/delete', {});
  expect((await backlinks()).map(page => page.id)).toEqual([first.id]);
  await env.DB.prepare('DELETE FROM page_synced_blocks WHERE page_id = ?').bind(first.id).run();
  expect((await backlinks()).map(page => page.id)).toEqual([first.id]);
  await env.DB.prepare("UPDATE page_search SET linked_pages = '[]' WHERE page_id = ?").bind(first.id).run();
  expect(await backlinks()).toEqual([]);
});

it('SB-13 SB-14：實際持久寫入同步正文及頁面引用後重建索引，修改與移除不留下過期結果', async () => {
  const auth = await authenticated();
  const first = await auth.note('真實第一來源'); const second = await auth.note('真實第二來源');
  const target = await auth.note('真實連結目標');
  const created = await auth.post('/api/synced-blocks', { blocks: [{ type: 'paragraph', content: '索引建立前' }] });
  expect(created.status).toBe(200); const block = await created.json<{ id: string }>();
  const keyInfo = await (await auth.post('/api/keys', { name: '同步索引驗證' })).json<{ id: string }>();
  const { key } = await (await auth.post(`/api/keys/${keyInfo.id}/reveal`, {})).json<{ key: string }>();
  const read = (path: string) => exports.default.fetch(origin + '/api/v1' + path, { headers: { Authorization: 'Bearer ' + key } });
  const write = async (path: string, blocks: unknown[]) => {
    const current = await read(path); expect(current.status).toBe(200);
    const result = await exports.default.fetch(origin + '/api/v1' + path, {
      method: 'PUT', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'If-Match': current.headers.get('etag')! },
      body: JSON.stringify({ blocks }),
    });
    expect(result.status).toBe(200);
  };
  const reference = (id: string) => ({ id, type: 'syncedBlock', props: { syncedBlockId: block.id } });
  const link = { type: 'link', href: '/?page=' + target.id, content: '目標連結' };
  const firstPath = `/pages/${first.id}/content`; const secondPath = `/pages/${second.id}/content`;
  const blockPath = `/synced-blocks/${block.id}/content`;
  await write(firstPath, [reference('first-reference'), reference('repeated-reference'), { type: 'paragraph', content: [link, link] }]);
  await write(secondPath, [reference('second-reference')]);
  // 不直接寫索引表：正文更新必須經持久保存及正式索引流程，查詢才取得投影。
  await write(blockPath, [{ type: 'paragraph', content: [{ type: 'text', text: '同步舊詞只在共用正文', styles: {} }, link, link] }]);
  const search = async (query: string) => {
    const response = await auth.get('/api/search?q=' + encodeURIComponent(query)); expect(response.status).toBe(200);
    return response.json<{ id: string }[]>();
  };
  const backlinks = async () => {
    const response = await auth.get('/api/pages/' + target.id + '/backlinks'); expect(response.status).toBe(200);
    return response.json<{ id: string }[]>();
  };
  const expected = [first.id, second.id].sort();
  expect((await search('同步舊詞')).map(page => page.id).sort()).toEqual(expected);
  expect((await backlinks()).map(page => page.id).sort()).toEqual(expected);
  await write(blockPath, [{ type: 'paragraph', content: '同步新詞替換並移除連結' }]);
  expect(await search('同步舊詞')).toEqual([]);
  expect((await search('同步新詞')).map(page => page.id).sort()).toEqual(expected);
  // 同步內最後一個連結移除後，第一頁的一般正文連結仍是唯一反向來源。
  expect((await backlinks()).map(page => page.id)).toEqual([first.id]);
  await write(firstPath, [reference('first-reference'), reference('repeated-reference')]);
  expect(await backlinks()).toEqual([]);
  await write(secondPath, [{ type: 'paragraph', content: '第二頁已移除引用' }]);
  expect((await search('同步新詞')).map(page => page.id)).toEqual([first.id]);
  await write(firstPath, [{ type: 'paragraph', content: '第一頁也移除引用' }]);
  expect(await search('同步新詞')).toEqual([]);
}, 30000);
