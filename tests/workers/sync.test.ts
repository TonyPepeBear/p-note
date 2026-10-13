import { env } from 'cloudflare:workers';
import { abortAllDurableObjects, evictDurableObject, reset, runInDurableObject } from 'cloudflare:test';
import { afterEach, expect, it, vi } from 'vitest';
import { toBase64 } from 'lib0/buffer';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  vi.restoreAllMocks();
  await reset();
});

async function connect(name: string) {
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
  const response = await env.ROOMS.getByName(client.name).fetch('http://127.0.0.1/state');
  expect(response.status).toBe(200);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(await response.arrayBuffer()));
  return doc;
}

it('PROBE-SYNC-02：確認遺失後重送仍可確認，正文不重複', async () => {
  const client = await connect('duplicate');
  const doc = new Y.Doc();
  doc.getText('body').insert(0, '重送');
  const first = await commit(client, doc, 'edit-1');
  expect(first.type).toBe('persisted');
  const second = await commit(client, doc, 'edit-1');
  expect(second).toMatchObject({ type: 'persisted', id: 'edit-1' });
  await abortAllDurableObjects();
  expect((await persisted(client)).getText('body').toString()).toBe('重送');
});

it('PROBE-SYNC-03：寫入失敗不確認、不廣播、不污染房間，可重試', async () => {
  const client = await connect('failure');
  const peer = await connect('failure');
  await runInDurableObject(client.stub, (_instance, state) => {
    vi.spyOn(state.storage, 'transactionSync').mockImplementationOnce(() => { throw new Error('測試寫入失敗'); });
  });
  const doc = new Y.Doc();
  doc.getText('body').insert(0, '仍在本機');
  const failed = await commit(client, doc, 'failed');
  expect(failed.type).toBe('error');
  expect(peer.messages.filter(m => typeof m === 'string')).toEqual([]);
  expect(peer.messages.some(m => typeof m !== 'string' && new Uint8Array(m)[1] === 2)).toBe(false);
  expect((await persisted(client)).getText('body').toString()).toBe('');
  expect((await commit(client, doc, 'retry')).type).toBe('persisted');
  expect((await persisted(client)).getText('body').toString()).toBe('仍在本機');
});

it('PROBE-SYNC-04：每筆確認指向自己的提交，新修改有不同確認', async () => {
  const client = await connect('ack');
  const doc = new Y.Doc();
  doc.getText('body').insert(0, '第一筆');
  const first = await commit(client, doc, 'first');
  doc.getText('body').insert(3, '第二筆');
  const second = await commit(client, doc, 'second');
  expect(first).toMatchObject({ type: 'persisted', id: 'first' });
  expect(second).toMatchObject({ type: 'persisted', id: 'second' });
  expect(second.checkpoint).toBeGreaterThan(first.checkpoint);
});

it('PROBE-SYNC-05：純刪除的 state vector 不變，仍持久确认並可重啟恢復'.replace('确认', '確認'), async () => {
  const client = await connect('delete');
  const doc = new Y.Doc();
  doc.getText('body').insert(0, '刪除這些字');
  expect((await commit(client, doc, 'insert')).type).toBe('persisted');
  const vector = Y.encodeStateVector(doc);
  doc.getText('body').delete(0, 5);
  expect(Y.encodeStateVector(doc)).toEqual(vector);
  expect(await commit(client, doc, 'delete')).toMatchObject({ type: 'persisted', id: 'delete' });
  await abortAllDurableObjects();
  expect((await persisted(client)).getText('body').toString()).toBe('');
});

it('PROBE-SYNC-06：確認後 abort 與休眠／喚醒只靠持久狀態恢復', async () => {
  const client = await connect('restart');
  const doc = new Y.Doc();
  doc.getText('body').insert(0, '已持久保存');
  expect((await commit(client, doc, 'before-restart')).type).toBe('persisted');
  doc.destroy();
  await abortAllDurableObjects();
  expect((await persisted(client)).getText('body').toString()).toBe('已持久保存');
  const resumed = await connect('restart');
  await evictDurableObject(resumed.stub);
  const next = new Y.Doc();
  Y.applyUpdate(next, Y.encodeStateAsUpdate(await persisted(resumed)));
  next.getText('body').insert(5, '與喚醒');
  expect((await commit(resumed, next, 'after-hibernate')).type).toBe('persisted');
  expect((await persisted(resumed)).getText('body').toString()).toBe('已持久保存與喚醒');
});

