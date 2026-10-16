import { prepareRoom } from './storage-cleanup';
import {
  readConfig,
  readValues,
  validConfig,
  validValue,
  initialConfig,
} from "../shared/databases";
import { PageError, visiblePage, VISIBLE } from "./pages";
import { body } from "./request";
import type { PageRow } from "../shared/pages";
import { roomName } from '../shared/room';
import { mergeConfig, sameConfigValue } from './database-config';
const json = (v: unknown) =>
  Response.json(v, { headers: { "Cache-Control": "no-store" } });
const fail = (status: number, message: string): never => {
  throw new PageError(status, message);
};
const unlocked = `NOT EXISTS (SELECT 1 FROM page_operations WHERE owner_id = ?) AND NOT EXISTS (SELECT 1 FROM restore_operations WHERE owner_id = ?)`;
// 只走目標到根節點的祖先鏈；UNION 同時讓損壞的循環結構安全地判定為不可見。
const DATABASE = `WITH RECURSIVE target AS (SELECT * FROM pages WHERE id = ? AND owner_id = ?),
  ancestors(id, owner_id, parent_id, deleted_at) AS (
    SELECT id, owner_id, parent_id, deleted_at FROM target
    UNION SELECT parent.id, parent.owner_id, parent.parent_id, parent.deleted_at
      FROM pages parent JOIN ancestors child ON parent.id = child.parent_id AND parent.owner_id = child.owner_id
  ), visible_database AS (
    SELECT * FROM target WHERE database_config IS NOT NULL
      AND EXISTS (SELECT 1 FROM ancestors WHERE parent_id IS NULL)
      AND NOT EXISTS (SELECT 1 FROM ancestors WHERE deleted_at IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM ancestors JOIN page_operation_members member ON member.page_id = ancestors.id)
      AND NOT EXISTS (SELECT 1 FROM restore_operations WHERE owner_id = target.owner_id)
  )`;
