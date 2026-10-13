import type { AssetRow, BackupCatalog, BackupFile, BackupManifest } from '../shared/backup';
import type { PageRow } from '../shared/pages';
import { IMAGE_LIMIT } from '../shared/image';
import { roomName } from '../shared/room';
import { PageError } from './pages';
import { validateManifest } from './backup-validation';
import { exportBackup } from './backup-export';
import { body } from './request';

export const BACKUP_RETENTION = 90 * 86400000;
type StoredBackup = BackupCatalog & { owner_id: string; manifest_checksum: string | null; manifest_size: number | null };
const headers = { 'Cache-Control': 'no-store' };
const fail = (): never => { throw new PageError(503, '備份未完成或校驗失敗，原成功備份保留'); };
export async function checksum(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
}

async function writeFile(env: Env, prefix: string, path: string, bytes: Uint8Array): Promise<BackupFile> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
  if (!await env.BACKUPS.put(prefix + path, bytes, { onlyIf: { etagDoesNotMatch: '*' }, sha256: digest })) fail();
  const file = { path, byte_size: bytes.length, checksum: hash };
  await readFile(env, prefix, file); return file;
}

export async function readFile(env: Env, prefix: string, file: BackupFile): Promise<Uint8Array> {
  const object = await env.BACKUPS.get(prefix + file.path);
  if (!object || object.size !== file.byte_size) return fail();
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (await checksum(bytes) !== file.checksum) return fail(); return bytes;
}

export async function createBackup(env: Env, owner: string, now: () => number | Promise<number>, restore?: string): Promise<BackupCatalog> {
  if (await env.DB.prepare("SELECT 1 FROM restore_operations WHERE owner_id = ? AND (id <> ? OR phase <> 'paused')").bind(owner, restore ?? '').first()) fail();
  const id = crypto.randomUUID(); const started = await now(); const prefix = `${owner}/${id}/`;
  await env.DB.prepare("INSERT INTO backups (id, owner_id, status, started_at) VALUES (?, ?, 'pending', ?)").bind(id, owner, started).run();
  try {
    if (await env.DB.prepare('SELECT 1 FROM page_operations WHERE owner_id = ?').bind(owner).first()) fail();
    const rows = await env.DB.batch([
      env.DB.prepare('SELECT * FROM pages WHERE owner_id = ? ORDER BY id').bind(owner),
      env.DB.prepare('SELECT * FROM assets WHERE owner_id = ? ORDER BY id').bind(owner),
    ]);
    const pages = rows[0].results as PageRow[]; const assets = rows[1].results as AssetRow[];
    const manifest: Omit<BackupManifest, 'completed_at'> = { format: 'p-note-backup', version: 1, id, owner: { id: owner }, started_at: started, captured_until: started, pages: [], assets: [] };
    for (const page of pages) {
      const snapshot = await env.SYNC.getByName(await roomName(owner, page.id, page.sync_generation)).capture({ owner, page: page.id, generation: page.sync_generation });
      if (snapshot.generation !== page.sync_generation) fail();
      const file = await writeFile(env, prefix, `pages/${page.id}.yjs`, snapshot.data);
      manifest.pages.push({ metadata: page, checkpoint: snapshot.checkpoint, captured_at: snapshot.capturedAt, file });
    }
    for (const asset of assets) {
      const object = await env.ASSETS.get(asset.object_key);
      if (!object || object.size !== asset.byte_size || object.size > IMAGE_LIMIT) return fail();
      const bytes = new Uint8Array(await object.arrayBuffer()); if (await checksum(bytes) !== asset.checksum) fail();
      manifest.assets.push({ metadata: asset, file: await writeFile(env, prefix, `assets/${asset.id}`, bytes) });
    }
    const current = (await env.DB.prepare('SELECT id, sync_generation FROM pages WHERE owner_id = ?').bind(owner).all<Pick<PageRow, 'id' | 'sync_generation'>>()).results;
    const generations = new Map(current.map(page => [page.id, page.sync_generation]));
    if (pages.some(page => generations.get(page.id) !== page.sync_generation)
      || await env.DB.prepare('SELECT 1 FROM page_operations WHERE owner_id = ?').bind(owner).first()) fail();
    manifest.captured_until = await now();
    const encoded = new TextEncoder().encode(JSON.stringify(manifest));
    const file = await writeFile(env, prefix, 'manifest.json', encoded);
    // 目錄只在全部副本與清單校驗後發布；部分物件留待該備份到期清理。
    const completed = await now();
    validateManifest({ ...manifest, completed_at: completed });
    const published = await env.DB.prepare(`UPDATE backups SET status = 'success', completed_at = ?, manifest_checksum = ?, manifest_size = ?
      WHERE id = ? AND owner_id = ? AND status = 'pending'
      AND NOT EXISTS (SELECT 1 FROM page_operations WHERE owner_id = backups.owner_id)
      AND NOT EXISTS (SELECT 1 FROM restore_operations WHERE owner_id = backups.owner_id AND (id <> ? OR phase <> 'paused'))
      AND NOT EXISTS (SELECT 1 FROM json_each(?) AS expected LEFT JOIN pages
        ON pages.id = json_extract(expected.value, '$.id') AND pages.owner_id = backups.owner_id
        WHERE pages.id IS NULL OR pages.sync_generation <> json_extract(expected.value, '$.sync_generation'))`)
      .bind(completed, file.checksum, file.byte_size, id, owner, restore ?? '', JSON.stringify(pages.map(page => ({ id: page.id, sync_generation: page.sync_generation })))).run();
    if (!published.meta.changes) fail();
    return { id, status: 'success', started_at: started, completed_at: completed, error: null };
  } catch {
    await env.DB.prepare("UPDATE backups SET status = 'failed', error = ? WHERE id = ? AND status = 'pending'").bind('擷取或校驗失敗，原成功備份保留', id).run().catch(() => {});
    return fail();
  }
}

