import { env, exports } from 'cloudflare:workers';
import { abortAllDurableObjects, reset, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { authenticated, commit, connect, origin } from './helpers';

const sockets: WebSocket[] = [];
beforeEach(async () => {
  await exports.default.fetch(origin + '/health');
  await exports.default.fetch(origin + '/__test/reset', { method: 'POST' });
});
afterEach(async () => { vi.restoreAllMocks(); sockets.splice(0).forEach(socket => socket.close()); await reset(); });
function document(text: string) {
  const doc = new Y.Doc(); const paragraph = new Y.XmlElement('paragraph'); const body = new Y.XmlText();
  body.insert(0, text); paragraph.insert(0, [body]); doc.getXmlFragment('body').insert(0, [paragraph]); return doc;
}

it('BACKUP-CAPTURE-01：房間擷取只靠持久資料，在 abort 後保留檢查點與時間', async () => {
  const auth = await authenticated(); const page = await auth.note('備份筆記');
  const client = await connect(page, auth.cookie); sockets.push(client.socket);
  const doc = document('已確認正文');
  const receipt = await commit(client, doc, 'backup-accepted'); expect(receipt.type).toBe('persisted');
  await abortAllDurableObjects();
  const snapshot = await env.SYNC.getByName(page.room).capture({ owner: page.owner_id, page: page.id, generation: page.sync_generation });
  expect(snapshot.checkpoint).toBe(receipt.checkpoint); expect(snapshot.capturedAt).toBe(auth.now);
  expect(snapshot.generation).toBe(page.sync_generation);
  const recovered = new Y.Doc(); Y.applyUpdate(recovered, snapshot.data);
  expect(recovered.getXmlFragment('body').toString()).toContain('已確認正文');
  expect(Y.encodeStateAsUpdate(recovered)).toEqual(Y.encodeStateAsUpdate(doc));
  recovered.destroy(); doc.destroy();
});

it('BACKUP-CAPTURE-02：內部擷取拒絕偽造 owner／頁面／世代及已切換的舊房間', async () => {
  const auth = await authenticated(); const page = await auth.note('私有備份');
  const scope = { owner: page.owner_id, page: page.id, generation: page.sync_generation };
  const stub = env.SYNC.getByName(page.room);
  for (const invalid of [{ ...scope, owner: 'other' }, { ...scope, page: 'other' }, { ...scope, generation: 'other' }]) {
    await expect((async () => await stub.capture(invalid))()).rejects.toThrow();
  }
  const empty = await stub.capture(scope); expect(empty.checkpoint).toBe(0);
  await env.DB.prepare('UPDATE pages SET sync_generation = ? WHERE id = ?').bind('replacement-generation', page.id).run();
  await expect((async () => await env.SYNC.getByName(page.room).capture(scope))()).rejects.toThrow();
  expect((await auth.get(`/parties/sync/${page.room}/capture`)).status).toBe(404);
});

it('BACKUP-CAPTURE-03：各篇保存檢查點及擷取時間獨立，未送達離線修改不進備份', async () => {
  const auth = await authenticated();
  const first = await auth.note('第一篇'); const second = await auth.today();
  const clients = await Promise.all([connect(first, auth.cookie), connect(second, auth.cookie)]); clients.forEach(client => sockets.push(client.socket));
  const docs = [document('第一篇雲端'), document('日記雲端')];
  const receipts = await Promise.all(clients.map((client, index) => commit(client, docs[index], `backup-${index}`)));
  docs[0].getXmlFragment('body').insert(1, [new Y.XmlText('僅在離線裝置')]);
  const snapshots = [];
  for (const [index, page] of [first, second].entries()) {
    await auth.post('/__test/control', { now: auth.now + index * 1000 });
    snapshots.push(await env.SYNC.getByName(page.room).capture({ owner: page.owner_id, page: page.id, generation: page.sync_generation }));
  }
  expect(snapshots.map(snapshot => snapshot.capturedAt)).toEqual([auth.now, auth.now + 1000]);
  expect(snapshots.map(snapshot => snapshot.checkpoint)).toEqual(receipts.map(receipt => receipt.checkpoint));
  const cloud = new Y.Doc(); Y.applyUpdate(cloud, snapshots[0].data);
  expect(cloud.getXmlFragment('body').toString()).toContain('第一篇雲端');
  expect(cloud.getXmlFragment('body').toString()).not.toContain('僅在離線裝置');
  cloud.destroy(); docs.forEach(doc => doc.destroy());
});

it('BACKUP-CAPTURE-04：擷取期間切世代或持久紀錄損毀，拒絕快照且不以空文件替代', async () => {
  const auth = await authenticated(); const page = await auth.note('擷取邊界');
  const client = await connect(page, auth.cookie); sockets.push(client.socket);
  const doc = document('不能損失正文'); await commit(client, doc, 'capture-boundary'); doc.destroy();
  const scope = { owner: page.owner_id, page: page.id, generation: page.sync_generation };
  await runInDurableObject(client.stub, (_instance, state) => {
    const sync = state.storage.sync.bind(state.storage);
    vi.spyOn(state.storage, 'sync').mockImplementationOnce(async () => {
      await env.DB.prepare('UPDATE pages SET sync_generation = ? WHERE id = ?').bind('changed-during-capture', page.id).run();
      await sync();
    });
  });
  await expect((async () => await client.stub.capture(scope))()).rejects.toThrow(/世代/);
  vi.restoreAllMocks();
  await env.DB.prepare('UPDATE pages SET sync_generation = ? WHERE id = ?').bind(page.sync_generation, page.id).run();
  const good = await client.stub.capture(scope); expect(good.checkpoint).toBeGreaterThan(0);
  await runInDurableObject(client.stub, (_instance, state) => {
    state.storage.sql.exec('UPDATE updates SET payload = ?', new Uint8Array([255, 255, 255]));
  });
  await expect((async () => await client.stub.capture(scope))()).rejects.toThrow();
  expect((await auth.get(`/api/pages/${page.id}`)).status).toBe(200);
  await runInDurableObject(client.stub, (_instance, state) => expect(state.storage.sql.exec('SELECT count(*) AS n FROM updates').one().n).toBe(1));
});
