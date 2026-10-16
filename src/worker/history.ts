import * as Y from 'yjs';
import { queueCleanup } from './storage-cleanup';
import type { PageHistory, PageVersion, PageVersionReason, PageVersionRestore } from '../shared/history';
import type { PageInfo, PageRow } from '../shared/pages';
import { roomName } from '../shared/room';
import { checksum } from './backups';
import { blockEditor, readBlocks } from './block-json';
import { PageError, visiblePage } from './pages';
import { body } from './request';

export type HistoryScope = { owner: string; page: string; generation: string };
export type StoredVersion = PageVersion & {
  sequence: number; owner_id: string; generation: string; checksum: string; byte_size: number; object_key: string;
};
export type HistoryRestoreOperation = {
  request_id: string; owner_id: string; page_id: string; version_id: string;
  old_generation: string; new_generation: string; before_version_id: string; restored_version_id: string;
  phase: 'pausing' | 'capturing' | 'preparing' | 'switching' | 'resuming'; created_at: number;
};
export type HistoryReply<T> = { status: number; value?: T; message?: string };
export const AUTO_HISTORY_INTERVAL = 5 * 60 * 1000;
const headers = { 'Cache-Control': 'no-store' };
export const versionInfo = (row: StoredVersion): PageVersion => ({ id: row.id, page_id: row.page_id, title: row.title, created_at: row.created_at, reason: row.reason, checkpoint: row.checkpoint });
export async function historyReply<T>(work: () => Promise<T>): Promise<HistoryReply<T>> {
  try { return { status: 200, value: await work() }; }
  catch (failure) { return { status: failure instanceof PageError ? failure.status : 503, message: failure instanceof PageError ? failure.message : '版本未能保存或還原，請重試原操作' }; }
}
function unwrap<T>(reply: HistoryReply<T>): T {
  if (reply.status !== 200) throw new PageError(reply.status, reply.message ?? '版本處理失敗');
  return reply.value!;
}
export async function currentHistoryPage(env: Env, scope: HistoryScope, operation?: string): Promise<PageRow> {
  const page = await env.DB.prepare(`SELECT * FROM pages WHERE id = ? AND owner_id = ? AND sync_generation = ?
    AND (? IS NOT NULL OR NOT EXISTS (SELECT 1 FROM page_operation_members WHERE owner_id = ? AND page_id = pages.id))
    AND NOT EXISTS (SELECT 1 FROM restore_operations WHERE owner_id = ?)`)
    .bind(scope.page, scope.owner, scope.generation, operation ?? null, scope.owner, scope.owner).first<PageRow>();
  if (!page || page.deleted_at !== null || (!operation && !await visiblePage(env.DB, scope.owner, scope.page))) throw new PageError(409, '頁面狀態已改變，請重新載入');
  if (page.database_config) throw new PageError(409, '資料庫容器尚未支援版本歷史');
  return page;
}
export async function storedVersion(env: Env, owner: string, page: string, id: string): Promise<StoredVersion> {
  const row = await env.DB.prepare('SELECT * FROM page_versions WHERE id = ? AND owner_id = ? AND page_id = ?').bind(id, owner, page).first<StoredVersion>();
  if (!row) throw new PageError(404, '找不到頁面版本');
  return row;
}
export async function versionBytes(env: Env, row: StoredVersion): Promise<Uint8Array> {
  const object = await env.BACKUPS.get(row.object_key);
  if (!object || object.size !== row.byte_size) throw new PageError(503, '版本內容校驗失敗，現況保留');
  const data = new Uint8Array(await object.arrayBuffer());
  if (await checksum(data) !== row.checksum) throw new PageError(503, '版本內容校驗失敗，現況保留');
  const doc = new Y.Doc();
  try { Y.applyUpdate(doc, data); } catch { throw new PageError(503, '版本內容無效，現況保留'); } finally { doc.destroy(); }
  return data;
}
export async function saveVersion(env: Env, page: PageRow, data: Uint8Array, checkpoint: number, reason: PageVersionReason, now: number, explicit?: { id: string; operation: string }): Promise<PageVersion> {
  const hash = await checksum(data);
  const existing = explicit
    ? await env.DB.prepare('SELECT * FROM page_versions WHERE id = ? AND owner_id = ? AND page_id = ?').bind(explicit.id, page.owner_id, page.id).first<StoredVersion>()
    : await env.DB.prepare('SELECT * FROM page_versions WHERE owner_id = ? AND page_id = ? ORDER BY sequence DESC LIMIT 1').bind(page.owner_id, page.id).first<StoredVersion>();
  if (existing && existing.checksum === hash && existing.title === page.title && (explicit || reason === 'auto' || existing.reason === reason)) return versionInfo(existing);
  if (explicit && existing) throw new PageError(409, '還原前版本內容已改變，請重試原操作');
  const id = explicit?.id ?? crypto.randomUUID(); const key = `versions/${page.owner_id}/${page.id}/${id}.yjs`;
  await queueCleanup(env, page.owner_id, 'version', key);
  await env.BACKUPS.put(key, data, { onlyIf: { etagDoesNotMatch: '*' }, sha256: await crypto.subtle.digest('SHA-256', data), httpMetadata: { contentType: 'application/octet-stream' } });
  const candidate: StoredVersion = { id, page_id: page.id, owner_id: page.owner_id, generation: page.sync_generation, title: page.title, created_at: now, reason, checkpoint, checksum: hash, byte_size: data.length, object_key: key, sequence: 0 };
  await versionBytes(env, candidate);
  const inserted = await env.DB.prepare(`INSERT INTO page_versions (id, owner_id, page_id, generation, title, created_at, reason, checkpoint, checksum, byte_size, object_key)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM pages WHERE id = ? AND owner_id = ? AND sync_generation = ? AND title = ? AND metadata_revision = ?)
    AND NOT EXISTS (SELECT 1 FROM page_operation_members WHERE owner_id = ? AND page_id = ? AND operation_id <> ?)
    AND NOT EXISTS (SELECT 1 FROM restore_operations WHERE owner_id = ?) ON CONFLICT(id) DO NOTHING`)
    .bind(id, page.owner_id, page.id, page.sync_generation, page.title, now, reason, checkpoint, hash, data.length, key,
      page.id, page.owner_id, page.sync_generation, page.title, page.metadata_revision, page.owner_id, page.id, explicit?.operation ?? '', page.owner_id).run();
  if (!inserted.meta.changes && !await env.DB.prepare('SELECT 1 FROM page_versions WHERE id = ?').bind(id).first()) throw new PageError(409, '頁面狀態已改變，請重試');
  return versionInfo(candidate);
}
export async function restoredPage(env: Env, owner: string, id: string): Promise<PageInfo> {
  const page = await env.DB.prepare('SELECT * FROM pages WHERE id = ? AND owner_id = ?').bind(id, owner).first<PageRow>();
  if (!page) throw new PageError(404, '找不到頁面');
  return { ...page, room: await roomName(owner, id, page.sync_generation) };
}

