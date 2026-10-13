import { env, exports } from 'cloudflare:workers';
import { expect, vi } from 'vitest';
import { runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { toBase64 } from 'lib0/buffer';
import type { PageInfo } from '../../src/shared/pages';

export const origin = 'http://127.0.0.1:5173';
export async function authenticated() {
  let cookie = '';
  const get = (path: string) => exports.default.fetch(origin + path, { headers: { Cookie: cookie } });
  const post = (path: string, data: object) => exports.default.fetch(origin + path, { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  await get('/health'); const now = Date.now() + 86400000; await post('/__test/control', { now });
  expect((await post('/api/login', { email: 'owner@example.test' })).status).toBe(200);
  const mails = await (await get('/__test/mailbox')).json<{ url: string }[]>();
  const confirmed = await post('/api/confirm', { token: new URL(mails.at(-1)!.url).searchParams.get('token') });
  expect(confirmed.status).toBe(200); cookie = confirmed.headers.get('set-cookie')!.split(';')[0];
  const result = async (response: Promise<Response>) => { const r = await response; expect(r.status).toBe(200); return r.json<PageInfo>(); };
  return { get, post, result, cookie, now, today: () => result(get('/api/today')), note: (title: string) => result(post('/api/pages', { title })) };
}
export async function connect(page: PageInfo, cookie: string) {
  const response = await exports.default.fetch(`${origin}/parties/sync/${page.room}?page=${page.id}&generation=${page.sync_generation}`, { headers: { Cookie: cookie, Origin: origin, Upgrade: 'websocket' } });
  expect(response.status).toBe(101); const socket = response.webSocket!; socket.binaryType = 'arraybuffer'; socket.accept();
  const messages: (string | ArrayBuffer)[] = []; let closed = false;
  socket.addEventListener('message', event => { messages.push(event.data); }); socket.addEventListener('close', () => { closed = true; });
  return { socket, messages, stub: env.SYNC.getByName(page.room), get closed() { return closed; } };
}
export async function commit(client: Awaited<ReturnType<typeof connect>>, doc: Y.Doc, id: string) {
  const before = client.messages.length;
  client.socket.send('__YPS:' + JSON.stringify({ type: 'commit', id, update: toBase64(Y.encodeStateAsUpdate(doc)) }));
  let reply: { type: string; id: string; checkpoint: number } | undefined;
  await vi.waitFor(() => {
    const raw = client.messages.slice(before).find(message => typeof message === 'string' && message.startsWith('__YPS:'));
    expect(raw).toBeDefined(); reply = JSON.parse((raw as string).slice(6));
  }); return reply!;
}
export async function persisted(client: Awaited<ReturnType<typeof connect>>) {
  const bytes = await runInDurableObject(client.stub, async instance => {
    const doc = await instance.onLoad(); try { return Y.encodeStateAsUpdate(doc); } finally { doc.destroy(); }
  });
  const doc = new Y.Doc(); Y.applyUpdate(doc, bytes); return doc;
}
