import { env, exports } from 'cloudflare:workers';
import { abortAllDurableObjects, reset, runInDurableObject } from 'cloudflare:test';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import app, { handle } from '../../src/worker/app';
import { cleanupBackups } from '../../src/worker/backups';
import { authenticated, commit, connect, origin } from './helpers';
import { images } from '../fixtures/images';
import type { PageRow } from '../../src/shared/pages';

type Auth = Awaited<ReturnType<typeof authenticated>>;
type File = { path: string; byte_size: number; checksum: string };
type Manifest = { format: string; version: number; id: string; owner: { id: string }; started_at: number; completed_at: number;
  pages: { metadata: PageRow; checkpoint: number; captured_at: number; file: File }[];
  assets: { metadata: { id: string; checksum: string; object_key: string }; file: File }[] };
type Catalog = { id: string; status: string; started_at: number; completed_at: number | null; error: string | null };
const sockets: WebSocket[] = [];
const hash = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
beforeEach(async () => { await exports.default.fetch(origin + '/health'); await exports.default.fetch(origin + '/__test/reset', { method: 'POST' }); });
afterEach(async () => { vi.restoreAllMocks(); sockets.splice(0).forEach(socket => socket.close()); await reset(); });
function request(auth: Auth, path: string, configured = env, method = 'GET', now = auth.now) {
  return handle(new Request(origin + path, { method, headers: { Origin: origin, Cookie: auth.cookie, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }, ...(method === 'POST' ? { body: '{}' } : {}) }), configured, { now: () => now, sendMail: async () => {} });
}
async function create(auth: Auth, now = auth.now) {
  await auth.post('/__test/control', { now });
  const response = await request(auth, '/api/backups', env, 'POST', now); expect(response.status).toBe(201);
  const backup = await response.json<Catalog>(); expect(backup.status).toBe('success'); return backup;
}
async function manifest(auth: Auth, id: string, now = auth.now) {
  const response = await request(auth, `/api/backups/${id}/manifest`, env, 'GET', now); expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store'); return response.json<Manifest>();
}
async function fixture() {
  const auth = await authenticated(); const root = await auth.note('中文上層');
  const child = await auth.result(auth.post('/api/pages', { title: '子頁', parent_id: root.id }));
  const journal = await auth.today(); const trash = await auth.note('垃圾桶正文');
  const response = await exports.default.fetch(origin + '/api/assets', { method: 'POST', headers: { Origin: origin, Cookie: auth.cookie, 'Content-Type': 'image/png', 'X-File-Name': encodeURIComponent('原圖.png') }, body: images.png });
  expect(response.status).toBe(201); const asset = await response.json<{ id: string; url: string; checksum: string }>();
  const documents = new Map<string, Uint8Array>(); const clients = [];
  for (const page of [root, child, journal, trash]) {
    const client = await connect(page, auth.cookie); sockets.push(client.socket); clients.push(client);
    const doc = new Y.Doc(); const block = new Y.XmlElement('paragraph'); const text = new Y.XmlText(); text.insert(0, page.title + '雲端正文'); block.insert(0, [text]); doc.getXmlFragment('body').insert(0, [block]);
    if (page.id === root.id) { const image = new Y.XmlElement('image'); image.setAttribute('url', asset.url); doc.getXmlFragment('body').insert(1, [image]); }
    expect((await commit(client, doc, 'backup-fixture')).type).toBe('persisted'); documents.set(page.id, Y.encodeStateAsUpdate(doc)); doc.destroy();
  }
  expect((await auth.post(`/api/pages/${trash.id}/delete`, {})).status).toBe(200);
  const metadata = (await env.DB.prepare('SELECT * FROM pages WHERE owner_id = ? ORDER BY id').bind(root.owner_id).all<PageRow>()).results;
  return { auth, root, child, journal, trash, asset, documents, metadata, clients };
}

