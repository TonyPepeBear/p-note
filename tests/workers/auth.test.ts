import { env, exports } from 'cloudflare:workers';
import { reset, runInDurableObject, evictDurableObject, abortAllDurableObjects } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { toBase64 } from 'lib0/buffer';
import { handle } from '../../src/worker/app';
import { createAuth, LINK_MS, SESSION_MS } from '../../src/worker/auth';

const origin = 'http://127.0.0.1:5173';
const sockets: WebSocket[] = [];
const fetchApp = (path: string, init?: RequestInit) => exports.default.fetch(origin + path, init);
async function post(path: string, body: object, cookie = '', ip = '192.0.2.1') {
  return fetchApp(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie, 'CF-Connecting-IP': ip }, body: JSON.stringify(body) });
}
async function control(now: number, fail = false) { await post('/__test/control', { now, fail }); }
async function link(ip = '192.0.2.1') {
  expect((await post('/api/login', { email: 'owner@example.test' }, '', ip)).status).toBe(200);
  const mails = await (await fetchApp('/__test/mailbox')).json<{ url: string }[]>();
  return mails.at(-1)!.url;
}
async function login(ip = '192.0.2.1') {
  const url = new URL(await link(ip));
  const response = await post('/api/confirm', { token: url.searchParams.get('token') });
  expect(response.status).toBe(200);
  return response.headers.get('set-cookie')!.split(';')[0];
}
async function today(cookie: string) {
  const response = await fetchApp('/api/today', { headers: { Cookie: cookie } });
  expect(response.status).toBe(200);
  return response.json<{ id: string; owner_id: string; journal_date: string; sync_generation: string; room: string }>();
}
async function connect(cookie: string, page: Awaited<ReturnType<typeof today>>) {
  const response = await fetchApp(`/parties/sync/${page.room}?page=${page.id}&generation=${page.sync_generation}`, { headers: { Upgrade: 'websocket', Cookie: cookie, Origin: origin } });
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  socket.accept(); sockets.push(socket);
  const messages: (string | ArrayBuffer)[] = [];
  socket.addEventListener('message', event => { messages.push(event.data); });
  let closed = false;
  socket.addEventListener('close', () => { closed = true; });
  return { socket, messages, stub: env.SYNC.getByName(page.room), get closed() { return closed; } };
}
beforeEach(async () => { await fetchApp('/health'); });
afterEach(async () => { sockets.splice(0).forEach(socket => socket.close()); await reset(); });

it('AUTH-01：擁有者確認後登入；掃描 GET 不消耗連結；今日日記併發唯一', async () => {
  const boundary = new Date(Date.now() + 2 * 86400000);
  boundary.setUTCHours(16, 0, 0, 0);
  await control(boundary.getTime());
  const url = new URL(await link());
  expect((await fetchApp(url.pathname + url.search)).status).toBe(200);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM session').first('n')).toBe(0);
  const token = url.searchParams.get('token')!;
  expect(JSON.stringify((await env.DB.prepare('SELECT * FROM verification').all()).results)).not.toContain(token);
  const confirmed = await post('/api/confirm', { token });
  expect(confirmed.status).toBe(200);
  const cookie = confirmed.headers.get('set-cookie')!.split(';')[0];
  const session = await (await fetchApp('/api/session', { headers: { Cookie: cookie } })).json<{ user: { email: string } }>();
  expect(session.user.email).toBe('owner@example.test');
  const pages = await Promise.all([today(cookie), today(cookie)]);
  expect(pages[0].id).toBe(pages[1].id);
  expect(pages[0].journal_date).toBe(new Date(boundary.getTime() + 8 * 3600000).toISOString().slice(0, 10));
  expect(await env.DB.prepare('SELECT count(*) AS n FROM pages').first('n')).toBe(1);
});

