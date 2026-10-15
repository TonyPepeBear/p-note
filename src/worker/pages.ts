import { roomName } from '../shared/room';
import { today, validDate, type PageRow } from '../shared/pages';
import { body, bytes } from './request';
import * as Y from 'yjs';

export const VISIBLE = `WITH RECURSIVE visible AS (
  SELECT * FROM pages WHERE owner_id = ? AND parent_id IS NULL AND deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM restore_operations WHERE owner_id = pages.owner_id)
    AND NOT EXISTS (SELECT 1 FROM page_operation_members WHERE page_id = pages.id)
  UNION ALL SELECT child.* FROM pages child JOIN visible parent ON child.parent_id = parent.id AND child.owner_id = parent.owner_id
    WHERE child.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM page_operation_members WHERE page_id = child.id)
)`;
const TREE = `WITH RECURSIVE subtree AS (SELECT * FROM pages WHERE id = ? AND owner_id = ?
  UNION SELECT child.* FROM pages child JOIN subtree parent ON child.parent_id = parent.id AND child.owner_id = parent.owner_id)`;

export class PageError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (status: number, message: string): never => { throw new PageError(status, message); };

export async function visiblePage(db: D1Database, owner: string, id: string): Promise<PageRow | null> {
  return db.prepare(`${VISIBLE} SELECT * FROM visible WHERE id = ?`).bind(owner, id).first<PageRow>();
}

async function pageResponse(env: Env, owner: string, page: PageRow): Promise<Response> {
  if (await env.DB.prepare('SELECT 1 FROM page_operation_members WHERE page_id = ?').bind(page.id).first()) fail(503, '頁面變更處理中，請重試原操作');
  const info = { ...page, room: await roomName(owner, page.id, page.sync_generation) };
  if (!await visiblePage(env.DB, owner, page.id)) return json({ message: '頁面已在垃圾桶，請先還原上層或原頁面', page: info }, 409);
  const ancestors = (await env.DB.prepare(`WITH RECURSIVE ancestors AS (
    SELECT pages.*, 0 AS depth FROM pages WHERE id = ? AND owner_id = ?
    UNION ALL SELECT parent.*, child.depth + 1 FROM pages parent JOIN ancestors child ON parent.id = child.parent_id AND parent.owner_id = child.owner_id
  ) SELECT * FROM ancestors WHERE id <> ? ORDER BY depth DESC`).bind(page.id, owner, page.id).all<PageRow & { depth: number }>()).results.map(({ depth: _depth, ...row }) => row);
  return json({ ...info, ancestors });
}

async function input(request: Request): Promise<Record<string, unknown>> {
  try { return await body(request); } catch { return fail(400, '無效的頁面資料'); }
}
function title(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 200) return fail(400, '標題須為 1～200 個字元');
  return value.trim().normalize('NFC');
}
function parent(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^[\w-]{1,80}$/.test(value)) return fail(400, '無效的上層識別');
  return value;
}