export async function readManifest(env: Env, owner: string, id: string, now: number, operation?: string): Promise<BackupManifest> {
  const row = await env.DB.prepare(`SELECT * FROM backups WHERE id = ? AND owner_id = ? AND status = 'success'
    AND (completed_at > ? OR EXISTS (SELECT 1 FROM restore_operations WHERE id = ? AND owner_id = backups.owner_id AND backup_id = backups.id))`)
    .bind(id, owner, now - BACKUP_RETENTION, operation ?? '').first<StoredBackup>();
  if (!row) throw new PageError(404, '找不到有效成功備份');
  const bytes = await readFile(env, `${owner}/${id}/`, { path: 'manifest.json', byte_size: row.manifest_size!, checksum: row.manifest_checksum! });
  let manifest: Omit<BackupManifest, 'completed_at'>;
  try { manifest = JSON.parse(new TextDecoder().decode(bytes)) as Omit<BackupManifest, 'completed_at'>; } catch { return fail(); }
  if (!manifest || manifest.format !== 'p-note-backup' || manifest.version !== 1 || manifest.id !== id || manifest.owner?.id !== owner
    || manifest.started_at !== row.started_at || !Number.isSafeInteger(manifest.captured_until)
    || manifest.captured_until < manifest.started_at || manifest.captured_until > row.completed_at! || !Array.isArray(manifest.pages) || !Array.isArray(manifest.assets)) fail();
  const complete = { ...manifest, completed_at: row.completed_at! }; validateManifest(complete); return complete;
}

