import { env, exports } from 'cloudflare:workers';
import { abortAllDurableObjects, reset } from 'cloudflare:test';
import { afterEach, expect, it } from 'vitest';
import { authenticated, origin } from './helpers';
import { createBackup, readManifest } from '../../src/worker/backups';

afterEach(async () => { await reset(); });
async function setup() {
  const auth = await authenticated(); const created = await auth.post('/api/keys', { name: '正文' }); const k = await created.json<{ id: string }>();
  const reveal = await auth.post(`/api/keys/${k.id}/reveal`, {}); const { key } = await reveal.json<{ key: string }>(); const page = await auth.note('API 正文');
  const send = (path: string, method = 'GET', value?: object, etag?: string) => exports.default.fetch(origin + path, { method, headers: { Authorization: `Bearer ${key}`, ...(value ? { 'Content-Type': 'application/json' } : {}), ...(etag ? { 'If-Match': etag } : {}) }, body: value ? JSON.stringify(value) : undefined });
  const path = `/api/v1/pages/${page.id}/content`; return { auth, k, key, page, send, path };
}
const blocks = [{ id: 'heading', type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '測試標題', styles: { bold: true } }], children: [{ id: 'child', type: 'paragraph', content: '中文巢狀內容' }] }, { id: 'code', type: 'codeBlock', props: { language: 'javascript' }, content: 'let x = 1;\n  x++;' }];
it('KEY-04：JSON 區塊往返、重啟與中文搜尋保留格式', async () => {
  const a = await setup(); const get = await a.send(a.path); expect(get.status).toBe(200); const etag = get.headers.get('etag')!;
  const put = await a.send(a.path, 'PUT', { blocks }, etag); expect(put.status).toBe(200);
  const result = await put.json<{ blocks: unknown[] }>(); expect(result.blocks).toMatchObject(blocks.map((b, i) => i === 0 ? { type: 'heading', props: { level: 2 }, children: [{ type: 'paragraph' }] } : { type: 'codeBlock', props: { language: 'javascript' } }));
  await abortAllDurableObjects();
  const again = await a.send(a.path); expect(again.status).toBe(200); expect((await again.json<{ blocks: unknown[] }>()).blocks).toEqual(result.blocks);
  expect(await (await a.send('/api/v1/search?q=巢狀')).json()).toMatchObject([{ id: a.page.id }]);
});
it('KEY-05：缺少／過時版本與競爭更新不覆蓋正文', async () => {
  const a = await setup(); const get = await a.send(a.path); expect(get.status).toBe(200); const etag = get.headers.get('etag')!;
  expect((await a.send(a.path, 'PUT', { blocks })).status).toBe(428);
  expect((await a.send(a.path, 'PUT', { blocks }, '"old"')).status).toBe(412);
  const requests = await Promise.all([a.send(a.path, 'PUT', { blocks }, etag), a.send(a.path, 'PUT', { blocks: [{ type: 'paragraph', content: '競爭內容' }] }, etag)]);
  expect(requests.map(r => r.status).sort()).toEqual([200, 412]);
});
it('KEY-05：無效內容、超限、跨帳號圖片與儲存故障保留原文', async () => {
  const a = await setup(); const get = await a.send(a.path); expect(get.status).toBe(200); const etag = get.headers.get('etag')!; const original = await get.json();
  for (const bad of [{ blocks: [{ type: 'unknown' }] }, { blocks: [{ type: 'paragraph', props: { arbitrary: true } }] }, { blocks: [{ type: 'paragraph', content: [{ type: 'link', href: 'javascript:alert(1)', content: 'x' }] }] }, { blocks: [{ type: 'image', props: { url: '/api/assets/other' } }] }, { blocks: [{ type: 'paragraph', content: 'x'.repeat(270000) }] }]) expect((await a.send(a.path, 'PUT', bad, etag)).status).toBe(400);
  await a.auth.post('/__test/storage-failure', { room: a.page.room, fail: true });
  expect((await a.send(a.path, 'PUT', { blocks }, etag)).status).toBe(503);
  expect(await (await a.send(a.path)).json()).toEqual(original);
  await a.auth.post('/__test/storage-failure', { room: a.page.room, fail: false });
  await a.auth.post(`/api/pages/${a.page.id}/delete`, {});
  expect((await a.send(a.path)).status).toBe(404);
});
it('KEY-06：備份不包含 key，還原不復活已撤銷憑證', async () => {
  const a = await setup(); const backup = await createBackup(env, a.page.owner_id, () => a.auth.now);
  const manifest = await readManifest(env, a.page.owner_id, backup.id, a.auth.now);
  const serialized = JSON.stringify(manifest); expect(serialized).not.toContain(a.key); expect(serialized).not.toContain('api_keys');
  for (const item of [...manifest.pages, ...manifest.assets]) { const object = await env.BACKUPS.get(`${a.page.owner_id}/${backup.id}/${item.file.path}`); expect(object).not.toBeNull(); expect(await object!.text()).not.toContain(a.key); }
  await a.auth.post(`/api/keys/${a.k.id}/revoke`, {});
  expect((await a.auth.post(`/api/backups/${backup.id}/restore`, {})).status).toBe(200);
  expect((await a.send('/api/v1/pages')).status).toBe(401);
});
it('KEY-05：API 大量更新後自動整理持久紀錄', async () => {
  const a = await setup(); let response = await a.send(a.path); expect(response.status).toBe(200);
  for (let i = 0; i < 65; i++) { response = await a.send(a.path, 'PUT', { blocks: [{ type: 'paragraph', content: '更新 ' + i }] }, response.headers.get('etag')!); expect(response.status).toBe(200); }
  const { runInDurableObject } = await import('cloudflare:test');
  const pending = await runInDurableObject(env.SYNC.getByName(a.page.room), async (_instance, state) => state.storage.sql.exec<{ n: number }>('SELECT count(*) AS n FROM updates').one().n);
  expect(pending).toBeLessThan(64);
  await abortAllDurableObjects(); expect(JSON.stringify(await (await a.send(a.path)).json())).toContain('更新 64');
});