async function trash(env: Env, owner: string, page: PageRow, action: 'delete' | 'restore', now: number): Promise<Response> {
  if (await env.DB.prepare('SELECT 1 FROM page_history_restores WHERE owner_id = ?').bind(owner).first()) fail(409, '請先繼續原版本還原');
  let operation = await env.DB.prepare('SELECT * FROM page_operations WHERE owner_id = ?').bind(owner).first<{ id: string; page_id: string; action: string; created_at: number }>();
  if (operation && (operation.page_id !== page.id || operation.action !== action)) fail(409, '另一頁面變更處理中，請先重試原操作');
  if (!operation) {
    if (action === 'restore' && page.parent_id && !await visiblePage(env.DB, owner, page.parent_id)) fail(409, '請先還原上層頁面');
    if (action === 'delete' && page.deleted_at === null && !await visiblePage(env.DB, owner, page.id)) fail(409, '頁面已被上層隱藏');
    if ((action === 'delete') === (page.deleted_at !== null)) return json({ ok: true });
    const id = crypto.randomUUID();
    const inserted = await env.DB.batch([
      env.DB.prepare(`${VISIBLE} INSERT INTO page_operations SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM (SELECT owner_id FROM page_operations UNION SELECT owner_id FROM restore_operations) WHERE owner_id = ?)
        AND EXISTS (SELECT 1 FROM pages WHERE id = ? AND owner_id = ? AND ${action === 'delete' ? 'id IN (SELECT id FROM visible)' : 'deleted_at IS NOT NULL AND (parent_id IS NULL OR parent_id IN (SELECT id FROM visible))'})`)
        .bind(owner, id, owner, page.id, action, now, owner, page.id, owner),
      env.DB.prepare(`${TREE} INSERT INTO page_operation_members SELECT ?, id, owner_id, sync_generation FROM subtree WHERE EXISTS (SELECT 1 FROM page_operations WHERE id = ?)`)
        .bind(page.id, owner, id, id),
    ]);
    if (!inserted[0].meta.changes) fail(409, '頁面狀態已改變，請重試');
    operation = { id, page_id: page.id, action, created_at: now };
  }
  const members = (await env.DB.prepare('SELECT * FROM page_operation_members WHERE operation_id = ? ORDER BY page_id').bind(operation.id).all<{ page_id: string; generation: string }>()).results;
  for (const member of members) await env.SYNC.getByName(await roomName(owner, member.page_id, member.generation)).pause();
  await env.DB.prepare('UPDATE pages SET deleted_at = ?, updated_at = ?, metadata_revision = metadata_revision + 1 WHERE id = ? AND owner_id = ? AND deleted_at IS NOT ?')
    .bind(action === 'delete' ? operation.created_at : null, operation.created_at, page.id, owner, action === 'delete' ? operation.created_at : null).run();
  for (const member of members) await env.SYNC.getByName(await roomName(owner, member.page_id, member.generation)).resume();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM page_operation_members WHERE operation_id = ?').bind(operation.id),
    env.DB.prepare('DELETE FROM page_operations WHERE id = ?').bind(operation.id),
  ]);
  return json({ ok: true });
}

