import { env, exports } from 'cloudflare:workers';
import { abortAllDurableObjects, reset } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it } from 'vitest';
import * as Y from 'yjs';
import { blocksToYDoc } from '@blocknote/core/yjs';
import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } from '@zip.js/zip.js';
import { blockEditor } from '../../src/worker/block-json';
import type { BackupManifest } from '../../src/shared/backup';
import { roomName } from '../../src/shared/room';
import { authenticated, commit, connect, origin } from './helpers';
import { create, hash, request } from './backup-helpers';

const sockets: WebSocket[] = [];
beforeEach(async () => { await exports.default.fetch(origin + '/health'); await exports.default.fetch(origin + '/__test/reset', { method: 'POST' }); });
afterEach(async () => { sockets.splice(0).forEach(socket => socket.close()); await reset(); });
type Synced = { id: string; owner_id: string; room: string; sync_generation: string };
async function fixture() {
  const auth = await authenticated(); const page = await auth.note('共用備份頁');
  const added = await auth.post('/api/synced-blocks', { blocks: [
    { type: 'paragraph', content: '備份同步正文' },
    { type: 'paragraph', content: [{ type: 'link', href: '/?page=' + page.id, content: [{ type: 'text', text: '筆記連結', styles: { bold: true } }] }] },
    { type: 'codeBlock', props: { language: 'javascript' }, content: 'const sample = "保存";' },
  ] });
  expect(added.status).toBe(200); const block = await added.json<Synced>();
  const orphan = await (await auth.post('/api/synced-blocks', { blocks: [{ type: 'paragraph', content: '保留無引用正文' }] })).json<Synced>();
  const client = await connect(page, auth.cookie); sockets.push(client.socket);
  const doc = blocksToYDoc(blockEditor(), [{ type: 'syncedBlock' as never, props: { syncedBlockId: block.id } }, { type: 'syncedBlock' as never, props: { syncedBlockId: block.id } }], 'body');
  expect((await commit(client, doc, 'backup-synced-reference')).type).toBe('persisted'); doc.destroy();
  return { auth, page, block, orphan };
}
async function readManifest(auth: Awaited<ReturnType<typeof authenticated>>, id: string) {
  const response = await request(auth, `/api/backups/${id}/manifest`); expect(response.status).toBe(200); return response.json<BackupManifest>();
}

it('SB-16：備份與 ZIP 保存共用正文、無引用正文與關係，可讀格式於每個引用展開並標註 ID', async () => {
  const f = await fixture(); const backup = await create(f.auth); const manifest = await readManifest(f.auth, backup.id);
  expect(manifest.synced_blocks?.map(item => item.metadata.id).sort()).toEqual([f.block.id, f.orphan.id].sort());
  expect(manifest.page_synced_blocks).toEqual([{ page_id: f.page.id, synced_block_id: f.block.id }]);
  const response = await request(f.auth, `/api/backups/${backup.id}/export`); expect(response.status).toBe(200);
  const zip = new ZipReader(new Uint8ArrayReader(new Uint8Array(await response.arrayBuffer())), { useWebWorkers: false });
  const files = new Map<string, Uint8Array>();
  for (const entry of await zip.getEntries()) if (!entry.directory) files.set(entry.filename, await entry.getData(new Uint8ArrayWriter()));
  await zip.close();
  for (const item of manifest.synced_blocks!) expect(await hash(files.get(item.file.path)!)).toBe(item.file.checksum);
  const readable = new TextDecoder().decode(files.get(`readable/pages/${f.page.id}.md`));
  expect(readable.split('備份同步正文')).toHaveLength(3); expect(readable.split(f.block.id)).toHaveLength(3);
  expect(readable).toContain(`[**筆記連結**](/?page=${f.page.id})`); expect(readable).toContain('```javascript\nconst sample = "保存";\n```');
  expect(new TextDecoder().decode(files.get(`readable/synced-blocks/${f.orphan.id}.md`))).toContain('保留無引用正文');
}, 30000);

