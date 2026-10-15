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
const json = (v: unknown) =>
  Response.json(v, { headers: { "Cache-Control": "no-store" } });
const fail = (status: number, message: string): never => {
  throw new PageError(status, message);
};
const unlocked = `NOT EXISTS (SELECT 1 FROM page_operations WHERE owner_id = ?) AND NOT EXISTS (SELECT 1 FROM restore_operations WHERE owner_id = ?)`;
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
  const page = await visiblePage(db, owner, match[1]);
  if (!page?.database_config) return fail(404, "找不到資料庫");
  if (request.method === "GET" && !match[2]) {
    const rows = (
      await db
        .prepare(
          `${VISIBLE} SELECT * FROM visible WHERE parent_id = ? AND database_config IS NULL ORDER BY created_at, id`,
        )
        .bind(owner, page.id)
        .all<PageRow>()
    ).results;
    return json({ page, config: readConfig(page.database_config), rows });
  }
  if (request.method !== "POST" || !match[2]) return null;
  const data = await input(request, 256 * 1024);
  if (!validConfig(data.config)) return fail(400, "資料庫設定無效");
  if (data.generation !== page.sync_generation)
    fail(409, "資料庫版本已改變，請重新載入");
  if (data.previous !== page.database_config)
    fail(409, "設定已被其他裝置修改，請重新載入");
  const old = readConfig(page.database_config);
  const rows = (
    await db
      .prepare(
        "SELECT id, property_values FROM pages WHERE parent_id = ? AND owner_id = ?",
      )
      .bind(page.id, owner)
      .all<Pick<PageRow, "id" | "property_values">>()
  ).results;
  for (const p of data.config.properties) {
    const original = old.properties.find((o) => o.id === p.id);
    if (
      rows.some((row) => {
        const value = readValues(row.property_values)[p.id];
        return (
          value !== undefined &&
          value !== null &&
          ((original && original.type !== p.type) || !validValue(p, value))
        );
      })
    )
      fail(409, "欄位已有不相容資料，請新增欄位或保留已使用選項");
  }
  const changed = await db
    .prepare(
      `${VISIBLE} UPDATE pages SET database_config = ?, metadata_revision = metadata_revision + 1, updated_at = ? WHERE id = ? AND owner_id = ? AND id IN (SELECT id FROM visible) AND database_config = ? AND sync_generation = ? AND ${unlocked} AND NOT EXISTS (SELECT 1 FROM pages child LEFT JOIN json_each(?) expected ON json_extract(expected.value, '$.id') = child.id WHERE child.parent_id = ? AND child.owner_id = ? AND (expected.value IS NULL OR child.property_values <> json_extract(expected.value, '$.property_values')))`,
    )
    .bind(
      owner,
      JSON.stringify(data.config),
      now,
      page.id,
      owner,
      data.previous,
      page.sync_generation,
      owner,
      owner,
      JSON.stringify(rows),
      page.id,
      owner,
    )
    .run();
  if (!changed.meta.changes) fail(409, "設定已變更，請重新載入");
  return json(await visiblePage(db, owner, page.id));
}