it('BACKUP-CATALOG-01：成功清單包含固定階層／日期／垃圾桶、持久正文與所有原圖副本，不包含憑證', async () => {
  const f = await fixture(); const backup = await create(f.auth); const data = await manifest(f.auth, backup.id);
  expect(data).toMatchObject({ format: 'p-note-backup', version: 1, id: backup.id, owner: { id: f.root.owner_id }, started_at: f.auth.now, completed_at: f.auth.now });
  expect(data.pages.map(item => item.metadata).sort((a, b) => a.id.localeCompare(b.id))).toEqual(f.metadata);
  for (const page of data.pages) {
    const file = await env.BACKUPS.get(`${f.root.owner_id}/${backup.id}/${page.file.path}`); expect(file).not.toBeNull();
    const bytes = new Uint8Array(await file!.arrayBuffer()); expect(bytes).toEqual(f.documents.get(page.metadata.id));
    expect(page.file).toMatchObject({ byte_size: bytes.length, checksum: await hash(bytes) });
    expect(page.checkpoint).toBeGreaterThan(0); expect(page.captured_at).toBe(f.auth.now);
  }
  expect(data.assets).toHaveLength(1); expect(data.assets[0].metadata.id).toBe(f.asset.id);
  const original = await env.BACKUPS.get(`${f.root.owner_id}/${backup.id}/${data.assets[0].file.path}`);
  expect(new Uint8Array(await original!.arrayBuffer())).toEqual(images.png);
  expect(data.assets[0].file.checksum).toBe(f.asset.checksum);
  expect(JSON.stringify(data)).not.toMatch(/BETTER_AUTH_SECRET|test-only-secret|session|verification|accessToken|refreshToken/);
  const list = await (await request(f.auth, '/api/backups')).json<{ backups: Catalog[]; latest: string }>();
  expect(list.latest).toBe(backup.id); expect(list.backups).toHaveLength(1);
}, 20000);

it('BACKUP-03：正文／原圖讀取、校驗或副本寫入失敗不建立成功清單，最新成功不變', async () => {
  const f = await fixture(); const successful = await create(f.auth);
  const failures = ['document', 'image', 'checksum', 'copy', 'copy-checksum', 'manifest'];
  for (const failure of failures) {
    let configured = env;
    if (failure === 'document') await runInDurableObject(f.clients[0].stub, (_instance, state) => { state.storage.sql.exec('UPDATE updates SET payload = ?', new Uint8Array([255, 255, 255])); });
    if (failure === 'image') vi.spyOn(env.ASSETS, 'get').mockResolvedValueOnce(null);
    if (failure === 'checksum') await env.DB.prepare('UPDATE assets SET checksum = ? WHERE id = ?').bind('0'.repeat(64), f.asset.id).run();
    if (['copy', 'copy-checksum', 'manifest'].includes(failure)) configured = { ...env, BACKUPS: new Proxy(env.BACKUPS, { get(target, property) {
      if (property === 'put') return async (...args: Parameters<R2Bucket['put']>) => {
        if (failure === 'copy' || String(args[0]).endsWith('/manifest.json')) throw new Error('測試備份寫入失敗');
        if (failure === 'copy-checksum') return target.put(args[0], new Uint8Array([1, 2, 3]));
        return Reflect.apply(target.put, target, args);
      };
      const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
    } }) };
    const response = await request(f.auth, '/api/backups', configured, 'POST'); expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/object_key|secret|測試/);
    const list = await (await request(f.auth, '/api/backups')).json<{ backups: Catalog[]; latest: string }>();
    expect(list.latest).toBe(successful.id); expect(list.backups.filter(item => item.status === 'success')).toHaveLength(1);
    expect(list.backups.filter(item => item.status === 'failed')).toHaveLength(failures.indexOf(failure) + 1);
    for (const item of list.backups.filter(item => item.status === 'failed')) expect((await request(f.auth, `/api/backups/${item.id}/manifest`)).status).toBe(404);
    vi.restoreAllMocks(); await env.DB.prepare('UPDATE assets SET checksum = ? WHERE id = ?').bind(f.asset.checksum, f.asset.id).run();
    if (failure === 'document') await runInDurableObject(f.clients[0].stub, (_instance, state) => { state.storage.sql.exec('UPDATE updates SET payload = ?', f.documents.get(f.root.id)!); });
  }
  expect((await manifest(f.auth, successful.id)).id).toBe(successful.id);
}, 20000);

