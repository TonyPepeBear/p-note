import { env, exports } from 'cloudflare:workers';
import { abortAllDurableObjects, evictDurableObject, reset, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toBase64 } from 'lib0/buffer';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { authenticated, connect as connectPrivate, persisted as persistedPrivate } from './helpers';
import { ProbeRoom } from '../../src/worker/index';
import type { PageInfo } from '../../src/shared/pages';

for (const formal of [false, true]) {
describe(formal ? '正式房間' : '技術原型', () => {
const prefix = formal ? '' : 'PROBE-';
const pages = new Map<string, PageInfo>();
let auth: Awaited<ReturnType<typeof authenticated>> | undefined;
if (formal) beforeEach(async () => {
  await exports.default.fetch('http://127.0.0.1/__test/reset', { method: 'POST' });
  auth = await authenticated();
});

const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  vi.restoreAllMocks();
  await reset(); auth = undefined; pages.clear();
});

function content(doc: Y.Doc): Y.Text | Y.XmlText {
  if (!formal) return doc.getText('body');
  const fragment = doc.getXmlFragment('body');
  if (!fragment.length) { const paragraph = new Y.XmlElement('paragraph'); paragraph.insert(0, [new Y.XmlText()]); fragment.insert(0, [paragraph]); }
  return (fragment.get(0) as Y.XmlElement).get(0) as Y.XmlText;
}

async function connect(name: string) {
  if (formal) {
    auth ??= await authenticated();
    let page = pages.get(name);
    if (!page) { page = await auth.note(name); pages.set(name, page); }
    const client = await connectPrivate(page, auth.cookie); sockets.push(client.socket);
    return { ...client, name };
  }
  const stub = env.ROOMS.getByName(name);
  const response = await stub.fetch(new Request(`http://127.0.0.1/parties/rooms/${name}`, {
    headers: { Upgrade: 'websocket' },
  }));
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  socket.binaryType = 'arraybuffer';
  socket.accept();
  sockets.push(socket);
  const messages: (string | ArrayBuffer)[] = [];
  socket.addEventListener('message', event => { messages.push(event.data); });
  return { name, stub, socket, messages };
}

async function commit(client: Awaited<ReturnType<typeof connect>>, doc: Y.Doc, id: string) {
  const before = client.messages.length;
  client.socket.send(`__YPS:${JSON.stringify({ type: 'commit', id, update: toBase64(Y.encodeStateAsUpdate(doc)) })}`);
  let reply: { type: string; id: string; checkpoint: number } | undefined;
  await vi.waitFor(() => {
    const raw = client.messages.slice(before).find(message => typeof message === 'string' && message.startsWith('__YPS:'));
    expect(raw, '須收到提交回覆').toBeDefined();
    reply = JSON.parse((raw as string).slice(6));
  }, { timeout: 1500, interval: 10 });
  return reply!;
}

async function persisted(client: Awaited<ReturnType<typeof connect>>) {
  if (formal) return persistedPrivate(client);
  const response = await env.ROOMS.getByName(client.name).fetch('http://127.0.0.1/state');
  expect(response.status).toBe(200);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(await response.arrayBuffer()));
  return doc;
}

async function compact(client: Awaited<ReturnType<typeof connect>>) {
  if (formal) return runInDurableObject(env.SYNC.getByName(pages.get(client.name)!.room), async (instance, state) => {
    await instance.setName(state.id.name!);
    return ProbeRoom.prototype.onRequest.call(instance, new Request('http://127.0.0.1/compact', { method: 'POST' }));
  });
  return env.ROOMS.getByName(client.name).fetch('http://127.0.0.1/compact', { method: 'POST' });
}
async function stateResponse(client: Awaited<ReturnType<typeof connect>>) {
  if (formal) {
    try { await persistedPrivate(client); return new Response('ok'); } catch { return new Response('損毀載入拒絕', { status: 500 }); }
  }
  return env.ROOMS.getByName(client.name).fetch('http://127.0.0.1/state');
}

it(`${prefix}SYNC-02：確認遺失後重送仍可確認，正文不重複`, async () => {
  const client = await connect('duplicate');
  const doc = new Y.Doc();
  content(doc).insert(0, '重送');
  const first = await commit(client, doc, 'edit-1');
  expect(first.type).toBe('persisted');
  const second = await commit(client, doc, 'edit-1');
  expect(second).toMatchObject({ type: 'persisted', id: 'edit-1' });
  await abortAllDurableObjects();
  expect(content(await persisted(client)).toString()).toBe('重送');
});

it(`${prefix}SYNC-03：寫入失敗不確認、不廣播、不污染房間，可重試`, async () => {
  const client = await connect('failure');
  const peer = await connect('failure');
  await runInDurableObject(client.stub, (_instance, state) => {
    vi.spyOn(state.storage, 'transactionSync').mockImplementationOnce(() => { throw new Error('測試寫入失敗'); });
  });
  const doc = new Y.Doc();
  content(doc).insert(0, '仍在本機');
  const failed = await commit(client, doc, 'failed');
  expect(failed.type).toBe('error');
  expect(peer.messages.filter(m => typeof m === 'string')).toEqual([]);
  expect(peer.messages.some(m => typeof m !== 'string' && new Uint8Array(m)[1] === 2)).toBe(false);
  expect(content(await persisted(client)).toString()).toBe('');
  expect((await commit(client, doc, 'retry')).type).toBe('persisted');
  expect(content(await persisted(client)).toString()).toBe('仍在本機');
});

