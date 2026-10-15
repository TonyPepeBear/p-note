import { IMAGE_LIMIT, IMAGE_RULE, IMAGE_TYPES, imageType } from '../shared/image';
import { ASSET_PAGE_SIZE, type AssetList, type AssetSummary } from '../shared/assets';
import { PageError } from './pages';

type Asset = { id: string; object_key: string; original_name: string; mime_type: string; byte_size: number; checksum: string };
const fail = (status: number, message = IMAGE_RULE): never => { throw new PageError(status, message); };

function positiveParameter(params: URLSearchParams, name: string, fallback: number): number {
  const values = params.getAll(name);
  if (!values.length) return fallback;
  const value = Number(values[0]);
  if (values.length !== 1 || !/^[1-9]\d*$/.test(values[0]) || !Number.isSafeInteger(value)) fail(400, '無效分頁參數');
  return value;
}

async function readImage(request: Request): Promise<Uint8Array> {
  const length = request.headers.get('Content-Length');
  if (length && (!/^\d+$/.test(length) || Number(length) > IMAGE_LIMIT)) fail(413);
  if (!request.body) fail(400);
  const reader = request.body!.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length; if (size > IMAGE_LIMIT) fail(413);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof PageError) throw error;
    return fail(400, '圖片上傳中斷，請重試完整檔案');
  } finally { reader.releaseLock(); }
  if (!size || (length && Number(length) !== size)) fail(400);
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function handleAssets(request: Request, env: Env, owner: string, now: number): Promise<Response | null> {
  const url = new URL(request.url); const path = url.pathname;
  if (path === '/api/assets' && request.method === 'GET') {
    const page = positiveParameter(url.searchParams, 'page', 1);
    const pageSize = positiveParameter(url.searchParams, 'page_size', ASSET_PAGE_SIZE);
    if (pageSize > 100) fail(400, '每頁圖片數須介於 1～100');
    const offset = (page - 1) * pageSize;
    if (!Number.isSafeInteger(offset)) fail(400, '無效分頁參數');
    const results = await env.DB.batch([
      env.DB.prepare('SELECT COUNT(*) AS total FROM assets WHERE owner_id = ?').bind(owner),
      env.DB.prepare('SELECT id, original_name, mime_type, byte_size, created_at FROM assets WHERE owner_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?').bind(owner, pageSize, offset),
    ]);
    const total = (results[0].results as { total: number }[])[0].total;
    const items = (results[1].results as Omit<AssetSummary, 'url'>[]).map(asset => ({ ...asset, url: `/api/assets/${asset.id}` }));
    const result: AssetList = { items, page, page_size: pageSize, total, total_pages: Math.ceil(total / pageSize) };
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  }
  if (path === '/api/assets' && request.method === 'POST') {
    const mime = request.headers.get('Content-Type')?.toLowerCase() ?? '';
    if (!IMAGE_TYPES.includes(mime)) fail(415);
    let name: string;
    try { name = decodeURIComponent(request.headers.get('X-File-Name') ?? '圖片'); } catch { return fail(400, '無效圖片檔名'); }
    if (!name.trim() || name.length > 255 || /[\x00-\x1f\x7f]/.test(name)) fail(400, '圖片檔名須為 1～255 字元且不含控制字元');
    const bytes = await readImage(request); if (imageType(bytes) !== mime) fail(415);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const checksum = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
    const id = crypto.randomUUID(); const key = `${owner}/${id}`;
    const object = await env.ASSETS.put(key, bytes, { onlyIf: { etagDoesNotMatch: '*' }, sha256: digest, httpMetadata: { contentType: mime } });
    if (!object) fail(503, '圖片上傳失敗，請重試');
    // D1 失敗時保留未引用原檔，避免跨儲存補償誤刪可恢復資料。
    await env.DB.prepare('INSERT INTO assets (id, owner_id, object_key, original_name, mime_type, byte_size, checksum, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, owner, key, name, mime, bytes.length, checksum, now).run();
    return Response.json({ id, url: `/api/assets/${id}`, mime_type: mime, byte_size: bytes.length, checksum }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  }
  const match = path.match(/^\/api\/assets\/([\w-]{1,80})$/);
  if (!match || request.method !== 'GET') return null;
  const asset = await env.DB.prepare('SELECT * FROM assets WHERE id = ? AND owner_id = ?').bind(match[1], owner).first<Asset>();
  if (!asset) fail(404, '找不到圖片');
  const object = await env.ASSETS.get(asset!.object_key);
  if (!object || object.size !== asset!.byte_size) fail(503, '圖片原檔暫時無法讀取，請重試');
  return new Response(object!.body, { headers: {
    'Content-Type': asset!.mime_type, 'Content-Length': String(asset!.byte_size), 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(asset!.original_name)}`,
  } });
}
