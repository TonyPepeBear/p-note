import { env, exports } from 'cloudflare:workers';
import { reset } from 'cloudflare:test';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } from '@zip.js/zip.js';
import { fixture, create, hash, manifest, request } from './backup-helpers';
import { origin } from './helpers';
import { handle } from '../../src/worker/app';
import type { BackupManifest } from '../../src/shared/backup';
import { images } from '../fixtures/images';

const sockets: WebSocket[] = [];
beforeEach(async () => { await exports.default.fetch(origin + '/health'); await exports.default.fetch(origin + '/__test/reset', { method: 'POST' }); });
afterEach(async () => { sockets.splice(0).forEach(socket => socket.close()); await reset(); });

it('BACKUP-06：完整 ZIP 檔案集合／正文／原圖／校驗值一致，排除登入憑證與服務密鑰', async () => {
  const f = await fixture(sockets); const backup = await create(f.auth);
  const response = await request(f.auth, `/api/backups/${backup.id}/export`);
  expect(response.status).toBe(200); expect(response.headers.get('Content-Type')).toBe('application/zip');
  expect(response.headers.get('Cache-Control')).toBe('no-store'); expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(response.headers.get('Content-Disposition')).toContain(backup.id + '.zip');
  const bytes = new Uint8Array(await response.arrayBuffer());
  const zip = new ZipReader(new Uint8ArrayReader(bytes), { useWebWorkers: false });
  const files = new Map<string, Uint8Array>();
  for (const entry of await zip.getEntries()) {
    expect(entry.directory).toBe(false); expect(entry.zip64).toBe(true);
    expect(files.has(entry.filename)).toBe(false);
    if (!entry.directory) files.set(entry.filename, await entry.getData(new Uint8ArrayWriter(), { checkSignature: true }));
  }
  await zip.close();
  const data = JSON.parse(new TextDecoder().decode(files.get('manifest.json'))) as BackupManifest;
  expect(data.owner.id).toBe(f.root.owner_id); expect(data.completed_at).toBe(backup.completed_at);
  expect([...files.keys()].sort()).toEqual(['manifest.json', ...data.pages.map(page => page.file.path), ...data.assets.map(asset => asset.file.path), ...data.pages.map(page => `readable/pages/${page.metadata.id}.md`)].sort());
  for (const page of data.pages) {
    expect(files.get(page.file.path)).toEqual(f.documents.get(page.metadata.id));
    expect(await hash(files.get(page.file.path)!)).toBe(page.file.checksum);
  }
  expect(files.get(data.assets[0].file.path)).toEqual(images.png);
  expect(await hash(files.get(data.assets[0].file.path)!)).toBe(data.assets[0].file.checksum);
  const token = await env.DB.prepare('SELECT token FROM session LIMIT 1').first<string>('token');
  const raw = new TextDecoder().decode(bytes); expect(raw).not.toContain(token!); expect(raw).not.toContain(env.BETTER_AUTH_SECRET);
  expect(JSON.stringify(data)).not.toMatch(/session|verification|accessToken|refreshToken/);
}, 20000);

it('ZIP-SCHEMA-02：建立時亦校驗 metadata，不發布無法下載的成功備份', async () => {
  const f = await fixture(sockets); const successful = await create(f.auth);
  await env.DB.prepare('UPDATE pages SET title = ? WHERE id = ?').bind('', f.root.id).run();
  expect((await request(f.auth, '/api/backups', env, 'POST')).status).toBe(503);
  const list = await (await request(f.auth, '/api/backups')).json<{ latest: string }>(); expect(list.latest).toBe(successful.id);
}, 20000);

it('ZIP-STREAM-01：串流期間副本失效則中止整份下載，不產生可解析的部分 ZIP', async () => {
  const f = await fixture(sockets); const backup = await create(f.auth); const data = await manifest(f.auth, backup.id);
  const key = `${f.root.owner_id}/${backup.id}/${data.pages[0].file.path}`; let reads = 0;
  const configured = { ...env, BACKUPS: new Proxy(env.BACKUPS, { get(target, property) {
    if (property === 'get') return async (...args: Parameters<R2Bucket['get']>) => {
      if (args[0] === key && ++reads === 2) await target.put(key, new Uint8Array([1, 2, 3]));
      return Reflect.apply(target.get, target, args);
    };
    const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
  } }) };
  const response = await request(f.auth, `/api/backups/${backup.id}/export`, configured); expect(response.status).toBe(200);
  await expect(response.arrayBuffer()).rejects.toThrow('備份下載中斷'); expect(reads).toBe(2);
}, 20000);

it('ZIP-GUARD-01：下載驗證登入／所有權／保留期，副本毀損時拒絕回傳成功 ZIP', async () => {
  const f = await fixture(sockets); const backup = await create(f.auth); const data = await manifest(f.auth, backup.id);
  const path = `/api/backups/${backup.id}/export`;
  expect((await handle(new Request(origin + path), env)).status).toBe(401);
  await env.BACKUPS.put(`${f.root.owner_id}/${backup.id}/${data.pages[0].file.path}`, new Uint8Array([1, 2, 3]));
  expect((await request(f.auth, path)).status).toBe(503);
  await env.DB.prepare('UPDATE backups SET completed_at = ? WHERE id = ?').bind(f.auth.now - 90 * 86400000, backup.id).run();
  expect((await request(f.auth, path)).status).toBe(404);
  const date = new Date().toISOString();
  await env.DB.prepare("INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('other', '其他人', 'other@example.test', 1, ?, ?)").bind(date, date).run();
  await env.DB.prepare('UPDATE backups SET owner_id = ? WHERE id = ?').bind('other', backup.id).run();
  expect((await request(f.auth, path)).status).toBe(404);
}, 20000);

it('ZIP-SCHEMA-01：即使清單雜湊正確也拒絕路徑穿越、重複頁面、外人資料、循環與憑證欄位', async () => {
  const f = await fixture(sockets); const backup = await create(f.auth);
  const key = `${f.root.owner_id}/${backup.id}/manifest.json`;
  const original = await (await env.BACKUPS.get(key))!.text();
  const mutations: ((data: BackupManifest) => void)[] = [
    data => { data.pages[0].file.path = '../private'; },
    data => { data.pages.push(data.pages[0]); },
    data => { data.pages[0].metadata.owner_id = 'other'; },
    data => { data.pages.find(page => page.metadata.id === f.root.id)!.metadata.parent_id = f.child.id; },
    data => { Object.assign(data.pages[0].metadata, { session: '不得匯出' }); },
  ];
  for (const mutate of mutations) {
    const data = JSON.parse(original) as BackupManifest; mutate(data);
    const bytes = new TextEncoder().encode(JSON.stringify(data)); await env.BACKUPS.put(key, bytes);
    await env.DB.prepare('UPDATE backups SET manifest_checksum = ?, manifest_size = ? WHERE id = ?').bind(await hash(bytes), bytes.length, backup.id).run();
    expect((await request(f.auth, `/api/backups/${backup.id}/export`)).status).toBe(503);
  }
}, 20000);