it('BACKUP-04：已擷取頁面在發布前切世代時拒絕整份備份，不發布混合世代', async () => {
  const f = await fixture(); const successful = await create(f.auth);
  const configured = { ...env, BACKUPS: new Proxy(env.BACKUPS, { get(target, property) {
    if (property === 'put') return async (...args: Parameters<R2Bucket['put']>) => {
      const result = await Reflect.apply(target.put, target, args);
      if (String(args[0]).endsWith(`/pages/${f.root.id}.yjs`)) await env.DB.prepare('UPDATE pages SET sync_generation = ? WHERE id = ?').bind('changed-after-capture', f.root.id).run();
      return result;
    };
    const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
  } }) };
  const failed = await request(f.auth, '/api/backups', configured, 'POST'); expect(failed.status).toBe(503);
  expect(await env.DB.prepare('SELECT sync_generation FROM pages WHERE id = ?').bind(f.root.id).first('sync_generation')).toBe('changed-after-capture');
  const list = await (await request(f.auth, '/api/backups')).json<{ backups: Catalog[]; latest: string }>();
  expect(list.latest).toBe(successful.id); expect(list.backups.filter(item => item.status === 'success')).toHaveLength(1);
  expect(list.backups.filter(item => item.status === 'failed')).toHaveLength(1);
  expect((await manifest(f.auth, successful.id)).pages.find(item => item.metadata.id === f.root.id)!.metadata.sync_generation).toBe(f.root.sync_generation);
}, 20000);

it('BACKUP-CATALOG-02：已知備份 ID 仍驗證登入、所有權與 manifest 校驗', async () => {
  const f = await fixture(); const backup = await create(f.auth);
  expect((await handle(new Request(origin + `/api/backups/${backup.id}/manifest`), env)).status).toBe(401);
  expect((await request(f.auth, `/api/backups/${backup.id}/manifest`, env, 'POST')).status).toBe(404);
  const saved = await env.BACKUPS.get(`${f.root.owner_id}/${backup.id}/manifest.json`); expect(saved).not.toBeNull();
  await env.BACKUPS.put(`${f.root.owner_id}/${backup.id}/manifest.json`, '{}');
  expect((await request(f.auth, `/api/backups/${backup.id}/manifest`)).status).toBe(503);
  await env.BACKUPS.put(`${f.root.owner_id}/${backup.id}/manifest.json`, await saved!.arrayBuffer());
  const date = new Date().toISOString();
  await env.DB.prepare("INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('foreign-owner', '其他人', 'other@example.test', 1, ?, ?)").bind(date, date).run();
  await env.DB.prepare('UPDATE backups SET owner_id = ? WHERE id = ?').bind('foreign-owner', backup.id).run();
  expect((await request(f.auth, `/api/backups/${backup.id}/manifest`)).status).toBe(404);
  expect((await request(f.auth, '/api/backups/nonexistent/manifest')).status).toBe(404);
}, 20000);

it('BACKUP-02：每日排程的清理覆蓋 90 天前一刻／邊界／之後，共享圖片副本與原檔保留', async () => {
  const f = await fixture(); let now = f.auth.now;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const first = await create(f.auth, now); const firstManifest = await manifest(f.auth, first.id, now);
  now += 86400000; await f.auth.post('/__test/control', { now }); const second = await create(f.auth, now);
  const secondManifest = await manifest(f.auth, second.id, now);
  for (const delta of [-1, 0, 1]) {
    now = f.auth.now + 90 * 86400000 + delta;
    await f.auth.post('/__test/control', { now });
    await app.scheduled({ cron: '0 19 * * *', scheduledTime: now, noRetry() {} }, env);
    const expired = await request(f.auth, `/api/backups/${first.id}/manifest`, env, 'GET', now);
    // 排程用持久帳號；下載 API 的舊 session 到期後必須重新登入。
    expect(expired.status).toBe(401);
    const rows = (await env.DB.prepare('SELECT * FROM backups').all<Catalog>()).results;
    expect(rows.some(row => row.id === first.id)).toBe(delta < 0);
    const firstCopy = await env.BACKUPS.get(`${f.root.owner_id}/${first.id}/${firstManifest.assets[0].file.path}`);
    expect(firstCopy !== null).toBe(delta < 0);
    const secondCopy = await env.BACKUPS.get(`${f.root.owner_id}/${second.id}/${secondManifest.assets[0].file.path}`);
    expect(new Uint8Array(await secondCopy!.arrayBuffer())).toEqual(images.png);
    const live = await env.ASSETS.get(secondManifest.assets[0].metadata.object_key); expect(new Uint8Array(await live!.arrayBuffer())).toEqual(images.png);
  }
}, 30000);

