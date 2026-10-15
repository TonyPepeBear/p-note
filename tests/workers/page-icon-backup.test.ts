import { env, exports } from 'cloudflare:workers';
import { reset } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } from '@zip.js/zip.js';
import type { BackupManifest } from '../../src/shared/backup';
import { validateManifest } from '../../src/worker/backup-validation';
import { authenticated, origin } from './helpers';
import { create, hash, manifest, request, type Auth } from './backup-helpers';

beforeEach(async () => {
  await exports.default.fetch(origin + '/health');
  await exports.default.fetch(origin + '/__test/reset', { method: 'POST' });
});
afterEach(async () => { await reset(); });

async function rewrite(auth: Auth, backup: string, mutate: (data: BackupManifest) => void) {
  const owner = await env.DB.prepare('SELECT owner_id FROM backups WHERE id = ?').bind(backup).first<string>('owner_id');
  const key = `${owner}/${backup}/manifest.json`;
  const data = JSON.parse(await (await env.BACKUPS.get(key))!.text()) as BackupManifest;
  mutate(data);
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  await env.BACKUPS.put(key, bytes);
  await env.DB.prepare('UPDATE backups SET manifest_checksum = ?, manifest_size = ? WHERE id = ?').bind(await hash(bytes), bytes.length, backup).run();
  return request(auth, `/api/backups/${backup}/manifest`);
}

it('ICON-04：清單接受單一 emoji icon，並保留原有版本', async () => {
  const auth = await authenticated(); await auth.note('圖示清單');
  const backup = await create(auth); const data = await manifest(auth, backup.id);
  Object.assign(data.pages[0].metadata, { icon: '👩🏽‍💻' });
  expect(() => validateManifest(data as BackupManifest)).not.toThrow();
  expect(data.version).toBe(1);
});

it('ICON-04：備份與 ZIP 保留筆記、日記、垃圾桶圖示，還原與回復備份保留各自圖示', async () => {
  const auth = await authenticated(); const page = await auth.note('圖示筆記'); const empty = await auth.note('無圖示');
  const journal = await auth.today(); const trash = await auth.note('垃圾桶圖示');
  for (const [id, icon] of [[page.id, '📝'], [journal.id, '🌤️'], [trash.id, '🗑️']]) {
    await env.DB.prepare('UPDATE pages SET icon = ? WHERE id = ?').bind(icon, id).run();
  }
  expect((await auth.post(`/api/pages/${trash.id}/delete`, {})).status).toBe(200);
  const backup = await create(auth); const data = await manifest(auth, backup.id);
  expect(new Map(data.pages.map(item => [item.metadata.id, item.metadata.icon]))).toEqual(new Map([[page.id, '📝'], [empty.id, null], [journal.id, '🌤️'], [trash.id, '🗑️']]));
  const response = await request(auth, `/api/backups/${backup.id}/export`); expect(response.status).toBe(200);
  const zip = new ZipReader(new Uint8ArrayReader(new Uint8Array(await response.arrayBuffer())), { useWebWorkers: false });
  const entry = (await zip.getEntries()).find(file => file.filename === 'manifest.json');
  expect(entry?.directory).toBe(false);
  if (!entry || entry.directory) throw new Error('備份缺少清單');
  const exported = JSON.parse(new TextDecoder().decode(await entry.getData(new Uint8ArrayWriter()))) as BackupManifest;
  await zip.close(); expect(exported.pages.map(item => item.metadata)).toEqual(data.pages.map(item => item.metadata));
  await env.DB.prepare('UPDATE pages SET icon = ? WHERE id = ?').bind('🚀', page.id).run();
  const restored = await request(auth, `/api/backups/${backup.id}/restore`, env, 'POST'); expect(restored.status).toBe(200);
  expect(await env.DB.prepare('SELECT icon FROM pages WHERE id = ?').bind(page.id).first('icon')).toBe('📝');
  expect(await env.DB.prepare('SELECT icon FROM pages WHERE id = ?').bind(journal.id).first('icon')).toBe('🌤️');
  const result = await restored.json<{ rollback: string }>();
  expect((await manifest(auth, result.rollback)).pages.find(item => item.metadata.id === page.id)!.metadata.icon).toBe('🚀');
  expect((await auth.post(`/api/pages/${trash.id}/restore`, {})).status).toBe(200);
  expect((await (await auth.get(`/api/pages/${trash.id}`)).json<{ icon: string }>()).icon).toBe('🗑️');
}, 30000);

it('ICON-04：舊備份缺少 icon 時可還原成 null', async () => {
  const auth = await authenticated(); const page = await auth.note('舊備份圖示'); const backup = await create(auth);
  const response = await rewrite(auth, backup.id, data => { for (const item of data.pages) delete (item.metadata as Partial<typeof item.metadata>).icon; });
  expect(response.status).toBe(200);
  await env.DB.prepare('UPDATE pages SET icon = ? WHERE id = ?').bind('🔖', page.id).run();
  expect((await request(auth, `/api/backups/${backup.id}/restore`, env, 'POST')).status).toBe(200);
  expect(await env.DB.prepare('SELECT icon FROM pages WHERE id = ?').bind(page.id).first('icon')).toBeNull();
}, 30000);

it('ICON-04：校驗正確但 icon 無效的備份拒絕下載與還原，且不暫停或覆蓋現況', async () => {
  const auth = await authenticated(); const page = await auth.note('不可覆蓋現況'); const backup = await create(auth);
  await env.DB.prepare('UPDATE pages SET icon = ? WHERE id = ?').bind('🔒', page.id).run();
  for (const icon of ['', 'not-an-emoji', '<svg>', '🙂🙂', 42, {}]) {
    expect((await rewrite(auth, backup.id, data => { Object.assign(data.pages[0].metadata, { icon }); })).status).toBe(503);
    expect((await request(auth, `/api/backups/${backup.id}/export`)).status).toBe(503);
    expect((await request(auth, `/api/backups/${backup.id}/restore`, env, 'POST')).status).toBe(503);
    expect((await auth.get(`/api/pages/${page.id}`)).status).toBe(200);
    expect(await env.DB.prepare('SELECT icon FROM pages WHERE id = ?').bind(page.id).first('icon')).toBe('🔒');
    expect(await env.DB.prepare('SELECT count(*) AS n FROM restore_operations').first('n')).toBe(0);
  }
}, 30000);

it('ICON-04：資料庫中無效 icon 不發布成功備份，原成功備份仍可讀取', async () => {
  const auth = await authenticated(); const page = await auth.note('建立前校驗'); const backup = await create(auth);
  await env.DB.prepare('UPDATE pages SET icon = ? WHERE id = ?').bind('invalid-icon', page.id).run();
  expect((await request(auth, '/api/backups', env, 'POST')).status).toBe(503);
  const catalog = await (await request(auth, '/api/backups')).json<{ latest: string }>(); expect(catalog.latest).toBe(backup.id);
  expect((await request(auth, `/api/backups/${backup.id}/manifest`)).status).toBe(200);
}, 30000);