export async function cleanupBackups(env: Env, now: number): Promise<void> {
  const expired = (await env.DB.prepare(`SELECT id, owner_id FROM backups WHERE (status = 'expiring'
    OR (status = 'success' AND completed_at <= ?) OR (status IN ('pending', 'failed') AND started_at <= ?))
    AND NOT EXISTS (SELECT 1 FROM restore_operations WHERE backup_id = backups.id OR rollback_id = backups.id)`)
    .bind(now - BACKUP_RETENTION, now - BACKUP_RETENTION).all<{ id: string; owner_id: string }>()).results;
  for (const row of expired) {
    const marked = await env.DB.prepare(`UPDATE backups SET status = 'expiring' WHERE id = ?
      AND (status = 'expiring' OR (status = 'success' AND completed_at <= ?) OR (status IN ('pending', 'failed') AND started_at <= ?))
      AND NOT EXISTS (SELECT 1 FROM restore_operations WHERE backup_id = backups.id OR rollback_id = backups.id)`)
      .bind(row.id, now - BACKUP_RETENTION, now - BACKUP_RETENTION).run();
    if (!marked.meta.changes) continue;
    while (true) {
      const objects = await env.BACKUPS.list({ prefix: `${row.owner_id}/${row.id}/`, limit: 1000 });
      if (!objects.objects.length) break;
      await env.BACKUPS.delete(objects.objects.map(object => object.key));
    }
    await env.DB.prepare("DELETE FROM backups WHERE id = ? AND status = 'expiring'").bind(row.id).run();
  }
  await env.DB.prepare('DELETE FROM completed_restores WHERE completed_at <= ?').bind(now - BACKUP_RETENTION).run();
}

export async function handleBackups(request: Request, env: Env, owner: string, now: () => number, ctx?: ExecutionContext): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === '/api/backups') {
    if (request.method === 'POST') return Response.json(await createBackup(env, owner, now), { status: 201, headers });
    if (request.method === 'GET') {
      const backups = (await env.DB.prepare(`SELECT id, status, started_at, completed_at, error FROM backups WHERE owner_id = ?
        AND (status <> 'success' OR completed_at > ? OR EXISTS (SELECT 1 FROM restore_operations WHERE backup_id = backups.id OR rollback_id = backups.id)) ORDER BY COALESCE(completed_at, started_at) DESC, rowid DESC`)
        .bind(owner, now() - BACKUP_RETENTION).all<BackupCatalog>()).results;
      const restore = await env.DB.prepare('SELECT id, backup_id, phase FROM restore_operations WHERE owner_id = ?').bind(owner).first();
      return Response.json({ backups, latest: backups.find(row => row.status === 'success')?.id ?? null, restore }, { headers });
    }
  }
  const match = path.match(/^\/api\/backups\/([\w-]{1,80})\/manifest$/);
  if (match && request.method === 'GET') return Response.json(await readManifest(env, owner, match[1], now()), { headers });
  const download = path.match(/^\/api\/backups\/([\w-]{1,80})\/export$/);
  if (download && request.method === 'GET') return exportBackup(env, await readManifest(env, owner, download[1], now()), ctx);
  const restore = path.match(/^\/api\/backups\/([\w-]{1,80})\/restore$/);
  if (restore && request.method === 'POST') {
    const data = await body(request);
    if (data.request_id !== undefined && (typeof data.request_id !== 'string' || !/^[\w-]{1,80}$/.test(data.request_id))) throw new PageError(400, '無效還原請求識別');
    const operation = await env.DB.prepare('SELECT id, backup_id FROM restore_operations WHERE owner_id = ?').bind(owner).first<{ id: string; backup_id: string }>();
    if (operation && operation.backup_id !== restore[1]) throw new PageError(409, '另一還原處理中，請重試原備份');
    if (operation && data.request_id !== undefined && data.request_id !== operation.id) throw new PageError(409, '請重試原還原請求');
    const id = typeof data.request_id === 'string' ? data.request_id : operation?.id ?? crypto.randomUUID();
    const completed = await env.DB.prepare('SELECT backup_id FROM completed_restores WHERE id = ? AND owner_id = ?').bind(id, owner).first<{ backup_id: string }>();
    if (completed && completed.backup_id !== restore[1]) throw new PageError(409, '還原請求識別已用於其他備份');
    if (!completed) await readManifest(env, owner, restore[1], now(), operation?.id);
    return Response.json(await env.RESTORES.getByName(owner).run(owner, restore[1], id), { headers });
  }
  return null;
}