export async function handlePages(request: Request, env: Env, owner: string, now: number): Promise<Response | null> {
  const url = new URL(request.url); const path = url.pathname; const db = env.DB;
  const fork = path.match(/^\/api\/pages\/([\w-]{1,80})\/fork$/);
  if (fork && request.method === 'POST') {
    if (request.headers.get('Content-Type') !== 'application/octet-stream') fail(400, '請提供草稿正文');
    const source = await db.prepare('SELECT owner_id, title FROM pages WHERE id = ?').bind(fork[1]).first<{ owner_id: string; title: string }>();
    if (source && source.owner_id !== owner) fail(404, '找不到頁面');
    const doc = new Y.Doc(); let data: Uint8Array;
    try { Y.applyUpdate(doc, await bytes(request, 512 * 1024)); data = Y.encodeStateAsUpdate(doc); }
    catch { return fail(400, '草稿內容無效或超過可保存大小；本機內容仍保留'); }
    finally { doc.destroy(); }
    const id = crypto.randomUUID(); const generation = crypto.randomUUID();
    const room = env.SYNC.getByName(await roomName(owner, id, generation));
    await room.prepare({ owner, page: id, generation }, data, 0); await room.resume();
    const inserted = await db.prepare(`INSERT INTO pages (id, owner_id, kind, title, sync_generation, created_at, updated_at)
      SELECT ?, ?, 'note', ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM (SELECT owner_id FROM page_operations UNION SELECT owner_id FROM restore_operations) WHERE owner_id = ?)`)
      .bind(id, owner, ((source?.title ?? '') + ' 本機草稿').trim().slice(0, 200), generation, now, now, owner).run();
    if (!inserted.meta.changes) fail(409, '頁面變更處理中，草稿仍保留，請稍後重試');
    await room.reindex({ owner, page: id, generation });
    return pageResponse(env, owner, (await db.prepare('SELECT * FROM pages WHERE id = ?').bind(id).first<PageRow>())!);
  }
  if ((path === '/api/today' && request.method === 'GET') || (path === '/api/journal' && request.method === 'POST')) {
    const date = path === '/api/today' ? today(now) : (await input(request)).date;
    if (typeof date !== 'string' || !validDate(date)) fail(400, '請選擇有效日期');
    if (await db.prepare('SELECT 1 FROM (SELECT owner_id FROM page_operations UNION SELECT owner_id FROM restore_operations) WHERE owner_id = ?').bind(owner).first()) fail(409, '頁面變更處理中，請先重試原操作');
    await db.prepare(`INSERT INTO pages (id, owner_id, kind, title, journal_date, sync_generation, created_at, updated_at)
      SELECT ?, ?, 'journal', ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM (SELECT owner_id FROM page_operations UNION SELECT owner_id FROM restore_operations) WHERE owner_id = ?) ON CONFLICT(owner_id, journal_date) DO NOTHING`)
      .bind(crypto.randomUUID(), owner, date, date, crypto.randomUUID(), now, now, owner).run();
    const page = await db.prepare('SELECT * FROM pages WHERE owner_id = ? AND journal_date = ?').bind(owner, date).first<PageRow>();
    if (!page) fail(409, '頁面變更處理中，請重試');
    return pageResponse(env, owner, page!);
  }
  if (path === '/api/pages' && request.method === 'POST') {
    const data = await input(request); const name = title(data.title); const parentId = parent(data.parent_id); const id = crypto.randomUUID();
    const created = await db.prepare(`${VISIBLE} INSERT INTO pages (id, owner_id, kind, title, parent_id, sync_generation, created_at, updated_at)
      SELECT ?, ?, 'note', ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM (SELECT owner_id FROM page_operations UNION SELECT owner_id FROM restore_operations) WHERE owner_id = ?)
      AND (? IS NULL OR ? IN (SELECT id FROM visible WHERE kind = 'note'))`)
      .bind(owner, id, owner, name, parentId, crypto.randomUUID(), now, now, owner, parentId, parentId).run();
    if (!created.meta.changes) fail(409, '上層無效或頁面變更處理中');
    return pageResponse(env, owner, (await db.prepare('SELECT * FROM pages WHERE id = ?').bind(id).first<PageRow>())!);
  }
  if (request.method === 'GET') {
    const backlinks = path.match(/^\/api\/pages\/([\w-]{1,80})\/backlinks$/);
    if (backlinks) {
      if (!await visiblePage(db, owner, backlinks[1])) fail(404, '找不到頁面');
      return json((await db.prepare(`${VISIBLE} SELECT p.id, p.title, p.kind, p.journal_date FROM visible p
        JOIN page_search s ON s.page_id = p.id AND s.owner_id = p.owner_id AND s.indexed_generation = p.sync_generation
        WHERE p.id <> ? AND (EXISTS (SELECT 1 FROM json_each(s.linked_pages) WHERE value = ?)
          OR EXISTS (SELECT 1 FROM page_synced_blocks r
            JOIN synced_blocks b ON b.id = r.synced_block_id AND b.owner_id = p.owner_id
            JOIN synced_block_search bs ON bs.synced_block_id = b.id AND bs.owner_id = b.owner_id AND bs.indexed_generation = b.sync_generation
            WHERE r.page_id = p.id AND EXISTS (SELECT 1 FROM json_each(bs.linked_pages) WHERE value = ?)))
        ORDER BY p.updated_at DESC, p.id`).bind(owner, backlinks[1], backlinks[1], backlinks[1]).all()).results);
    }
    if (path === '/api/pages') return json((await db.prepare(`${VISIBLE} SELECT * FROM visible ORDER BY created_at, id`).bind(owner).all<PageRow>()).results);
    if (path === '/api/trash') return json((await db.prepare('SELECT * FROM pages WHERE owner_id = ? AND deleted_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM page_operation_members WHERE page_id = pages.id) ORDER BY deleted_at DESC, id').bind(owner).all<PageRow>()).results);
    if (path === '/api/journals') {
      const month = url.searchParams.get('month') ?? today(now).slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month) || !validDate(month + '-01')) fail(400, '請選擇有效月份');
      return json((await db.prepare(`${VISIBLE} SELECT * FROM visible WHERE kind = 'journal' AND substr(journal_date, 1, 7) = ? ORDER BY journal_date DESC`).bind(owner, month).all<PageRow>()).results);
    }
    if (path === '/api/search') {
      const q = (url.searchParams.get('q') ?? '').trim().normalize('NFC');
      if (q.length > 200) fail(400, '搜尋最多 200 個字元');
      if (!q) return json([]);
      return json((await db.prepare(`${VISIBLE}, synced_text AS (
          SELECT r.page_id, group_concat(bs.plain_text, char(10)) AS plain_text FROM page_synced_blocks r
          JOIN visible vp ON vp.id = r.page_id
          JOIN page_search ps ON ps.page_id = vp.id AND ps.owner_id = vp.owner_id AND ps.indexed_generation = vp.sync_generation
          JOIN synced_blocks b ON b.id = r.synced_block_id AND b.owner_id = vp.owner_id
          JOIN synced_block_search bs ON bs.synced_block_id = b.id AND bs.owner_id = b.owner_id AND bs.indexed_generation = b.sync_generation
          GROUP BY r.page_id
        ) SELECT p.*, CASE WHEN instr(lower(st.plain_text), lower(?)) > 0 THEN substr(st.plain_text, 1, 160) ELSE COALESCE(s.summary, '') END AS summary
        FROM visible p LEFT JOIN page_search s ON s.page_id = p.id AND s.owner_id = p.owner_id AND s.indexed_generation = p.sync_generation
        LEFT JOIN synced_text st ON st.page_id = p.id
        WHERE instr(lower(p.title), lower(?)) > 0 OR instr(lower(s.plain_text), lower(?)) > 0 OR instr(lower(st.plain_text), lower(?)) > 0
        ORDER BY p.updated_at DESC, p.id`).bind(owner, q, q, q, q).all()).results);
    }
  }
  const match = path.match(/^\/api\/pages\/([\w-]{1,80})(?:\/(title|move|delete|restore))?$/);
  if (!match) return null;
  const [, id, action] = match;
  const page = await db.prepare('SELECT * FROM pages WHERE id = ? AND owner_id = ?').bind(id, owner).first<PageRow>();
  if (!page) fail(404, '找不到頁面');
  if (request.method === 'GET' && !action) return pageResponse(env, owner, page!);
  if (request.method !== 'POST' || !action) return null;
  if (action === 'delete' || action === 'restore') return trash(env, owner, page!, action, now);
  const data = await input(request); let changed: D1Result;
  if (action === 'title' && !page!.database_config) {
    const result = await env.SYNC.getByName(await roomName(owner, id, page!.sync_generation)).renameTitle({ owner, page: id, generation: page!.sync_generation }, title(data.title), now);
    if (result.status !== 200) fail(result.status, result.message ?? '標題未能保存，請重試');
    return pageResponse(env, owner, (await db.prepare('SELECT * FROM pages WHERE id = ?').bind(id).first<PageRow>())!);
  }
  if (action === 'title') changed = await db.prepare(`${VISIBLE} UPDATE pages SET title = ?, metadata_revision = metadata_revision + 1, updated_at = ? WHERE id = ? AND owner_id = ? AND id IN (SELECT id FROM visible) AND NOT EXISTS (SELECT 1 FROM (SELECT owner_id FROM page_operations UNION SELECT owner_id FROM restore_operations) WHERE owner_id = ?)`)
    .bind(owner, title(data.title), now, id, owner, owner).run();
  else {
    if (!('parent_id' in data)) fail(400, '請選擇移動目標；最上層需明確指定');
    const parentId = parent(data.parent_id);
    changed = await db.prepare(`${VISIBLE}, descendants AS (SELECT id FROM pages WHERE id = ? AND owner_id = ? UNION SELECT child.id FROM pages child JOIN descendants ON child.parent_id = descendants.id)
      UPDATE pages SET parent_id = ?, metadata_revision = metadata_revision + 1, updated_at = ? WHERE id = ? AND owner_id = ? AND kind = 'note' AND id IN (SELECT id FROM visible)
      AND NOT EXISTS (SELECT 1 FROM (SELECT owner_id FROM page_operations UNION SELECT owner_id FROM restore_operations) WHERE owner_id = ?)
      AND (? IS NULL OR (? IN (SELECT id FROM visible WHERE kind = 'note') AND ? NOT IN (SELECT id FROM descendants))) AND (? = 0 OR ? IS NULL OR ? IN (SELECT id FROM visible WHERE database_config IS NULL))`)
      .bind(owner, id, owner, parentId, now, id, owner, owner, parentId, parentId, parentId, page!.database_config ? 1 : 0, parentId, parentId).run();
  }
  if (!changed.meta.changes) fail(409, '上層無效、移動會形成循環，或頁面變更處理中');
  return pageResponse(env, owner, (await db.prepare('SELECT * FROM pages WHERE id = ?').bind(id).first<PageRow>())!);
}
