import { exports } from 'cloudflare:workers';
import { abortAllDurableObjects, reset, runInDurableObject } from 'cloudflare:test';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { authenticated, connect, commit, persisted, origin } from './helpers';

const sockets: WebSocket[] = [];
beforeEach(async () => { await exports.default.fetch(origin + '/health'); });
afterEach(async () => { vi.restoreAllMocks(); sockets.splice(0).forEach(socket => socket.close()); await reset(); });
async function fixture(size: number) {
  const auth = await authenticated(); const page = await auth.today(); const client = await connect(page, auth.cookie); sockets.push(client.socket);
  const doc = new Y.Doc(); const node = new Y.XmlText(); node.insert(0, '文字'.repeat(size)); doc.getXmlFragment('body').insert(0, [node]);
  const write = async (n: number) => { node.insert(node.length, String(n)); expect((await commit(client, doc, 'update-' + n)).type).toBe('persisted'); };
  const stats = () => runInDurableObject(client.stub, async (instance, state) => {
    await instance.reindex({ owner: page.owner_id, page: page.id, generation: page.sync_generation });
    const rows = state.storage.sql.exec<{ n: number; bytes: number }>('SELECT count(*) AS n, COALESCE(SUM(length(payload)), 0) AS bytes FROM updates').one();
    const snapshot = state.storage.sql.exec<{ checkpoint: number; bytes: number }>('SELECT checkpoint, length(payload) AS bytes FROM snapshot').toArray()[0];
    return { ...rows, snapshot };
  });
  return { auth, page, client, doc, write, stats };
}
it('COMPACT-AUTO-01：64 筆更新自動整理，abort 後正文與最高檢查點仍完整', async () => {
  const f = await fixture(2000);
  for (let n = 1; n <= 63; n++) await f.write(n);
  const before = await f.stats(); expect(before.n).toBe(63); expect(before.bytes).toBeLessThan(2 * 1024 * 1024);
  await f.write(64); const after = await f.stats(); expect(after.n).toBe(0); expect(after.snapshot?.checkpoint).toBe(64);
  console.info('整理門檻量測', JSON.stringify({ 更新筆數: before.n, 更新位元組: before.bytes, 快照位元組: after.snapshot?.bytes }));
  await abortAllDurableObjects(); const restored = await persisted(f.client); expect(Y.encodeStateAsUpdate(restored)).toEqual(Y.encodeStateAsUpdate(f.doc)); restored.destroy(); f.doc.destroy();
}, 30000);
it('COMPACT-AUTO-02：紀錄超過 2 MiB 提前整理，大正文雜湊與持久確認保持一致', async () => {
  const f = await fixture(70000);
  for (let n = 1; n <= 6; n++) await f.write(n);
  const after = await f.stats(); expect(after.n).toBe(1); expect(after.snapshot?.checkpoint).toBe(5);
  await abortAllDurableObjects(); const restored = await persisted(f.client); expect(Y.encodeStateAsUpdate(restored)).toEqual(Y.encodeStateAsUpdate(f.doc)); restored.destroy(); f.doc.destroy();
}, 30000);
it('COMPACT-AUTO-03：整理交易失敗不否定已完成確認，保留紀錄並在下次更新重試', async () => {
  const f = await fixture(100);
  for (let n = 1; n <= 63; n++) await f.write(n);
  await runInDurableObject(f.client.stub, (_instance, state) => {
    const exec = state.storage.sql.exec.bind(state.storage.sql);
    vi.spyOn(state.storage.sql, 'exec').mockImplementation((sql, ...values) => {
      if (sql.startsWith('DELETE FROM updates')) throw new Error('測試自動整理中斷');
      return exec(sql, ...values);
    });
  });
  const before = f.client.messages.length; await f.write(64);
  expect(f.client.messages.slice(before).some(message => typeof message === 'string' && message.includes('"type":"error"'))).toBe(false);
  expect((await f.stats()).n).toBe(64);
  vi.restoreAllMocks(); await abortAllDurableObjects();
  const restored = await persisted(f.client); expect(Y.encodeStateAsUpdate(restored)).toEqual(Y.encodeStateAsUpdate(f.doc)); restored.destroy();
  // abort 關閉舊 socket，重連同一世代後沿用提交。
  f.client = await connect(f.page, f.auth.cookie); sockets.push(f.client.socket);
  expect((await commit(f.client, f.doc, 'retry-compaction')).type).toBe('persisted');
  await f.client.stub.reindex({ owner: f.page.owner_id, page: f.page.id, generation: f.page.sync_generation });
  const stats = await runInDurableObject(f.client.stub, (_instance, state) => state.storage.sql.exec<{ n: number }>('SELECT count(*) AS n FROM updates').one());
  expect(stats.n).toBe(0); f.doc.destroy();
}, 30000);
