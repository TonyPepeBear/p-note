import { env, exports } from 'cloudflare:workers';
import * as Y from 'yjs';
import { expect } from 'vitest';
import { handle } from '../../src/worker/app';
import { authenticated, commit, connect, origin } from './helpers';
import { images } from '../fixtures/images';
import type { PageRow } from '../../src/shared/pages';
export type Auth = Awaited<ReturnType<typeof authenticated>>;
export type File = { path: string; byte_size: number; checksum: string };
export type Manifest = { format: string; version: number; id: string; owner: { id: string }; started_at: number; completed_at: number;
  pages: { metadata: PageRow; checkpoint: number; captured_at: number; file: File }[];
  assets: { metadata: { id: string; checksum: string; object_key: string }; file: File }[] };
export type Catalog = { id: string; status: string; started_at: number; completed_at: number | null; error: string | null };
export const hash = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
export function request(auth: Auth, path: string, configured = env, method = 'GET', now = auth.now) {
  return handle(new Request(origin + path, { method, headers: { Origin: origin, Cookie: auth.cookie, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }, ...(method === 'POST' ? { body: '{}' } : {}) }), configured, { now: () => now, sendMail: async () => {} });
}
export async function create(auth: Auth, now = auth.now) {
  await auth.post('/__test/control', { now });
  const response = await request(auth, '/api/backups', env, 'POST', now); expect(response.status).toBe(201);
  const backup = await response.json<Catalog>(); expect(backup.status).toBe('success'); return backup;
}
export async function manifest(auth: Auth, id: string, now = auth.now) {
  const response = await request(auth, `/api/backups/${id}/manifest`, env, 'GET', now); expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store'); return response.json<Manifest>();
}
export async function fixture(sockets: WebSocket[]) {
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