it(`${prefix}SYNC-04：每筆確認指向自己的提交，新修改有不同確認`, async () => {
  const client = await connect('ack');
  const doc = new Y.Doc();
  content(doc).insert(0, '第一筆');
  const first = await commit(client, doc, 'first');
  content(doc).insert(3, '第二筆');
  const second = await commit(client, doc, 'second');
  expect(first).toMatchObject({ type: 'persisted', id: 'first' });
  expect(second).toMatchObject({ type: 'persisted', id: 'second' });
  expect(second.checkpoint).toBeGreaterThan(first.checkpoint);
});

it(`${prefix}SYNC-05：純刪除的 state vector 不變，仍持久確認並可重啟恢復`, async () => {
  const client = await connect('delete');
  const doc = new Y.Doc();
  content(doc).insert(0, '刪除這些字');
  expect((await commit(client, doc, 'insert')).type).toBe('persisted');
  const vector = Y.encodeStateVector(doc);
  content(doc).delete(0, 5);
  expect(Y.encodeStateVector(doc)).toEqual(vector);
  expect(await commit(client, doc, 'delete')).toMatchObject({ type: 'persisted', id: 'delete' });
  await abortAllDurableObjects();
  expect(content(await persisted(client)).toString()).toBe('');
});

it(`${prefix}SYNC-06：確認後 abort 與休眠／喚醒只靠持久狀態恢復`, async () => {
  const client = await connect('restart');
  const doc = new Y.Doc();
  content(doc).insert(0, '已持久保存');
  expect((await commit(client, doc, 'before-restart')).type).toBe('persisted');
  doc.destroy();
  await abortAllDurableObjects();
  expect(content(await persisted(client)).toString()).toBe('已持久保存');
  const resumed = await connect('restart');
  await evictDurableObject(resumed.stub);
  const next = new Y.Doc();
  Y.applyUpdate(next, Y.encodeStateAsUpdate(await persisted(resumed)));
  content(next).insert(5, '與喚醒');
  expect((await commit(resumed, next, 'after-hibernate')).type).toBe('persisted');
  expect(content(await persisted(resumed)).toString()).toBe('已持久保存與喚醒');
});

it(`${prefix}SYNC-07：快照整理交易中斷會回滾，後續更新重啟後仍存在`, async () => {
  const client = await connect('compact');
  const doc = new Y.Doc();
  content(doc).insert(0, '整理前');
  expect((await commit(client, doc, 'before')).type).toBe('persisted');
  await runInDurableObject(client.stub, (_instance, state) => {
    const exec = state.storage.sql.exec.bind(state.storage.sql);
    vi.spyOn(state.storage.sql, 'exec').mockImplementation((query, ...args) => {
      if (query.startsWith('DELETE FROM updates')) throw new Error('測試整理中斷');
      return exec(query, ...args);
    });
  });
  expect((await compact(client)).status).toBe(503);
  vi.restoreAllMocks();
  await runInDurableObject(client.stub, (_instance, state) => {
    expect(state.storage.sql.exec('SELECT count(*) AS n FROM snapshot').one().n).toBe(0);
    expect(state.storage.sql.exec('SELECT count(*) AS n FROM updates').one().n).toBe(1);
  });
  content(doc).insert(3, '整理後');
  expect((await commit(client, doc, 'after')).type).toBe('persisted');
  await abortAllDurableObjects();
  expect(content(await persisted(client)).toString()).toBe('整理前整理後');
  expect((await compact(client)).status).toBe(200);
  await abortAllDurableObjects();
  expect(content(await persisted(client)).toString()).toBe('整理前整理後');
});

it(`${prefix}ORDER-01：原生 Yjs 更新在傳給其他端之前已寫入 SQLite`, async () => {
  const client = await connect('order');
  const peer = await connect('order');
  const doc = new Y.Doc();
  content(doc).insert(0, '先存再送');
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0);
  syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(doc));
  client.socket.send(encoding.toUint8Array(encoder));
  await vi.waitFor(() => expect(peer.messages.some(m => typeof m !== 'string' && new Uint8Array(m)[1] === 2), JSON.stringify({ client: client.messages.map(m => typeof m === 'string' ? m : Array.from(new Uint8Array(m))), peer: peer.messages.map(m => typeof m === 'string' ? m : Array.from(new Uint8Array(m))) })).toBe(true));
  await runInDurableObject(client.stub, (_instance, state) => {
    expect(state.storage.sql.exec("SELECT count(*) AS n FROM sqlite_master WHERE name = 'updates'").one().n).toBe(1);
    expect(state.storage.sql.exec('SELECT count(*) AS n FROM updates').one().n).toBe(1);
  });
  await abortAllDurableObjects();
  expect(content(await persisted(client)).toString()).toBe('先存再送');
});

