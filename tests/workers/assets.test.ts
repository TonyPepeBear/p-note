import { env, exports } from 'cloudflare:workers';
import { reset, abortAllDurableObjects, runInDurableObject } from 'cloudflare:test';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { handle } from '../../src/worker/app';
import { handleAssets } from '../../src/worker/assets';
import { images } from '../fixtures/images';
import { animatedImages } from '../fixtures/animated-images';
import * as Y from 'yjs';
import { toBase64 } from 'lib0/buffer';
import type { AssetList } from '../../src/shared/assets';

const origin = 'http://127.0.0.1:5173';
let cookie: string;
const sockets: WebSocket[] = [];
const app = (path: string, init?: RequestInit) => exports.default.fetch(origin + path, init);
const post = (path: string, data: object) => app(path, { method: 'POST', headers: { Origin: origin, Cookie: cookie ?? '', 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
const get = (path: string, auth = cookie) => app(path, { headers: { Cookie: auth } });
const uploadRequest = (bytes: Uint8Array = images.png, mime = 'image/png', name = '中文圖片.png') => new Request(origin + '/api/assets', { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': mime, 'X-File-Name': encodeURIComponent(name) }, body: bytes });
type Asset = { id: string; url: string; checksum: string; byte_size: number; mime_type: string };
async function upload(bytes: Uint8Array = images.png, mime = 'image/png', name?: string): Promise<Asset> {
  const response = await app('/api/assets', uploadRequest(bytes, mime, name));
  expect(response.status).toBe(201); return response.json<Asset>();
}
async function hash(bytes: ArrayBuffer | Uint8Array) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join(''); }
beforeEach(async () => {
  await app('/health'); await post('/__test/control', { now: Date.now() + 86400000 });
  await post('/api/login', { email: 'owner@example.test' });
  const mails = await (await app('/__test/mailbox')).json<{ url: string }[]>();
  const confirmed = await post('/api/confirm', { token: new URL(mails.at(-1)!.url).searchParams.get('token') });
  expect(confirmed.status).toBe(200); cookie = confirmed.headers.get('set-cookie')!.split(';')[0];
});
afterEach(async () => { vi.restoreAllMocks(); sockets.splice(0).forEach(socket => socket.close()); await reset(); });

it('ASSET-01：已知 ID 仍要求登入／所有權，拒絕偽造來源與撤銷 session', async () => {
  const asset = await upload();
  expect((await get(asset.url, '')).status).toBe(401);
  expect((await app('/api/assets', new Request(uploadRequest(), { headers: { Origin: origin, 'Content-Type': 'image/png' } }))).status).toBe(401);
  expect((await app(asset.url, { headers: { Cookie: cookie, Origin: 'https://evil.example' } })).status).toBe(403);
  const response = await get(asset.url);
  expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(images.png);
  const date = new Date().toISOString();
  await env.DB.prepare("INSERT INTO user VALUES ('other', '其他人', 'other@example.test', 1, NULL, ?, ?)").bind(date, date).run();
  await env.DB.prepare('UPDATE assets SET owner_id = ? WHERE id = ?').bind('other', asset.id).run();
  const denied = await get(asset.url + '?owner_id=other'); expect(denied.status).toBe(404);
  expect(await denied.text()).not.toContain(asset.checksum);
  await post('/api/logout', {}); expect((await get(asset.url)).status).toBe(401);
});

it('ASSET-02：串流中斷／R2 寫入／D1 索引失敗不回傳正式引用，可重試', async () => {
  const now = Date.now(); const services = { now: () => now, sendMail: async () => {} };
  const broken = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(images.png.subarray(0, 20)); controller.error(new Error('測試上傳中斷')); } });
  const interrupted = new Request(uploadRequest(), { body: broken });
  expect((await handle(interrupted, env, services)).status).toBe(400);
  const put = vi.spyOn(env.ASSETS, 'put').mockRejectedValueOnce(new Error('測試 R2 寫入故障'));
  const failed = await handle(uploadRequest(), env, services); expect(failed.status).toBe(503);
  expect(await failed.text()).not.toMatch(/object_key|checksum|url/);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM assets').first('n')).toBe(0);
  put.mockRestore();
  const prepare = env.DB.prepare.bind(env.DB);
  vi.spyOn(env.DB, 'prepare').mockImplementation(sql => {
    if (sql.startsWith('INSERT INTO assets')) throw new Error('測試 D1 索引故障');
    return prepare(sql);
  });
  expect((await handle(uploadRequest(), env, services)).status).toBe(503);
  vi.restoreAllMocks();
  expect(await env.DB.prepare('SELECT count(*) AS n FROM assets').first('n')).toBe(0);
  const asset = await upload(); expect((await get(asset.url)).status).toBe(200);
});

function sizedPng(size: number): Uint8Array {
  const extra = size - images.png.length; const data = new Uint8Array(size);
  data.set(images.png.subarray(0, -12)); const offset = images.png.length - 12;
  const view = new DataView(data.buffer); view.setUint32(offset, extra - 12);
  data.set([116, 69, 88, 116], offset + 4);
  let crc = 0xffffffff;
  for (const n of data.subarray(offset + 4, size - 16)) { crc ^= n; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  view.setUint32(size - 16, (crc ^ 0xffffffff) >>> 0); data.set(images.png.subarray(-12), size - 12);
  return data;
}
it('ASSET-03：四種原檔、10 MiB 邊界；偽造 MIME／內容／截斷／SVG／HEIC 被拒絕', async () => {
  for (const [format, bytes] of [...Object.entries(images), ...Object.entries(animatedImages)]) {
    const asset = await upload(bytes, 'image/' + format, '原圖.' + format);
    expect(asset.checksum).toBe(await hash(bytes)); expect(asset.byte_size).toBe(bytes.length);
    expect(new Uint8Array(await (await get(asset.url)).arrayBuffer())).toEqual(bytes);
  }
  const limit = 10 * 1024 * 1024;
  for (const size of [limit - 1, limit]) expect((await upload(sizedPng(size))).byte_size).toBe(size);
  const before = await env.DB.prepare('SELECT count(*) AS n FROM assets').first('n');
  const corrupted = images.png.slice(); corrupted[40] ^= 1;
  const invalid: [Uint8Array, string][] = [
    [sizedPng(limit + 1), 'image/png'], [new Uint8Array(), 'image/png'],
    [images.png, 'image/jpeg'], [new TextEncoder().encode('<svg><script>alert(1)</script></svg>'), 'image/png'],
    [new TextEncoder().encode('0000ftypheic'), 'image/heic'], [corrupted, 'image/png'],
    ...[...Object.entries(images), ...Object.entries(animatedImages)].map(([format, bytes]): [Uint8Array, string] => [bytes.subarray(0, bytes.length - 8), 'image/' + format]),
    [new Uint8Array([0x89,80,78,71,13,10,26,10]), 'image/png'],
  ];
  for (const [bytes, mime] of invalid) {
    const response = await app('/api/assets', uploadRequest(bytes, mime, '偽造.png'));
    expect([400, 413, 415]).toContain(response.status); expect(await response.text()).toMatch(/10 MiB|格式|圖片|完整/);
  }
  expect(await env.DB.prepare('SELECT count(*) AS n FROM assets').first('n')).toBe(before);
});

it('ASSET-04：垃圾桶／還原與移除引用保留相同原檔及穩定 ID', async () => {
  const page = await (await post('/api/pages', { title: '圖片頁' })).json<{ id: string }>(); const asset = await upload();
  expect((await post(`/api/pages/${page.id}/delete`, {})).status).toBe(200);
  await abortAllDurableObjects();
  expect((await get(asset.url)).status).toBe(200);
  expect((await post(`/api/pages/${page.id}/restore`, {})).status).toBe(200);
  expect(await hash(await (await get(asset.url)).arrayBuffer())).toBe(asset.checksum);
  expect((await app(asset.url, { method: 'DELETE', headers: { Cookie: cookie, Origin: origin } })).status).toBe(404);
  expect(await hash(await (await get(asset.url)).arrayBuffer())).toBe(asset.checksum);
});

it('ASSET-06：列表僅列自己的全部圖片，忽略偽造 owner 且不提供儲存／公開資訊', async () => {
  const own = await upload(images.png, 'image/png', '尚未引用的中文原圖.png');
  const other = await upload(images.jpeg, 'image/jpeg', '其他人的原圖.jpeg');
  const date = new Date().toISOString();
  await env.DB.prepare("INSERT INTO user VALUES ('other', '其他人', 'other@example.test', 1, NULL, ?, ?)").bind(date, date).run();
  await env.DB.prepare('UPDATE assets SET owner_id = ? WHERE id = ?').bind('other', other.id).run();
  expect((await get('/api/assets', '')).status).toBe(401);
  expect((await app('/api/assets', { headers: { Cookie: cookie, Origin: 'https://evil.example' } })).status).toBe(403);
  expect((await app('/api/assets', { headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
  expect((await app('/api/assets', { headers: { Cookie: cookie, Authorization: 'Bearer fixture' } })).status).toBe(401);
  const objectRead = vi.spyOn(env.ASSETS, 'get').mockRejectedValue(new Error('列表不可讀取 R2 原檔'));
  const objectList = vi.spyOn(env.ASSETS, 'list').mockRejectedValue(new Error('列表不可掃描 R2'));
  const response = await handle(new Request(origin + '/api/assets?owner_id=other', { headers: { Cookie: cookie } }), env, { now: Date.now, sendMail: async () => {} });
  expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
  const result = await response.json<AssetList>();
  expect(result).toEqual({ items: [{ id: own.id, url: own.url, original_name: '尚未引用的中文原圖.png', mime_type: 'image/png', byte_size: images.png.length, created_at: expect.any(Number) }], page: 1, page_size: 20, total: 1, total_pages: 1 });
  expect(JSON.stringify(result)).not.toMatch(/object_key|owner_id|checksum|https?:\/\//);
  expect(objectRead).not.toHaveBeenCalled(); expect(objectList).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  expect((await get(result.items[0].url)).status).toBe(200);
  expect((await get(other.url + '?owner_id=other')).status).toBe(404);
  expect((await app(own.url, { method: 'DELETE', headers: { Cookie: cookie, Origin: origin } })).status).toBe(404);
  await post('/api/logout', {}); expect((await get('/api/assets')).status).toBe(401);
});

it('ASSET-07：上傳時間與同時 ID 穩定排序，分頁完整且拒絕無效或溢位參數', async () => {
  const session = await (await get('/api/session')).json<{ user: { id: string } }>();
  const rows = Array.from({ length: 45 }, (_, index) => ({ id: `image-${String(index).padStart(2, '0')}`, created_at: 1000 + Math.floor((44 - index) / 2) }));
  const expected = [...rows].sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id));
  await env.DB.batch(rows.map(row => env.DB.prepare('INSERT INTO assets (id, owner_id, object_key, original_name, mime_type, byte_size, checksum, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(row.id, session.user.id, `${session.user.id}/${row.id}`, `${row.id}.png`, 'image/png', images.png.length, 'fixture-checksum', row.created_at)));
  const seen: string[] = [];
  for (const page of [1, 2, 3, 4]) {
    const response = await get(page === 1 ? '/api/assets' : `/api/assets?page=${page}`);
    expect(response.status).toBe(200); const result = await response.json<AssetList>();
    expect(result).toMatchObject({ page, page_size: 20, total: 45, total_pages: 3 });
    expect(result.items.map(item => ({ id: item.id, created_at: item.created_at }))).toEqual(expected.slice((page - 1) * 20, page * 20));
    seen.push(...result.items.map(item => item.id));
  }
  expect(seen).toEqual(expected.map(row => row.id)); expect(new Set(seen).size).toBe(45);
  const small = await (await get('/api/assets?page=2&page_size=2')).json<AssetList>();
  expect(small).toMatchObject({ page: 2, page_size: 2, total: 45, total_pages: 23 });
  expect(small.items.map(item => item.id)).toEqual(['image-01', 'image-04']);
  const maximum = await (await get('/api/assets?page_size=100')).json<AssetList>();
  expect(maximum.items).toHaveLength(45); expect(maximum.page_size).toBe(100);
  for (const query of [
    'page=', 'page=0', 'page=-1', 'page=1.5', 'page=abc', 'page=01', 'page=1e2', 'page=%201', 'page=1&page=2',
    'page=9007199254740992', 'page=9007199254740991&page_size=20',
    'page_size=', 'page_size=0', 'page_size=-1', 'page_size=1.5', 'page_size=abc', 'page_size=101', 'page_size=20&page_size=10',
  ]) {
    const response = await get('/api/assets?' + query);
    expect(response.status, query).toBe(400); expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).toMatch(/分頁|每頁/);
  }
  const safeLast = await (await get('/api/assets?page=9007199254740991&page_size=1')).json<AssetList>();
  expect(safeLast.items).toEqual([]); expect(safeLast.page).toBe(Number.MAX_SAFE_INTEGER);
});

it('ASSET-09：空集合保留分頁資訊，D1 暫時故障後可重新取得列表', async () => {
  const empty = await get('/api/assets'); expect(empty.status).toBe(200);
  expect(await empty.json<AssetList>()).toEqual({ items: [], page: 1, page_size: 20, total: 0, total_pages: 0 });
  expect(await (await get('/api/assets?page=2')).json<AssetList>()).toEqual({ items: [], page: 2, page_size: 20, total: 0, total_pages: 0 });
  const asset = await upload();
  const session = await (await get('/api/session')).json<{ user: { id: string } }>();
  const batch = vi.spyOn(env.DB, 'batch').mockRejectedValue(new Error('測試 D1 列表故障'));
  const request = (path = '/api/assets') => new Request(origin + path, { headers: { Cookie: cookie } });
  const services = { now: Date.now, sendMail: async () => {} };
  expect((await handle(request('/api/session'), env, services)).status).toBe(200);
  await expect(handleAssets(request(), env, session.user.id, Date.now())).rejects.toThrow('測試 D1 列表故障');
  const failed = await handle(request(), env, services); expect(failed.status).toBe(503);
  expect(await failed.text()).not.toMatch(/object_key|owner_id|checksum|fixture/);
  batch.mockRestore();
  const recovered = await handleAssets(request(), env, session.user.id, Date.now());
  expect(recovered!.status).toBe(200);
  expect((await recovered!.json<AssetList>()).items.map(item => item.id)).toEqual([asset.id]);
  const retried = await handle(request(), env, services); expect(retried.status).toBe(200);
  expect((await retried.json<AssetList>()).items.map(item => item.id)).toEqual([asset.id]);
});

it('EDIT-03：真正 Yjs 持久引用重啟後仍為同一原檔，第二讀取不依賴短期 URL', async () => {
  const asset = await upload();
  const page = await (await get('/api/today')).json<{ id: string; room: string; sync_generation: string }>();
  const handshake = await app(`/parties/sync/${page.room}?page=${page.id}&generation=${page.sync_generation}`, { headers: { Cookie: cookie, Origin: origin, Upgrade: 'websocket' } });
  expect(handshake.status).toBe(101); const socket = handshake.webSocket!; socket.accept(); sockets.push(socket);
  let persisted = false; socket.addEventListener('message', event => { if (typeof event.data === 'string' && event.data.includes('persisted')) persisted = true; });
  const doc = new Y.Doc(); const image = new Y.XmlElement('image'); image.setAttribute('url', asset.url); doc.getXmlFragment('body').insert(0, [image]);
  socket.send('__YPS:' + JSON.stringify({ type: 'commit', id: 'image', update: toBase64(Y.encodeStateAsUpdate(doc)) }));
  await vi.waitFor(() => expect(persisted).toBe(true)); socket.close(); await abortAllDurableObjects();
  await runInDurableObject(env.SYNC.getByName(page.room), async (instance, state) => {
    await instance.onStart(); const stored = new Y.Doc();
    for (const row of state.storage.sql.exec<{ payload: ArrayBuffer }>('SELECT payload FROM updates ORDER BY checkpoint')) Y.applyUpdate(stored, new Uint8Array(row.payload));
    expect(stored.getXmlFragment('body').toString()).toContain(asset.url);
  });
  expect(await hash(await (await get(asset.url)).arrayBuffer())).toBe(asset.checksum);
});
