import { env, exports } from 'cloudflare:workers';
import { reset } from 'cloudflare:test';
import { afterEach, expect, it } from 'vitest';
import { authenticated, origin } from './helpers';

afterEach(async () => { await reset(); });
async function key(auth: Awaited<ReturnType<typeof authenticated>>, name = '自動化') {
  const response = await auth.post('/api/keys', { name }); expect(response.status).toBe(201);
  const row = await response.json<{ id: string }>();
  const reveal = await auth.post(`/api/keys/${row.id}/reveal`, {}); expect(reveal.status).toBe(200);
  return { ...row, ...(await reveal.json<{ key: string }>()) };
}
function external(token: string, path: string, method = 'GET', value?: object, headers: Record<string, string> = {}) {
  return exports.default.fetch(origin + path, { method, headers: { Authorization: `Bearer ${token}`, ...(value ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: value ? JSON.stringify(value) : undefined });
}
it('KEY-01：具名 key 加密保存且可再次顯示，列表無明文並禁止快取', async () => {
  const auth = await authenticated(); const k = await key(auth);
  expect(k.key).toMatch(/^pn_[a-f0-9]{64}$/);
  for (let i = 0; i < 2; i++) { const r = await auth.post(`/api/keys/${k.id}/reveal`, {}); expect(r.headers.get('cache-control')).toBe('no-store'); expect(await r.json()).toEqual({ key: k.key }); }
  const list = await auth.get('/api/keys'); expect(list.headers.get('cache-control')).toBe('no-store');
  expect(await list.text()).not.toContain(k.key);
  expect(JSON.stringify((await env.DB.prepare('SELECT * FROM api_keys').all()).results)).not.toContain(k.key);
  expect((await auth.post('/api/keys', { name: ' ' })).status).toBe(400);
});
it('KEY-02：只有本人的 cookie 可管理 key，撤銷不影響另一把', async () => {
  const auth = await authenticated(); const a = await key(auth); const b = await key(auth, '第二把');
  expect((await exports.default.fetch(origin + '/api/keys')).status).toBe(401);
  expect((await external(a.key, `/api/keys/${b.id}/reveal`, 'POST', {})).status).toBe(401);
  expect((await external(a.key, '/api/keys', 'GET', undefined, { Cookie: auth.cookie })).status).toBe(401);
  expect((await exports.default.fetch(origin + `/api/keys/${a.id}/reveal`, { method: 'POST', headers: { Cookie: auth.cookie, Origin: 'https://other.test' } })).status).toBe(403);
  await env.DB.prepare('UPDATE api_keys SET owner_id = ? WHERE id = ?').bind('other', b.id).run();
  expect((await auth.post(`/api/keys/${b.id}/reveal`, {})).status).toBe(404);
  await env.DB.prepare('UPDATE api_keys SET owner_id = ? WHERE id = ?').bind((await auth.today()).owner_id, b.id).run();
  expect((await auth.post(`/api/keys/${a.id}/revoke`, {})).status).toBe(200);
  expect((await auth.post(`/api/keys/${a.id}/reveal`, {})).status).toBe(404);
  expect((await external(a.key, '/api/v1/pages')).status).toBe(401);
  expect((await external(b.key, '/api/v1/pages')).status).toBe(200);
});
it('KEY-03：Bearer 內容操作、帳號與垃圾桶隔離及明確 allowlist', async () => {
  const auth = await authenticated(); const k = await key(auth); const own = await auth.today();
  const created = await external(k.key, '/api/v1/pages', 'POST', { title: 'API 中文', owner_id: 'other' }); expect(created.status).toBe(200);
  const page = await created.json<{ id: string; owner_id: string }>(); expect(page.owner_id).toBe(own.owner_id);
  expect((await external(k.key, `/api/v1/pages/${page.id}/title`, 'POST', { title: 'API 改名' })).status).toBe(200);
  expect((await external(k.key, `/api/v1/pages/${page.id}/move`, 'POST', { parent_id: null })).status).toBe(200);
  const search = await external(k.key, '/api/v1/search?q=改名'); expect((await search.json<{ id: string }[]>()).map(p => p.id)).toContain(page.id);
  const j = await external(k.key, '/api/v1/journal', 'POST', { date: '2026-01-02' }); const j2 = await external(k.key, '/api/v1/journal', 'POST', { date: '2026-01-02' });
  expect((await j.json<{ id: string }>()).id).toBe((await j2.json<{ id: string }>()).id);
  expect((await external(k.key, '/api/v1/journals?month=2026-01')).status).toBe(200);
  for (const path of ['/api/v1/backups', '/api/v1/keys', `/api/v1/pages/${page.id}/delete`, '/api/v1/assets']) expect((await external(k.key, path, 'POST', {})).status).toBe(403);
  expect((await external('bad', '/api/v1/pages', 'GET', undefined, { Cookie: auth.cookie })).status).toBe(401);
  await auth.post(`/api/pages/${page.id}/delete`, {});
  expect((await external(k.key, `/api/v1/pages/${page.id}`)).status).toBe(404);
  expect((await external(k.key, '/api/v1/pages')).status).toBe(200);
  await env.DB.prepare("INSERT INTO user VALUES ('other', 'Other', 'other@test.invalid', 1, NULL, '', '')").run();
  await env.DB.prepare('UPDATE pages SET owner_id = ? WHERE id = ?').bind('other', page.id).run();
  expect((await external(k.key, `/api/v1/pages/${page.id}`)).status).toBe(404);
});
export { key, external };
it('KEY-02：名稱長度與併發建立的每帳號 key 上限', async () => {
  const auth = await authenticated();
  expect((await auth.post('/api/keys', { name: 'x'.repeat(81) })).status).toBe(400);
  const results = await Promise.all(Array.from({ length: 21 }, (_, i) => auth.post('/api/keys', { name: 'key ' + i })));
  expect(results.filter(r => r.status === 201)).toHaveLength(20); expect(results.filter(r => r.status === 409)).toHaveLength(1);
});