const version = `COALESCE((SELECT revision FROM database_revisions WHERE page_id = visible_database.id), 0) AS database_revision`;
type DatabaseVersion = Pick<PageRow, 'id' | 'sync_generation'> & { database_revision: number };
const tag = (page: DatabaseVersion) => `"database-v1-${page.id}-${page.sync_generation}-${page.database_revision}"`;
const matches = (request: Request, etag: string) => request.headers.get('If-None-Match')?.split(',').some(value => {
  const candidate = value.trim().replace(/^W\//, '');
  return candidate === '*' || candidate === etag;
});
const cacheHeaders = (etag: string) => ({ ETag: etag, 'Cache-Control': 'private, no-cache', Vary: 'Cookie' });
const visibleDatabase = (db: D1Database, owner: string, id: string) =>
  db.prepare(`${DATABASE} SELECT * FROM visible_database`).bind(id, owner).first<PageRow>();

async function readDatabase(request: Request, db: D1Database, owner: string, id: string): Promise<Response> {
  const current = await db.prepare(`${DATABASE} SELECT id, sync_generation, ${version} FROM visible_database`).bind(id, owner).first<DatabaseVersion>();
  if (!current) return fail(404, '找不到資料庫');
  if (matches(request, tag(current))) return new Response(null, { status: 304, headers: cacheHeaders(tag(current)) });
  // 版本與本文必須來自同一交易，避免查詢間的異動讓舊版本標籤配上新資料。
  const [snapshot, children] = await db.batch<PageRow & { database_revision: number }>([
    db.prepare(`${DATABASE} SELECT *, ${version} FROM visible_database`).bind(id, owner),
    db.prepare(`${DATABASE} SELECT child.* FROM pages child JOIN visible_database container
      ON child.parent_id = container.id AND child.owner_id = container.owner_id
      WHERE child.deleted_at IS NULL AND child.database_config IS NULL
        AND NOT EXISTS (SELECT 1 FROM page_operation_members WHERE page_id = child.id)
      ORDER BY child.created_at, child.id`).bind(id, owner),
  ]);
  const result = snapshot.results[0];
  if (!result) return fail(404, '找不到資料庫');
  const etag = tag(result);
  if (matches(request, etag)) return new Response(null, { status: 304, headers: cacheHeaders(etag) });
  const { database_revision: _revision, ...page } = result;
  return Response.json({ page, config: readConfig(page.database_config!), rows: children.results }, { headers: cacheHeaders(etag) });
}
async function input(request: Request, limit = 4096) {
  try { return await body(request, limit); }
  catch { return fail(400, '資料格式無效或內容超過上限'); }
}
export async function handleDatabases(
  request: Request,
  env: Env,
  owner: string,
  now: number,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const db = env.DB;
  if (path === "/api/databases" && request.method === "POST") {
    const data = await input(request);
    if (
      typeof data.title !== "string" ||
      !data.title.trim() ||
      data.title.trim().length > 200
    )
      fail(400, "請提供 1～200 字元標題");
    const parent = data.parent_id ?? null;
    if (
      parent !== null &&
      (typeof parent !== "string" || !/^[\w-]{1,80}$/.test(parent))
    )
      fail(400, "上層無效");
    const id = crypto.randomUUID();
    const result = await db
      .prepare(
        `${VISIBLE} INSERT INTO pages (id, owner_id, kind, title, parent_id, sync_generation, created_at, updated_at, database_config)
      SELECT ?, ?, 'note', ?, ?, ?, ?, ?, ? WHERE ${unlocked} AND (? IS NULL OR ? IN (SELECT id FROM visible WHERE kind = 'note' AND database_config IS NULL))`,
      )
      .bind(
        owner,
        id,
        owner,
        String(data.title).trim().normalize("NFC"),
        parent,
        crypto.randomUUID(),
        now,
        now,
        JSON.stringify(initialConfig()),
        owner,
        owner,
        parent,
        parent,
      )
      .run();
    if (!result.meta.changes) fail(409, "上層無效或頁面變更處理中");
    return json(
      await db
        .prepare("SELECT * FROM pages WHERE id = ?")
        .bind(id)
        .first<PageRow>(),
    );
  }
  const duplicate = path.match(/^\/api\/pages\/([\w-]{1,80})\/duplicate$/);
  if (duplicate && request.method === "POST") {
    const source = await visiblePage(db, owner, duplicate[1]);
    if (!source || source.database_config || !source.parent_id)
      return fail(404, "找不到資料庫筆記");
    const container = await visibleDatabase(db, owner, source.parent_id);
    if (!container) return fail(404, "找不到資料庫");
    const data = await input(request);
    if (data.generation !== source.sync_generation)
      return fail(409, "筆記版本已改變，請重新載入");
    const snapshot = await env.SYNC.getByName(
      await roomName(owner, source.id, source.sync_generation),
    ).capture({ owner, page: source.id, generation: source.sync_generation });
    const id = crypto.randomUUID(),
      generation = crypto.randomUUID();
    const scope = { owner, page: id, generation };
    const room = env.SYNC.getByName(await roomName(owner, id, generation));
    await prepareRoom(env, scope, snapshot.data, 0);
    const result = await db
      .prepare(
        `${VISIBLE} INSERT INTO pages (id, owner_id, kind, title, icon, parent_id, sync_generation, created_at, updated_at, property_values)
      SELECT ?, owner_id, 'note', ?, icon, parent_id, ?, ?, ?, property_values FROM pages
      WHERE id = ? AND owner_id = ? AND sync_generation = ? AND parent_id = ? AND metadata_revision = ? AND id IN (SELECT id FROM visible)
        AND ${unlocked} AND EXISTS (SELECT 1 FROM pages WHERE id = ? AND owner_id = ? AND database_config = ?)`,
      )
      .bind(
        owner,
        id,
        (source.title + " 副本").slice(0, 200),
        generation,
        now,
        now,
        source.id,
        owner,
        source.sync_generation,
        container.id,
        source.metadata_revision,
        owner,
        owner,
        container.id,
        owner,
        container.database_config,
      )
      .run();
    if (!result.meta.changes) return fail(409, "筆記或欄位設定已改變，請重試");
    await room.reindex(scope);
    await room.resume();
    return json(await visiblePage(db, owner, id));
  }
  const properties = path.match(/^\/api\/pages\/([\w-]{1,80})\/properties$/);
  if (properties && request.method === "POST") {
    const page = await visiblePage(db, owner, properties[1]);
    if (!page) return fail(404, "找不到筆記");
    const parent =
      page.parent_id && (await visiblePage(db, owner, page.parent_id));
    if (!parent || !parent.database_config || page.database_config)
      return fail(400, "此筆記不屬於資料庫");
    const data = await input(request, 16 * 1024);
    if (data.generation !== page.sync_generation)
      fail(409, "筆記版本已改變，請重新開啟");
    const p = readConfig(parent.database_config).properties.find(
      (p) => p.id === data.property,
    );
    const isTitle = data.property === "title";
    if (
      isTitle
        ? typeof data.value !== "string" ||
          !data.value.trim() ||
          data.value.trim().length > 200
        : !p || !validValue(p, data.value)
    )
      return fail(400, "欄位值、類型或選項無效");
    if (isTitle) {
      const result = await env.SYNC.getByName(await roomName(owner, page.id, page.sync_generation)).renameTitle(
        { owner, page: page.id, generation: page.sync_generation }, String(data.value).trim().normalize('NFC'), now,
        { parent: parent.id, config: parent.database_config },
      );
      if (result.status !== 200) fail(result.status, result.message ?? '欄位設定或筆記狀態已改變，請重新載入');
      return json(await visiblePage(db, owner, page.id));
    }
    // 明確比對設定與原始歸屬，避免移動或刪欄位競爭把舊值寫回。
    const changed = await db
      .prepare(
        `${VISIBLE} UPDATE pages SET ${isTitle ? "title = ?" : "property_values = json_set(property_values, ?, json(?))"}, metadata_revision = metadata_revision + 1, updated_at = ?
      WHERE id = ? AND owner_id = ? AND id IN (SELECT id FROM visible) AND parent_id = ? AND sync_generation = ? AND ${unlocked}
      AND EXISTS (SELECT 1 FROM pages container WHERE container.id = ? AND container.owner_id = ? AND container.database_config = ?)`,
      )
      .bind(
        owner,
        ...(isTitle
          ? [String(data.value).trim().normalize("NFC")]
          : ['$."' + p!.id + '"', JSON.stringify(data.value)]),
        now,
        page.id,
        owner,
        parent.id,
        page.sync_generation,
        owner,
        owner,
        parent.id,
        owner,
        parent.database_config,
      )
      .run();
    if (!changed.meta.changes)
      fail(409, "欄位設定或筆記狀態已改變，請重新載入");
    return json(await visiblePage(db, owner, page.id));
  }
  const match = path.match(/^\/api\/databases\/([\w-]{1,80})(?:\/(config))?$/);
  if (!match) return null;
  if (request.method === "GET" && !match[2]) return readDatabase(request, db, owner, match[1]);
  let page = await visibleDatabase(db, owner, match[1]);
  if (!page?.database_config) return fail(404, "找不到資料庫");
  if (request.method !== "POST" || !match[2]) return null;
  const data = await input(request, 256 * 1024);
  if (!validConfig(data.config)) return fail(400, "資料庫設定無效");
  let previous;
  try { previous = typeof data.previous === 'string' ? readConfig(data.previous) : null; }
  catch { previous = null; }
  if (!previous) return fail(409, '原始設定無效，請重新載入');
  for (let attempt = 0; attempt < 4; attempt++) {
    if (!page?.database_config || data.generation !== page.sync_generation)
      return fail(409, '資料庫版本已改變，請重新載入');
    const current = readConfig(page.database_config);
    const merged = mergeConfig(previous, current, data.config);
    if (!merged) return fail(409, '設定已被其他裝置修改，請重新載入');
    const propertiesChanged = !sameConfigValue(current.properties, merged.properties);
    const rows = propertiesChanged ? (await db.prepare('SELECT id, title, deleted_at, property_values FROM pages WHERE parent_id = ? AND owner_id = ?')
      .bind(page.id, owner).all<Pick<PageRow, 'id' | 'title' | 'deleted_at' | 'property_values'>>()).results : [];
    for (const property of merged.properties) {
      const original = current.properties.find(item => item.id === property.id);
      const conflicts = rows.filter(row => {
        const value = readValues(row.property_values)[property.id];
        return value !== undefined && value !== null && ((original && original.type !== property.type) || !validValue(property, value));
      });
      if (conflicts.length) {
        const hidden = conflicts.find(row => row.deleted_at !== null);
        if (hidden && conflicts.every(row => row.deleted_at !== null)) return fail(409, `垃圾桶中的筆記「${hidden.title}」仍有此欄資料，請先還原檢查、另建欄位或保留已使用選項`);
        return fail(409, '欄位已有不相容資料，請新增欄位或保留已使用選項');
      }
    }
    const changed = await db.prepare(`${DATABASE} UPDATE pages SET database_config = ?, metadata_revision = metadata_revision + 1, updated_at = ?
      WHERE id = ? AND owner_id = ? AND id IN (SELECT id FROM visible_database)
        AND database_config = ? AND sync_generation = ? AND ${unlocked}
        ${propertiesChanged ? `AND NOT EXISTS (SELECT 1 FROM pages child LEFT JOIN json_each(?) expected ON json_extract(expected.value, '$.id') = child.id
          WHERE child.parent_id = ? AND child.owner_id = ? AND (expected.value IS NULL OR child.property_values <> json_extract(expected.value, '$.property_values')))` : ''}`)
      .bind(page.id, owner, JSON.stringify(merged), now, page.id, owner, page.database_config, page.sync_generation, owner, owner,
        ...(propertiesChanged ? [JSON.stringify(rows), page.id, owner] : [])).run();
    if (changed.meta.changes) return json(await visibleDatabase(db, owner, page.id));
    // 原子比較失敗時重讀並再合併，讓同時修改不同檢視的請求也能成功。
    page = await visibleDatabase(db, owner, match[1]);
  }
  return fail(409, '設定已變更，請重新載入');
}
