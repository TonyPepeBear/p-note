import { env, exports } from 'cloudflare:workers';
import { reset, runInDurableObject } from 'cloudflare:test';
import { afterEach, expect, it } from 'vitest';

afterEach(reset);

it('ENV-02：D1／SQLite DO／R2 是隔離的真實本機儲存且可清理', async () => {
  await env.DB.exec('CREATE TABLE fixture (value TEXT); INSERT INTO fixture VALUES (\'隔離\')');
  await env.ASSETS.put('fixture', '原圖 fixture');
  const stub = env.ROOMS.getByName('environment');
  await runInDurableObject(stub, async (_instance, state) => {
    state.storage.sql.exec('CREATE TABLE fixture (value TEXT)');
    state.storage.sql.exec('INSERT INTO fixture VALUES (?)', 'SQLite');
    expect(state.storage.sql.exec('SELECT value FROM fixture').one().value).toBe('SQLite');
  });
  expect(await env.DB.prepare('SELECT value FROM fixture').first('value')).toBe('隔離');
  expect(await (await env.ASSETS.get('fixture'))?.text()).toBe('原圖 fixture');
  await reset();
  expect(await env.ASSETS.get('fixture')).toBeNull();
  expect(await env.DB.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'fixture'").first('n')).toBe(0);
  await runInDurableObject(env.ROOMS.getByName('environment'), (_instance, state) => {
    expect(state.storage.sql.exec("SELECT count(*) AS n FROM sqlite_master WHERE name = 'fixture'").one().n).toBe(0);
  });
});

it('ENV-03：原型 Worker 拒絕外部網站入口', async () => {
  expect((await exports.default.fetch('https://example.com/parties/rooms/test')).status).toBe(403);
  expect((await exports.default.fetch('http://127.0.0.1/health')).status).toBe(200);
});