it('AUTH-02：非允許 Email 不建帳號、不寄信且不洩漏 owner', async () => {
  const response = await post('/api/login', { email: 'stranger@example.test' });
  expect(response.status).toBe(200);
  expect(await response.text()).not.toContain('owner@example.test');
  expect(await env.DB.prepare('SELECT count(*) AS n FROM user').first('n')).toBe(0);
  expect(await (await fetchApp('/__test/mailbox')).json()).toEqual([]);
  expect((await fetchApp('/api/session')).status).toBe(401);
});

it('AUTH-03：10 分鐘邊界過期、重用及併發只建立一個 session', async () => {
  const now = Date.now(); await control(now);
  const first = new URL(await link()).searchParams.get('token');
  const claims = await Promise.all([post('/api/confirm', { token: first }), post('/api/confirm', { token: first })]);
  expect(claims.map(r => r.status).sort()).toEqual([200, 400]);
  expect((await post('/api/confirm', { token: first })).status).toBe(400);
  await control(now + 60000);
  const expired = new URL(await link()).searchParams.get('token');
  await control(now + 60000 + 600000);
  expect((await post('/api/confirm', { token: expired })).status).toBe(400);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM session').first('n')).toBe(1);
});

it('AUTH-04：寄信故障、60 秒與 Email／IP 滑動視窗持久限流', async () => {
  const now = Date.now(); await control(now, true);
  const failed = await post('/api/login', { email: 'owner@example.test' });
  expect(failed.status).toBe(503); expect(await failed.text()).not.toMatch(/token|secret/);
  expect(await (await fetchApp('/__test/mailbox')).json()).toEqual([]);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM verification').first('n')).toBe(0);
  await control(now + 60000);
  expect((await post('/api/login', { email: 'owner@example.test' })).status).toBe(200);
  expect((await post('/api/login', { email: 'owner@example.test' })).status).toBe(429);
  for (let n = 2; n < 5; n++) { await control(now + n * 60000); await link(); }
  await control(now + 5 * 60000);
  expect((await post('/api/login', { email: 'owner@example.test' })).status).toBe(429);
  await control(now + 900000); await link();
  for (let n = 0; n < 20; n++) expect((await post('/api/login', { email: `other${n}@example.test` }, '', '192.0.2.2')).status).toBe(200);
  expect((await post('/api/login', { email: 'owner@example.test' }, '', '192.0.2.2')).status).toBe(429);
  await abortAllDurableObjects();
  expect((await post('/api/login', { email: 'owner@example.test' }, '', '192.0.2.2')).status).toBe(429);
});

it('AUTH-05：固定 30 天不續期，期限前一刻可用、到期拒絕', async () => {
  const now = Date.now(); await control(now);
  const cookie = await login();
  const original = await env.DB.prepare('SELECT * FROM session').first<{ expiresAt: string; createdAt: string }>();
  expect(Date.parse(original!.expiresAt) - Date.parse(original!.createdAt)).toBe(30 * 86400000);
  await control(now + 30 * 86400000 - 1);
  expect((await fetchApp('/api/session', { headers: { Cookie: cookie } })).status).toBe(200);
  expect(await env.DB.prepare('SELECT expiresAt FROM session').first('expiresAt')).toBe(original!.expiresAt);
  await control(now + 30 * 86400000);
  expect((await fetchApp('/api/session', { headers: { Cookie: cookie } })).status).toBe(401);
});

it('AUTH-06：到期的更新拒絕，重新登入回原頁並重驗世代', async () => {
  const now = Date.now(); await control(now);
  const cookie = await login(); const page = await today(cookie);
  await control(now + 30 * 86400000);
  expect((await fetchApp(`/api/pages/${page.id}`, { headers: { Cookie: cookie } })).status).toBe(401);
  const fresh = await login();
  expect((await fetchApp(`/api/pages/${page.id}`, { headers: { Cookie: fresh } })).status).toBe(200);
  await env.DB.prepare('UPDATE pages SET sync_generation = ? WHERE id = ?').bind('g2', page.id).run();
  expect((await fetchApp(`/parties/sync/${page.room}?page=${page.id}&generation=g1`, { headers: { Cookie: fresh, Upgrade: 'websocket', Origin: origin } })).status).toBe(409);
});

