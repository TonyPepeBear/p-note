import { env, exports } from 'cloudflare:workers';
import { reset, runInDurableObject } from 'cloudflare:test';
import { afterEach, expect, it } from 'vitest';
import { handle } from '../../src/worker/app';

afterEach(reset);

it('ENV-02：D1／SQLite DO／R2 是隔離的真實本機儲存且可清理', async () => {
  await env.DB.exec('CREATE TABLE fixture (value TEXT); INSERT INTO fixture VALUES (\'隔離\')');
  await env.ASSETS.put('fixture', '原圖 fixture');
  await env.BACKUPS.put('fixture', '獨立備份 fixture');
  const stub = env.ROOMS.getByName('environment');
  await runInDurableObject(stub, async (_instance, state) => {
    state.storage.sql.exec('CREATE TABLE fixture (value TEXT)');
    state.storage.sql.exec('INSERT INTO fixture VALUES (?)', 'SQLite');
    expect(state.storage.sql.exec('SELECT value FROM fixture').one().value).toBe('SQLite');
  });
  expect(await env.DB.prepare('SELECT value FROM fixture').first('value')).toBe('隔離');
  expect(await (await env.ASSETS.get('fixture'))?.text()).toBe('原圖 fixture');
  expect(await (await env.BACKUPS.get('fixture'))?.text()).toBe('獨立備份 fixture');
  await reset();
  expect(await env.ASSETS.get('fixture')).toBeNull();
  expect(await env.BACKUPS.get('fixture')).toBeNull();
  expect(await env.DB.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'fixture'").first('n')).toBe(0);
  await runInDurableObject(env.ROOMS.getByName('environment'), (_instance, state) => {
    expect(state.storage.sql.exec("SELECT count(*) AS n FROM sqlite_master WHERE name = 'fixture'").one().n).toBe(0);
  });
});

it('ENV-03：原型 Worker 拒絕外部網站入口', async () => {
  expect((await exports.default.fetch('https://example.com/parties/rooms/test')).status).toBe(403);
  expect((await exports.default.fetch('http://127.0.0.1/health')).status).toBe(200);
});

it('ENV-07：測試寄件匣／時鐘／故障隔離且 reset 清除，不存在於應用入口', async () => {
  const origin = 'http://127.0.0.1:5173';
  const now = Date.now() + 86400000;
  const post = (path: string, body: object) => exports.default.fetch(origin + path, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  await post('/__test/control', { now });
  expect((await post('/api/login', { email: 'owner@example.test' })).status).toBe(200);
  const expiration = await env.DB.prepare('SELECT expiresAt FROM verification').first<string>('expiresAt');
  expect(Date.parse(expiration!)).toBe(now + 600000);
  expect((await env.DB.prepare('SELECT url FROM test_mailbox').all()).results).toHaveLength(1);
  await post('/__test/control', { now: now + 60000, fail: true });
  expect((await post('/api/login', { email: 'owner@example.test' })).status).toBe(503);
  expect((await env.DB.prepare('SELECT url FROM test_mailbox').all()).results).toHaveLength(1);
  expect((await handle(new Request(origin + '/__test/control', { method: 'POST' }), env)).status).toBe(404);
  await reset();
  expect(await env.DB.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name IN ('test_control', 'test_mailbox')").first('n')).toBe(0);
});