it(`${prefix}BOUNDARY-01：損毀更新與超限資料不寫入、不污染房間`, async () => {
  const client = await connect('invalid');
  for (const update of [new Uint8Array([255]), new Uint8Array(512 * 1024 + 1)]) {
    const before = client.messages.length;
    client.socket.send(`__YPS:${JSON.stringify({ type: 'commit', id: 'invalid', update: toBase64(update) })}`);
    await vi.waitFor(() => expect(client.messages.slice(before).some(m => typeof m === 'string' && JSON.parse(m.slice(6)).type === 'error')).toBe(true));
  }
  expect(content(await persisted(client)).toString()).toBe('');
  await runInDurableObject(client.stub, (_instance, state) => {
    expect(state.storage.sql.exec('SELECT count(*) AS n FROM updates').one().n).toBe(0);
  });
});

it(`${prefix}LOAD-01：持久紀錄損毀時載入失敗，不建立空文件覆蓋`, async () => {
  const client = await connect('corrupt');
  const doc = new Y.Doc();
  content(doc).insert(0, '不可覆寫');
  expect((await commit(client, doc, 'saved')).type).toBe('persisted');
  await runInDurableObject(client.stub, (_instance, state) => {
    state.storage.sql.exec('INSERT INTO updates (payload) VALUES (?)', new Uint8Array([255]));
  });
  await abortAllDurableObjects();
  expect((await stateResponse(client)).status).toBe(500);
  await runInDurableObject(formal ? env.SYNC.getByName(pages.get(client.name)!.room) : env.ROOMS.getByName(client.name), (_instance, state) => {
    expect(state.storage.sql.exec('SELECT count(*) AS n FROM updates').one().n).toBe(2);
  });
});

it(`${prefix}CHECKPOINT-01：沒有新更新時重複整理不倒退持久檢查點`, async () => {
  const client = await connect('checkpoint');
  const doc = new Y.Doc();
  content(doc).insert(0, '保存');
  const receipt = await commit(client, doc, 'saved');
  expect(receipt.type).toBe('persisted');
  for (let attempt = 0; attempt < 2; attempt++) {
    expect((await compact(client)).status).toBe(200);
    await runInDurableObject(client.stub, (_instance, state) => {
      expect(state.storage.sql.exec('SELECT checkpoint FROM snapshot').one().checkpoint).toBe(receipt.checkpoint);
    });
  }
  content(doc).insert(2, '後續');
  expect((await commit(client, doc, 'next')).checkpoint).toBeGreaterThan(receipt.checkpoint);
  await abortAllDurableObjects();
  expect(content(await persisted(client)).toString()).toBe('保存後續');
});

if (formal) {
  function twoParagraphs() {
    const doc = new Y.Doc();
    for (const value of ['甲', '乙']) { const node = new Y.XmlElement('paragraph'); const text = new Y.XmlText(); text.insert(0, value); node.insert(0, [text]); doc.getXmlFragment('body').push([node]); }
    return doc;
  }
  const secondText = (doc: Y.Doc) => (doc.getXmlFragment('body').get(1) as Y.XmlElement).get(0) as Y.XmlText;
  it('SYNC-01：正式兩端不同段落併發更新，持久正文保留完整合併結果', async () => {
    const first = await connect('both'); const peer = await connect('both'); const base = twoParagraphs();
    expect((await commit(first, base, 'base')).type).toBe('persisted');
    const other = new Y.Doc(); Y.applyUpdate(other, Y.encodeStateAsUpdate(base));
    content(base).insert(1, '電腦'); secondText(other).insert(1, '手機');
    const results = await Promise.all([commit(first, base, 'computer'), commit(peer, other, 'phone')]);
    expect(results.map(value => value.type)).toEqual(['persisted', 'persisted']);
    const stored = await persisted(first); expect(content(stored).toString()).toBe('甲電腦'); expect(secondText(stored).toString()).toBe('乙手機');
  });
  it('SYNC-08：正式斷線保留未送達修改，重連同世代合併在線端與持久確認', async () => {
    const first = await connect('offline'); const peer = await connect('offline'); const local = twoParagraphs();
    await commit(first, local, 'base'); const online = new Y.Doc(); Y.applyUpdate(online, Y.encodeStateAsUpdate(local)); first.socket.close();
    content(local).insert(1, '離線'); secondText(online).insert(1, '在線'); await commit(peer, online, 'online');
    expect(content(await persisted(peer)).toString()).toBe('甲');
    const resumed = await connect('offline'); expect((await commit(resumed, local, 'resumed')).type).toBe('persisted');
    await abortAllDurableObjects(); const stored = await persisted(resumed);
    expect(content(stored).toString()).toBe('甲離線'); expect(secondText(stored).toString()).toBe('乙在線');
  });
}

});
}