it('PROBE-SYNC-07：快照整理交易中斷會回滾，後續更新重啟後仍存在', async () => {
  const client = await connect('compact');
  const doc = new Y.Doc();
  doc.getText('body').insert(0, '整理前');
  expect((await commit(client, doc, 'before')).type).toBe('persisted');
  await runInDurableObject(client.stub, (_instance, state) => {
    const exec = state.storage.sql.exec.bind(state.storage.sql);
    vi.spyOn(state.storage.sql, 'exec').mockImplementation((query, ...args) => {
      if (query.startsWith('DELETE FROM updates')) throw new Error('測試整理中斷');
      return exec(query, ...args);
    });
  });
  expect((await env.ROOMS.getByName(client.name).fetch('http://127.0.0.1/compact', { method: 'POST' })).status).toBe(503);
  vi.restoreAllMocks();
  await runInDurableObject(client.stub, (_instance, state) => {
    expect(state.storage.sql.exec('SELECT count(*) AS n FROM snapshot').one().n).toBe(0);
    expect(state.storage.sql.exec('SELECT count(*) AS n FROM updates').one().n).toBe(1);
  });
  doc.getText('body').insert(3, '整理後');
  expect((await commit(client, doc, 'after')).type).toBe('persisted');
  await abortAllDurableObjects();
  expect((await persisted(client)).getText('body').toString()).toBe('整理前整理後');
  expect((await env.ROOMS.getByName(client.name).fetch('http://127.0.0.1/compact', { method: 'POST' })).status).toBe(200);
  await abortAllDurableObjects();
  expect((await persisted(client)).getText('body').toString()).toBe('整理前整理後');
});

it('PROBE-ORDER-01：原生 Yjs 更新在傳給其他端之前已寫入 SQLite', async () => {
  const client = await connect('order');
  const peer = await connect('order');
  const doc = new Y.Doc();
  doc.getText('body').insert(0, '先存再送');
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
  expect((await persisted(client)).getText('body').toString()).toBe('先存再送');
});

it('PROBE-BOUNDARY-01：損毀更新與超限資料不寫入、不污染房間', async () => {
  const client = await connect('invalid');
  for (const update of [new Uint8Array([255]), new Uint8Array(512 * 1024 + 1)]) {
    const before = client.messages.length;
    client.socket.send(`__YPS:${JSON.stringify({ type: 'commit', id: 'invalid', update: toBase64(update) })}`);
    await vi.waitFor(() => expect(client.messages.slice(before).some(m => typeof m === 'string' && JSON.parse(m.slice(6)).type === 'error')).toBe(true));
  }
  expect((await persisted(client)).getText('body').toString()).toBe('');
  await runInDurableObject(client.stub, (_instance, state) => {
    expect(state.storage.sql.exec('SELECT count(*) AS n FROM updates').one().n).toBe(0);
  });
});

it('PROBE-LOAD-01：持久紀錄損毀時載入失敗，不建立空文件覆蓋', async () => {
  const client = await connect('corrupt');
  const doc = new Y.Doc();
  doc.getText('body').insert(0, '不可覆寫');
  expect((await commit(client, doc, 'saved')).type).toBe('persisted');
  await runInDurableObject(client.stub, (_instance, state) => {
    state.storage.sql.exec('INSERT INTO updates (payload) VALUES (?)', new Uint8Array([255]));
  });
  await abortAllDurableObjects();
  expect((await env.ROOMS.getByName(client.name).fetch('http://127.0.0.1/state')).status).toBe(500);
  await runInDurableObject(env.ROOMS.getByName(client.name), (_instance, state) => {
    expect(state.storage.sql.exec('SELECT count(*) AS n FROM updates').one().n).toBe(2);
  });
});

it('PROBE-CHECKPOINT-01：沒有新更新時重複整理不倒退持久檢查點', async () => {
  const client = await connect('checkpoint');
  const doc = new Y.Doc();
  doc.getText('body').insert(0, '保存');
  const receipt = await commit(client, doc, 'saved');
  expect(receipt.type).toBe('persisted');
  for (let attempt = 0; attempt < 2; attempt++) {
    expect((await env.ROOMS.getByName(client.name).fetch('http://127.0.0.1/compact', { method: 'POST' })).status).toBe(200);
    await runInDurableObject(client.stub, (_instance, state) => {
      expect(state.storage.sql.exec('SELECT checkpoint FROM snapshot').one().checkpoint).toBe(receipt.checkpoint);
    });
  }
  doc.getText('body').insert(2, '後續');
  expect((await commit(client, doc, 'next')).checkpoint).toBeGreaterThan(receipt.checkpoint);
  await abortAllDurableObjects();
  expect((await persisted(client)).getText('body').toString()).toBe('保存後續');
});
