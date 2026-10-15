import { env } from 'cloudflare:workers';
import { reset } from 'cloudflare:test';
import { afterEach, expect, it } from 'vitest';
import { authenticated } from './helpers';

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
