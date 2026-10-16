import { roomName } from '../shared/room';

export type CleanupScope = { owner: string; page: string; generation: string; kind?: 'syncedBlock' };
// 先登記再準備物件，跨儲存失敗或程序中斷後仍能回收；寬限期避免刪除尚未發布的候選。
export function queueCleanup(env: Env, owner: string, kind: 'asset' | 'version' | 'room', key: string, now = Date.now()) {
  return env.DB.prepare('INSERT OR IGNORE INTO storage_cleanup (owner_id, kind, object_key, not_before) VALUES (?, ?, ?, ?)')
    .bind(owner, kind, key, now + 3600000).run();
}
export async function prepareRoom(env: Env, scope: CleanupScope, data: Uint8Array, checkpoint: number) {
  await queueCleanup(env, scope.owner, 'room', JSON.stringify(scope));
  const name = await roomName(scope.owner, scope.kind ? `synced-block:${scope.page}` : scope.page, scope.generation);
  await env.SYNC.getByName(name).prepare(scope, data, checkpoint);
}
export async function cleanupStorage(env: Env, now: number) {
  // 成功發布的候選不再需要回收；一次移除，避免大量正常版本把真正孤兒擋在配額之外。
  await env.DB.batch(['version', 'asset', 'room'].map(kind => {
    const referenced = kind === 'room'
      ? `(EXISTS (SELECT 1 FROM pages WHERE id = json_extract(storage_cleanup.object_key, '$.page') AND owner_id = storage_cleanup.owner_id AND sync_generation = json_extract(storage_cleanup.object_key, '$.generation') AND json_extract(storage_cleanup.object_key, '$.kind') IS NULL)
          OR EXISTS (SELECT 1 FROM synced_blocks WHERE id = json_extract(storage_cleanup.object_key, '$.page') AND owner_id = storage_cleanup.owner_id AND sync_generation = json_extract(storage_cleanup.object_key, '$.generation') AND json_extract(storage_cleanup.object_key, '$.kind') = 'syncedBlock'))`
      : `EXISTS (SELECT 1 FROM ${kind === 'asset' ? 'assets' : 'page_versions'} WHERE object_key = storage_cleanup.object_key)`;
    return env.DB.prepare(`DELETE FROM storage_cleanup WHERE kind = ? AND ${referenced}
      AND NOT EXISTS (SELECT 1 FROM restore_operations WHERE owner_id = storage_cleanup.owner_id)
      AND NOT EXISTS (SELECT 1 FROM page_history_restores WHERE owner_id = storage_cleanup.owner_id)`).bind(kind);
  }));
  const rows = (await env.DB.prepare('SELECT * FROM storage_cleanup WHERE not_before <= ? ORDER BY not_before LIMIT 1000').bind(now)
    .all<{ owner_id: string; kind: 'asset' | 'version' | 'room'; object_key: string }>()).results;
  for (const row of rows) {
    // 還原中的候選需要保留供相同操作重試。
    if (await env.DB.prepare('SELECT 1 FROM restore_operations WHERE owner_id = ? UNION ALL SELECT 1 FROM page_history_restores WHERE owner_id = ?').bind(row.owner_id, row.owner_id).first()) continue;
    if (row.kind === 'room') {
      const scope = JSON.parse(row.object_key) as CleanupScope;
      const name = await roomName(scope.owner, scope.kind ? `synced-block:${scope.page}` : scope.page, scope.generation);
      if (!await env.SYNC.getByName(name).discard(scope)) continue;
    } else {
      const table = row.kind === 'asset' ? 'assets' : 'page_versions';
      if (!await env.DB.prepare(`SELECT 1 FROM ${table} WHERE object_key = ?`).bind(row.object_key).first()) {
        await (row.kind === 'asset' ? env.ASSETS : env.BACKUPS).delete(row.object_key);
      }
    }
    await env.DB.prepare('DELETE FROM storage_cleanup WHERE kind = ? AND object_key = ?').bind(row.kind, row.object_key).run();
  }
}