it('BACKUP-PUBLISH-01：清單寫入後、原子發布前換世代仍須失敗，不能只在最後 R2 寫入前檢查', async () => {
  const f = await fixture(); const successful = await create(f.auth);
  const configured = { ...env, BACKUPS: new Proxy(env.BACKUPS, { get(target, property) {
    if (property === 'put') return async (...args: Parameters<R2Bucket['put']>) => {
      const result = await Reflect.apply(target.put, target, args);
      if (String(args[0]).endsWith('/manifest.json')) await env.DB.prepare('UPDATE pages SET sync_generation = ? WHERE id = ?').bind('changed-before-publish', f.root.id).run();
      return result;
    };
    const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
  } }) };
  const failed = await request(f.auth, '/api/backups', configured, 'POST'); expect(failed.status).toBe(503);
  expect(await env.DB.prepare('SELECT sync_generation FROM pages WHERE id = ?').bind(f.root.id).first('sync_generation')).toBe('changed-before-publish');
  const list = await (await request(f.auth, '/api/backups')).json<{ latest: string; backups: Catalog[] }>();
  expect(list.latest).toBe(successful.id); expect(list.backups.filter(row => row.status === 'success')).toHaveLength(1);
}, 20000);

it('BACKUP-PUBLISH-02：保留期從所有副本與清單校驗完成後的成功時間開始', async () => {
  const f = await fixture(); let now = f.auth.now;
  const configured = { ...env, BACKUPS: new Proxy(env.BACKUPS, { get(target, property) {
    if (property === 'put') return async (...args: Parameters<R2Bucket['put']>) => {
      const result = await Reflect.apply(target.put, target, args);
      if (String(args[0]).endsWith('/manifest.json')) now += 1000;
      return result;
    };
    const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
  } }) };
  const response = await handle(new Request(origin + '/api/backups', { method: 'POST', headers: { Origin: origin, Cookie: f.auth.cookie }, body: '{}' }), configured, { now: () => now, sendMail: async () => {} });
  expect(response.status).toBe(201); const backup = await response.json<Catalog>();
  expect(backup.completed_at).toBe(f.auth.now + 1000);
  expect((await manifest(f.auth, backup.id, now)).completed_at).toBe(backup.completed_at);
  await cleanupBackups(env, f.auth.now + 90 * 86400000);
  expect(await env.DB.prepare('SELECT status FROM backups WHERE id = ?').bind(backup.id).first('status')).toBe('success');
}, 20000);

it('BACKUP-CLEANUP-01：清理中斷留下 expiring 意圖，拒絕讀取半套備份且可重試完成', async () => {
  const f = await fixture(); const first = await create(f.auth); const data = await manifest(f.auth, first.id);
  const second = await create(f.auth, f.auth.now + 86400000);
  vi.spyOn(env.BACKUPS, 'delete').mockRejectedValueOnce(new Error('測試清理中斷'));
  await expect(cleanupBackups(env, f.auth.now + 90 * 86400000)).rejects.toThrow('測試清理中斷');
  expect(await env.DB.prepare('SELECT status FROM backups WHERE id = ?').bind(first.id).first('status')).toBe('expiring');
  expect((await request(f.auth, `/api/backups/${first.id}/manifest`)).status).toBe(404);
  vi.restoreAllMocks(); await abortAllDurableObjects(); await cleanupBackups(env, f.auth.now + 90 * 86400000);
  expect(await env.DB.prepare('SELECT id FROM backups WHERE id = ?').bind(first.id).first('id')).toBeNull();
  expect(await env.BACKUPS.get(`${f.root.owner_id}/${first.id}/${data.assets[0].file.path}`)).toBeNull();
  expect((await manifest(f.auth, second.id)).assets[0].metadata.id).toBe(f.asset.id);
  expect(await env.ASSETS.get(data.assets[0].metadata.object_key)).not.toBeNull();
}, 20000);