it('SB-17：覆蓋還原一起切換同步區塊世代、還原關係並拒絕舊房間，舊備份視為空集合', async () => {
  const f = await fixture(); const backup = await create(f.auth); const before = await readManifest(f.auth, backup.id);
  const response = await request(f.auth, `/api/backups/${backup.id}/restore`, env, 'POST'); expect(response.status).toBe(200);
  await abortAllDurableObjects();
  for (const item of before.synced_blocks!) {
    const row = await env.DB.prepare('SELECT sync_generation FROM synced_blocks WHERE id = ? AND owner_id = ?').bind(item.metadata.id, f.page.owner_id).first<{ sync_generation: string }>();
    expect(row?.sync_generation).not.toBe(item.metadata.sync_generation);
    const scope = { owner: f.page.owner_id, page: item.metadata.id, generation: row!.sync_generation, kind: 'syncedBlock' as const };
    const snapshot = await env.SYNC.getByName(await roomName(scope.owner, `synced-block:${scope.page}`, scope.generation)).capture(scope);
    expect(await hash(snapshot.data)).toBe(item.file.checksum);
    await expect((async () => await env.SYNC.getByName(await roomName(scope.owner, `synced-block:${scope.page}`, item.metadata.sync_generation)).capture({ ...scope, generation: item.metadata.sync_generation }))()).rejects.toThrow();
  }
  expect((await env.DB.prepare('SELECT * FROM page_synced_blocks WHERE page_id = ?').bind(f.page.id).all()).results).toEqual(before.page_synced_blocks);
  // 舊版清單沒有共用欄位，且其頁面不含同步引用。
  const legacyAuth = f.auth;
  await env.DB.prepare('DELETE FROM pages WHERE owner_id = ?').bind(f.page.owner_id).run();
  await env.DB.prepare('DELETE FROM synced_blocks WHERE owner_id = ?').bind(f.page.owner_id).run();
  const legacy = await create(legacyAuth); const key = `${f.page.owner_id}/${legacy.id}/manifest.json`;
  const old = JSON.parse(await (await env.BACKUPS.get(key))!.text()) as BackupManifest;
  delete old.synced_blocks; delete old.page_synced_blocks;
  const bytes = new TextEncoder().encode(JSON.stringify(old)); await env.BACKUPS.put(key, bytes);
  await env.DB.prepare('UPDATE backups SET manifest_checksum = ?, manifest_size = ? WHERE id = ?').bind(await hash(bytes), bytes.length, legacy.id).run();
  expect((await legacyAuth.post('/api/synced-blocks', { blocks: [{ type: 'paragraph', content: '舊備份之後的新內容' }] })).status).toBe(200);
  expect((await request(legacyAuth, `/api/backups/${legacy.id}/restore`, env, 'POST')).status).toBe(200);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM synced_blocks WHERE owner_id = ?').bind(f.page.owner_id).first('n')).toBe(0);
}, 30000);