it('AUTH-07：私人 API／WebSocket 拒絕未登入與偽造 owner／來源；原型無法路由正式房間', async () => {
  for (const path of ['/api/pages/known', '/api/pages/known/move', '/api/assets/known', '/api/backups/known', '/parties/sync/known']) {
    for (const method of ['GET', 'POST']) expect((await fetchApp(path, { method, headers: { Origin: origin, Upgrade: path.startsWith('/parties/') ? 'websocket' : '', 'x-p-note-session': 'forged' } })).status).toBe(401);
  }
  const cookie = await login(); const page = await today(cookie);
  expect((await post('/api/confirm', { token: 'irrelevant' }, cookie)).status).toBe(400);
  expect((await fetchApp('/api/today', { headers: { Cookie: cookie, Origin: 'https://evil.example' } })).status).toBe(403);
  await env.DB.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)').bind('another-owner', '其他人', 'other@example.test', new Date().toISOString(), new Date().toISOString()).run();
  await env.DB.prepare('UPDATE pages SET owner_id = ? WHERE id = ?').bind('another-owner', page.id).run();
  expect((await fetchApp(`/api/pages/${page.id}`, { headers: { Cookie: cookie } })).status).toBe(404);
  expect((await fetchApp(`/parties/sync/${page.room}?page=${page.id}&generation=${page.sync_generation}`, { headers: { Upgrade: 'websocket', Cookie: cookie, Origin: origin } })).status).toBe(404);
  expect((await handle(new Request(origin + '/parties/rooms/' + page.room, { headers: { Upgrade: 'websocket' } }), env)).status).toBe(404);
  expect((await fetchApp('/api/auth/magic-link/verify?token=fake')).status).toBe(404);
});

it('CONFIG-01：缺值／短密鑰／非法網址拒絕，測試控制入口不在應用 Worker', async () => {
  for (const key of ['OWNER_EMAIL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET']) {
    const response = await handle(new Request(origin + '/api/session'), { ...env, [key]: '' });
    expect(response.status).toBe(503); expect(await response.text()).not.toContain(env.BETTER_AUTH_SECRET);
  }
  for (const BETTER_AUTH_URL of ['http://example.test', origin + '/path', 'file:///tmp']) expect((await handle(new Request(origin + '/api/session'), { ...env, BETTER_AUTH_URL })).status).toBe(503);
  expect((await handle(new Request(origin + '/__test/mailbox'), env)).status).toBe(404);
});

it('CLOCK-01：時鐘在建立過程前進仍自同一建立時刻固定到期', async () => {
  let clock = Date.now() + 86400000;
  const services = { now: () => clock++, sendMail: async () => {} };
  const auth = createAuth(env, services);
  await auth.api.signInMagicLink({ headers: new Headers({ Origin: origin }), body: { email: 'owner@example.test' } });
  const verification = await env.DB.prepare('SELECT expiresAt, createdAt FROM verification').first<{ expiresAt: string; createdAt: string }>();
  expect(Date.parse(verification!.expiresAt) - Date.parse(verification!.createdAt)).toBe(LINK_MS);
  const cookie = await login();
  const session = await (await fetchApp('/api/session', { headers: { Cookie: cookie } })).json<{ user: { id: string } }>();
  await (await auth.$context).internalAdapter.createSession(session.user.id);
  const rows = (await env.DB.prepare('SELECT expiresAt, createdAt FROM session').all<{ expiresAt: string; createdAt: string }>()).results;
  for (const row of rows) expect(Date.parse(row.expiresAt) - Date.parse(row.createdAt)).toBe(SESSION_MS);
});