it('BACKUP-05：完整清單記錄逐篇擷取時間窗與檢查點，不包含未送達雲端的離線更新', async () => {
  const f = await fixture(); let now = f.auth.now;
  const offline = new Y.Doc(); Y.applyUpdate(offline, f.documents.get(f.root.id)!);
  const local = new Y.XmlText(); local.insert(0, '僅在離線裝置的修改'); offline.getXmlFragment('body').insert(0, [local]);
  const configured = { ...env, BACKUPS: new Proxy(env.BACKUPS, { get(target, property) {
    if (property === 'put') return async (...args: Parameters<R2Bucket['put']>) => {
      const result = await Reflect.apply(target.put, target, args);
      if (/\/pages\/[^/]+\.yjs$/.test(String(args[0]))) { now += 1000; await env.DB.prepare('UPDATE test_control SET now = ? WHERE id = 1').bind(now).run(); }
      return result;
    };
    const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
  } }) };
  const response = await handle(new Request(origin + '/api/backups', { method: 'POST', headers: { Origin: origin, Cookie: f.auth.cookie }, body: '{}' }), configured, { now: () => now, sendMail: async () => {} });
  expect(response.status).toBe(201); const backup = await response.json<Catalog>();
  const data = await (await request(f.auth, `/api/backups/${backup.id}/manifest`, env, 'GET', now)).json<Manifest & { captured_until: number }>();
  expect(data.started_at).toBe(f.auth.now); expect(data.captured_until).toBe(f.auth.now + 4000); expect(data.completed_at).toBe(now);
  expect(data.pages.map(page => page.captured_at)).toEqual([0, 1, 2, 3].map(index => f.auth.now + index * 1000));
  expect(data.pages.every(page => page.checkpoint === 1)).toBe(true);
  const file = data.pages.find(page => page.metadata.id === f.root.id)!.file;
  const object = await env.BACKUPS.get(`${f.root.owner_id}/${backup.id}/${file.path}`);
  const bytes = new Uint8Array(await object!.arrayBuffer()); expect(bytes).toEqual(f.documents.get(f.root.id));
  const recovered = new Y.Doc(); Y.applyUpdate(recovered, bytes); expect(recovered.getXmlFragment('body').toString()).not.toContain('僅在離線裝置');
  expect(offline.getXmlFragment('body').toString()).toContain('僅在離線裝置'); offline.destroy(); recovered.destroy();
}, 20000);

it('ASSET-05：移除正文引用後，成功備份清理只刪到期副本，保留其他備份副本與活躍原檔', async () => {
  const f = await fixture(); const before = await create(f.auth); const first = await manifest(f.auth, before.id);
  const doc = new Y.Doc(); Y.applyUpdate(doc, f.documents.get(f.root.id)!); doc.getXmlFragment('body').delete(1, 1);
  expect((await commit(f.clients[0], doc, 'removed-image-reference')).type).toBe('persisted');
  expect(doc.getXmlFragment('body').toString()).not.toContain(f.asset.url); doc.destroy();
  const after = await create(f.auth, f.auth.now + 86400000); const second = await manifest(f.auth, after.id);
  await cleanupBackups(env, f.auth.now + 90 * 86400000);
  expect(await env.BACKUPS.get(`${f.root.owner_id}/${before.id}/${first.assets[0].file.path}`)).toBeNull();
  const retained = await env.BACKUPS.get(`${f.root.owner_id}/${after.id}/${second.assets[0].file.path}`);
  expect(await hash(new Uint8Array(await retained!.arrayBuffer()))).toBe(f.asset.checksum);
  const live = await env.ASSETS.get(second.assets[0].metadata.object_key);
  expect(await hash(new Uint8Array(await live!.arrayBuffer()))).toBe(f.asset.checksum);
  expect((await manifest(f.auth, after.id)).assets[0].metadata.id).toBe(f.asset.id);
}, 20000);