it('SB-17：損毀的共用正文、巢狀引用或不符正文的關係在暫停前拒絕還原', async () => {
  const f = await fixture(); const backup = await create(f.auth); const manifest = await readManifest(f.auth, backup.id);
  const prefix = `${f.page.owner_id}/${backup.id}/`; const entry = manifest.synced_blocks!.find(item => item.metadata.id === f.block.id)!;
  const original = new Uint8Array(await (await env.BACKUPS.get(prefix + entry.file.path))!.arrayBuffer());
  const nested = blocksToYDoc(blockEditor(), [{ type: 'syncedBlock' as never, props: { syncedBlockId: f.orphan.id } }], 'body');
  const invalid = Y.encodeStateAsUpdate(nested); nested.destroy();
  for (const bytes of [new Uint8Array([255, 255, 255]), invalid]) {
    await env.BACKUPS.put(prefix + entry.file.path, bytes); entry.file.byte_size = bytes.length; entry.file.checksum = await hash(bytes);
    const encoded = new TextEncoder().encode(JSON.stringify(manifest)); await env.BACKUPS.put(prefix + 'manifest.json', encoded);
    await env.DB.prepare('UPDATE backups SET manifest_checksum = ?, manifest_size = ? WHERE id = ?').bind(await hash(encoded), encoded.length, backup.id).run();
    expect((await request(f.auth, `/api/backups/${backup.id}/restore`, env, 'POST')).status).toBe(503);
    expect((await f.auth.get(`/api/pages/${f.page.id}`)).status).toBe(200);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM restore_operations').first('n')).toBe(0);
  }
  await env.BACKUPS.put(prefix + entry.file.path, original); entry.file.byte_size = original.length; entry.file.checksum = await hash(original);
  manifest.page_synced_blocks = [];
  const encoded = new TextEncoder().encode(JSON.stringify(manifest)); await env.BACKUPS.put(prefix + 'manifest.json', encoded);
  await env.DB.prepare('UPDATE backups SET manifest_checksum = ?, manifest_size = ? WHERE id = ?').bind(await hash(encoded), encoded.length, backup.id).run();
  expect((await request(f.auth, `/api/backups/${backup.id}/restore`, env, 'POST')).status).toBe(503);
  expect((await f.auth.get(`/api/pages/${f.page.id}`)).status).toBe(200);
  manifest.page_synced_blocks = [{ page_id: f.page.id, synced_block_id: f.block.id }];
  const childDoc = blocksToYDoc(blockEditor(), [{ type: 'syncedBlock' as never, props: { syncedBlockId: f.block.id }, children: [{ type: 'paragraph', content: '禁止隱藏子區塊' }] }], 'body');
  const childBytes = Y.encodeStateAsUpdate(childDoc); childDoc.destroy(); const pageEntry = manifest.pages.find(page => page.metadata.id === f.page.id)!;
  await env.BACKUPS.put(prefix + pageEntry.file.path, childBytes); pageEntry.file.byte_size = childBytes.length; pageEntry.file.checksum = await hash(childBytes);
  const childManifest = new TextEncoder().encode(JSON.stringify(manifest)); await env.BACKUPS.put(prefix + 'manifest.json', childManifest);
  await env.DB.prepare('UPDATE backups SET manifest_checksum = ?, manifest_size = ? WHERE id = ?').bind(await hash(childManifest), childManifest.length, backup.id).run();
  expect((await request(f.auth, `/api/backups/${backup.id}/restore`, env, 'POST')).status).toBe(503);
  expect((await f.auth.get(`/api/pages/${f.page.id}`)).status).toBe(200);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM restore_operations').first('n')).toBe(0);
}, 30000);

it('SB-17：共用正文切換失敗時頁面與同步區塊一起回滾，重啟後沿原操作完成', async () => {
  const f = await fixture(); const backup = await create(f.auth);
  await env.DB.exec(`CREATE TRIGGER restore_synced_failure BEFORE INSERT ON synced_blocks WHEN NEW.id = '${f.block.id}' AND EXISTS (SELECT 1 FROM restore_operations WHERE phase = 'preparing') BEGIN SELECT RAISE(ABORT, '測試同步區塊切換中斷'); END`);
  expect((await request(f.auth, `/api/backups/${backup.id}/restore`, env, 'POST')).status).toBe(503);
  expect(await env.DB.prepare('SELECT sync_generation FROM synced_blocks WHERE id = ?').bind(f.block.id).first('sync_generation')).toBe(f.block.sync_generation);
  expect(await env.DB.prepare('SELECT sync_generation FROM pages WHERE id = ?').bind(f.page.id).first('sync_generation')).toBe(f.page.sync_generation);
  expect((await env.DB.prepare('SELECT * FROM page_synced_blocks WHERE page_id = ?').bind(f.page.id).all()).results).toEqual([{ page_id: f.page.id, synced_block_id: f.block.id }]);
  await env.DB.exec('DROP TRIGGER restore_synced_failure'); await abortAllDurableObjects();
  expect((await request(f.auth, `/api/backups/${backup.id}/restore`, env, 'POST')).status).toBe(200);
  expect(await env.DB.prepare('SELECT sync_generation FROM synced_blocks WHERE id = ?').bind(f.block.id).first('sync_generation')).not.toBe(f.block.sync_generation);
  expect(await env.DB.prepare('SELECT sync_generation FROM pages WHERE id = ?').bind(f.page.id).first('sync_generation')).not.toBe(f.page.sync_generation);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM restore_operations').first('n')).toBe(0);
}, 30000);
