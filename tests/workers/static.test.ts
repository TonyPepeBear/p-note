import { env, exports } from 'cloudflare:workers';
import { createExecutionContext, reset } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it } from 'vitest';
import app from '../../src/worker/app';
import { origin } from './helpers';

beforeEach(async () => { await exports.default.fetch(origin + '/health'); });
afterEach(async () => { await reset(); });
function assets() {
  const requested: string[] = [];
  const bindings = new Proxy(env, { get(target, key) {
    if (key === 'STATIC') return { fetch: async (request: Request) => {
      requested.push(new URL(request.url).pathname);
      return new Response('建置入口', { headers: { 'Content-Type': 'text/html' } });
    } };
    return Reflect.get(target, key, target);
  } });
  const get = (path: string) => app.fetch(new Request(origin + path), bindings, createExecutionContext());
  return { get, requested };
}
it('STATIC-01：應用 Worker 提供建置入口與靜態資源，登入確認 GET 不消耗憑證', async () => {
  const { get, requested } = assets();
  expect((await get('/')).status).toBe(200); expect(await (await get('/assets/app.js')).text()).toBe('建置入口');
  const count = await env.DB.prepare('SELECT count(*) AS n FROM verification').first('n');
  const response = await get('/login/confirm?token=fixture-token'); expect(response.status).toBe(200); expect(await response.text()).toBe('建置入口');
  expect(response.headers.get('Cache-Control')).toBe('no-store'); expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
  expect(await env.DB.prepare('SELECT count(*) AS n FROM verification').first('n')).toBe(count);
  expect(requested).toEqual(['/', '/assets/app.js', '/']);
});
it('STATIC-02：靜態入口不能繞過私人 API，也不能提供測試／原型房間', async () => {
  const { get, requested } = assets();
  expect((await get('/api/session')).status).toBe(401);
  for (const path of ['/__test/reset', '/probe', '/parties/rooms/test', '/parties/restores/test']) expect((await get(path)).status).toBe(404);
  expect(requested).toEqual([]);
});