export async function handleHistory(request: Request, env: Env, owner: string): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === '/api/history-restore' && request.method === 'GET') {
    const operation = await env.DB.prepare('SELECT request_id, version_id, page_id FROM page_history_restores WHERE owner_id = ?').bind(owner).first<{ request_id: string; version_id: string; page_id: string }>();
    return Response.json({ restore: operation, page: operation ? await restoredPage(env, owner, operation.page_id) : null }, { headers });
  }
  const match = url.pathname.match(/^\/api\/pages\/([\w-]{1,80})\/history(?:\/([\w-]{1,80})(?:\/(restore))?)?$/);
  if (!match) return null;
  const [, pageId, versionId, action] = match;
  const pending = await env.DB.prepare('SELECT * FROM page_history_restores WHERE owner_id = ?').bind(owner).first<HistoryRestoreOperation>();
  const page = await env.DB.prepare('SELECT * FROM pages WHERE id = ? AND owner_id = ?').bind(pageId, owner).first<PageRow>();
  if (!page || page.deleted_at !== null || (pending?.page_id !== pageId && !await visiblePage(env.DB, owner, pageId))) throw new PageError(404, '找不到頁面');
  if (page.database_config) throw new PageError(409, '資料庫容器尚未支援版本歷史');
  const scope: HistoryScope = { owner, page: pageId, generation: pending?.page_id === pageId ? pending.old_generation : page.sync_generation };
  const room = env.SYNC.getByName(await roomName(owner, pageId, scope.generation));
  if (!versionId && request.method === 'GET') {
    const rawLimit = url.searchParams.get('limit'); const limit = rawLimit === null ? 20 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new PageError(400, '版本筆數須為 1～50');
    const cursor = url.searchParams.get('cursor'); let sequence = Number.MAX_SAFE_INTEGER;
    if (cursor) sequence = (await storedVersion(env, owner, pageId, cursor)).sequence;
    if (!pending) unwrap(await room.historyCurrent(scope, 'auto'));
    const rows = (await env.DB.prepare('SELECT * FROM page_versions WHERE owner_id = ? AND page_id = ? AND sequence < ? ORDER BY sequence DESC LIMIT ?').bind(owner, pageId, sequence, limit + 1).all<StoredVersion>()).results;
    const versions = rows.slice(0, limit).map(versionInfo);
    const result: PageHistory = { versions, next_cursor: rows.length > limit ? versions.at(-1)!.id : null, restore: pending?.page_id === pageId ? { request_id: pending.request_id, version_id: pending.version_id } : null };
    return Response.json(result, { headers });
  }
  if (!versionId && request.method === 'POST') {
    if (pending) throw new PageError(409, '請先繼續原版本還原');
    const version = unwrap(await room.historyCurrent(scope, 'manual'));
    return Response.json(version, { status: 201, headers });
  }
  if (versionId && !action && request.method === 'GET') {
    const version = await storedVersion(env, owner, pageId, versionId); const data = await versionBytes(env, version); const doc = new Y.Doc();
    try { Y.applyUpdate(doc, data); return Response.json({ version: versionInfo(version), blocks: readBlocks(doc, blockEditor()) }, { headers }); }
    finally { doc.destroy(); }
  }
  if (versionId && action === 'restore' && request.method === 'POST') {
    const value = await body(request);
    if (typeof value.request_id !== 'string' || !/^[\w-]{1,80}$/.test(value.request_id)) throw new PageError(400, '請提供有效還原請求識別');
    const done = await env.DB.prepare('SELECT * FROM completed_page_history_restores WHERE request_id = ? AND owner_id = ?').bind(value.request_id, owner).first<{ page_id: string; version_id: string; before_version_id: string }>();
    if (done) {
      if (done.page_id !== pageId || done.version_id !== versionId) throw new PageError(409, '此請求識別已用於其他還原');
      const result: PageVersionRestore = { ok: true, page: await restoredPage(env, owner, pageId), before_version_id: done.before_version_id };
      return Response.json(result, { headers });
    }
    if (pending && (pending.page_id !== pageId || pending.version_id !== versionId || pending.request_id !== value.request_id)) throw new PageError(409, '請繼續原版本還原');
    await versionBytes(env, await storedVersion(env, owner, pageId, versionId));
    return Response.json(unwrap(await room.restoreHistory(scope, versionId, value.request_id)), { headers });
  }
  return new Response('Not found', { status: 404, headers });
}