it('AUTH-08：撤銷／到期後不能更新或收到有效同伴廣播，休眠後仍重驗', async () => {
  const now = Date.now(); await control(now);
  const oldCookie = await login(); const page = await today(oldCookie);
  const old = await connect(oldCookie, page);
  await control(now + 60000); const freshCookie = await login('192.0.2.3');
  const fresh = await connect(freshCookie, page);
  await evictDurableObject(fresh.stub);
  const revoked = await post('/api/logout', {}, oldCookie);
  expect(revoked.status).toBe(200);
  expect(revoked.headers.get('set-cookie')).toContain('Max-Age=0');
  const doc = new Y.Doc(); doc.getText('body').insert(0, '私密');
  old.socket.send(`__YPS:${JSON.stringify({ type: 'commit', id: 'revoked', update: toBase64(Y.encodeStateAsUpdate(doc)) })}`);
  await vi.waitFor(() => expect(old.closed).toBe(true));
  await runInDurableObject(fresh.stub, (_instance, state) => expect(state.storage.sql.exec('SELECT count(*) AS n FROM updates').one().n).toBe(0));
  const before = old.messages.length;
  fresh.socket.send(`__YPS:${JSON.stringify({ type: 'commit', id: 'fresh', update: toBase64(Y.encodeStateAsUpdate(doc)) })}`);
  await vi.waitFor(() => expect(fresh.messages.some(m => typeof m === 'string' && m.includes('persisted'))).toBe(true));
  expect(old.messages.slice(before).filter(m => typeof m !== 'string')).toEqual([]);
  expect(fresh.messages.some(m => typeof m === 'string' && m.includes('persisted'))).toBe(true);
  await control(now + 60000 + 30 * 86400000);
  doc.getText('body').insert(2, '拒絕');
  fresh.socket.send(`__YPS:${JSON.stringify({ type: 'commit', id: 'expired', update: toBase64(Y.encodeStateAsUpdate(doc)) })}`);
  await vi.waitFor(() => expect(fresh.closed).toBe(true));
  await runInDurableObject(fresh.stub, (_instance, state) => expect(state.storage.sql.exec('SELECT count(*) AS n FROM updates').one().n).toBe(1));
});

it('SCHEMA-01：擁有者外鍵、日記（含垃圾桶）唯一、資產／可重建索引且不存 Yjs 正文', async () => {
  const tables = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{ name: string }>()).results.map(row => row.name);
  expect(tables).toEqual(expect.arrayContaining(['user', 'session', 'account', 'verification', 'pages', 'assets', 'page_search']));
  const cookie = await login(); const page = await today(cookie);
  await env.DB.prepare('UPDATE pages SET deleted_at = ? WHERE id = ?').bind(Date.now(), page.id).run();
  expect((await fetchApp('/api/today', { headers: { Cookie: cookie } })).status).toBe(409);
  const clone = env.DB.prepare('INSERT INTO pages (id, owner_id, kind, title, journal_date, sync_generation, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind('clone', page.owner_id, 'journal', 'clone', page.journal_date, 'g1', Date.now(), Date.now());
  await expect(clone.run()).rejects.toThrow(/UNIQUE/);
  const columns = (await env.DB.prepare('PRAGMA table_info(pages)').all<{ name: string }>()).results.map(row => row.name);
  expect(columns).not.toContain('body');
  const date = new Date().toISOString();
  await env.DB.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)').bind('other', '他人', 'other@example.test', date, date).run();
  await env.DB.prepare("INSERT INTO pages (id, owner_id, kind, title, sync_generation, created_at, updated_at) VALUES ('parent', 'other', 'note', '上層', 'g1', 0, 0)").run();
  await expect(env.DB.prepare("INSERT INTO pages (id, owner_id, kind, title, parent_id, sync_generation, created_at, updated_at) VALUES (?, ?, 'note', '子頁', 'parent', 'g1', 0, 0)").bind('child', page.owner_id).run()).rejects.toThrow(/FOREIGN KEY/);
  await expect(env.DB.prepare("INSERT INTO assets VALUES ('image', 'missing-owner', 'object', 'image.png', 'image/png', 1, 'hash', 0)").run()).rejects.toThrow(/FOREIGN KEY/);
  await expect(env.DB.prepare("INSERT INTO page_search (page_id, owner_id, plain_text, summary, indexed_generation, indexed_checkpoint) VALUES (?, 'other', '文字', '摘要', 'g1', 1)").bind(page.id).run()).rejects.toThrow(/FOREIGN KEY/);
});
