import { contentPermission, type ContentCredential } from './mcp-permissions';
import { bytes } from './request';
import { roomName } from '../shared/room';
import { apiKeyOwner, keyHash, keyJson } from './api-keys';
import { handlePages, PageError, visiblePage } from './pages';
import type { AppBlock } from '../shared/block-schema';
import type { SyncedBlockRow } from '../shared/synced-blocks';

type ContentResult = { status: number; message?: string; blocks?: AppBlock[]; etag?: string };
type ExpandedContent = { blocks?: AppBlock[]; etag?: string; status?: number; message?: string };
export const SYNCED_BLOCK_EXPANSION_LIMIT = 8 * 1024 * 1024;

export async function expandSyncedBlocks(ids: string[], read: (id: string) => Promise<ContentResult>, maxBytes = SYNCED_BLOCK_EXPANSION_LIMIT): Promise<Record<string, ExpandedContent>> {
  const expanded: Record<string, ExpandedContent> = Object.create(null);
  const limited = { status: 413, message: '同步內容展開超過 8 MiB 限制，請分別讀取同步區塊' };
  const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  // 預留所有錯誤項目的大小，確保超限時仍能完整標示未展開的引用。
  for (const id of ids) expanded[id] = limited;
  let used = size(expanded); const placeholderBytes = size(limited);
  if (used > maxBytes) throw new RangeError('展開預算不足以表示引用錯誤');
  let exhausted = used === maxBytes;
  for (const id of ids) {
    if (exhausted) continue;
    let entry: ExpandedContent;
    try {
      const result = await read(id);
      entry = result.status === 200 ? { blocks: result.blocks, etag: result.etag } : { status: result.status, message: result.message };
    } catch { entry = { status: 503, message: '同步區塊無法載入，請稍後重試' }; }
    const next = used + size(entry) - placeholderBytes;
    if (next > maxBytes) { exhausted = true; continue; }
    expanded[id] = entry; used = next; exhausted = used === maxBytes;
  }
  return expanded;
}

async function contentInput(request: Request): Promise<{ blocks: unknown; etag: string } | undefined> {
  if (request.method !== 'PUT') return;
  const etag = request.headers.get('If-Match'); if (!etag) throw new PageError(428, '請提供讀取正文時的 If-Match');
  try {
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new Error();
    const value = JSON.parse(new TextDecoder().decode(await bytes(request, 256 * 1024)));
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => k !== 'blocks') || !Array.isArray(value.blocks)) throw new Error();
    return { blocks: value.blocks, etag };
  } catch { throw new PageError(400, '請提供最多 256 KiB 的區塊 JSON'); }
}

async function syncedContent(env: Env, owner: string, id: string, credential: ContentCredential, input?: { blocks: unknown; etag: string }): Promise<ContentResult> {
  const block = await env.DB.prepare('SELECT * FROM synced_blocks WHERE id = ? AND owner_id = ?').bind(id, owner).first<SyncedBlockRow>();
  if (!block) return { status: 404, message: '找不到同步區塊' };
  return env.SYNC.getByName(await roomName(owner, `synced-block:${id}`, block.sync_generation))
    .content({ owner, page: id, generation: block.sync_generation, kind: 'syncedBlock' }, credential, input);
}

function references(blocks: AppBlock[]): string[] {
  const ids = new Set<string>();
  const walk = (list: AppBlock[]) => { for (const block of list) { if (block.type === 'syncedBlock') ids.add(block.props.syncedBlockId); walk(block.children); } };
  walk(blocks); return [...ids];
}

export async function handleContentApi(request: Request, env: Env, now: number): Promise<Response> {
  const authorization = request.headers.get('Authorization') ?? '';
  if (!/^Bearer pn_[a-f0-9]{64}$/.test(authorization)) return keyJson({ message: '請提供有效 API key' }, 401);
  const hash = await keyHash(authorization.slice(7)); const key = await apiKeyOwner(env, hash);
  if (!key) return keyJson({ message: 'API key 無效或已撤銷' }, 401);
  const origin = request.headers.get('Origin');
  if ((origin && origin !== env.BETTER_AUTH_URL) || request.headers.get('Sec-Fetch-Site') === 'cross-site') return keyJson({ message: '來源不允許' }, 403);
  await env.DB.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').bind(now, key.id).run();
  return handleAuthorizedContent(request, env, now, key.owner_id, hash);
}

export async function handleAuthorizedContent(request: Request, env: Env, now: number, owner: string, credential: ContentCredential): Promise<Response> {
  if (!await contentPermission(env, credential, owner, request.method !== 'GET', now)) return keyJson({ message: '存取授權無效或已撤銷' }, 401);
  const url = new URL(request.url); const path = url.pathname.slice('/api/v1'.length);
  const content = path.match(/^\/pages\/([\w-]{1,80})\/content$/);
  const synced = path.match(/^\/synced-blocks\/([\w-]{1,80})\/content$/);
  const isContent = !!(content || synced) && ['GET', 'PUT'].includes(request.method);
  const allowed = request.method === 'GET' ? /^\/(pages(?:\/[\w-]{1,80})?|journals|search)$/.test(path)
    : request.method === 'POST' && /^\/(pages|journal|pages\/[\w-]{1,80}\/(title|icon|move))$/.test(path);
  if (!allowed && !isContent) return keyJson({ message: 'API key 不允許此操作' }, 403);
  if (await env.DB.prepare('SELECT 1 FROM restore_operations WHERE owner_id = ?').bind(owner).first()) throw new PageError(503, '還原處理中，請稍後重試');
  const page = path.match(/^\/pages\/([\w-]{1,80})/);
  if (page && !await visiblePage(env.DB, owner, page[1])) throw new PageError(404, '找不到頁面');
  if (isContent && synced) {
    const result = await syncedContent(env, owner, synced[1], credential, await contentInput(request));
    return Response.json(result.status === 200 ? { blocks: result.blocks } : { message: result.message }, { status: result.status, headers: { 'Cache-Control': 'no-store', ...(result.etag ? { ETag: result.etag } : {}) } });
  }
  if (isContent && content) {
    const current = await visiblePage(env.DB, owner, content[1]);
    if (!current) throw new PageError(404, '找不到頁面');
    const input = await contentInput(request);
    const result = await env.SYNC.getByName(await roomName(owner, current.id, current.sync_generation)).content({ owner: owner, page: current.id, generation: current.sync_generation }, credential, input);
    let expanded: Record<string, ExpandedContent> = Object.create(null);
    if (request.method === 'GET' && result.status === 200 && url.searchParams.get('expandSyncedBlocks') === 'true') {
      // 每個引用獨立回報讀取失敗，不會把未知內容當作空區塊。
      expanded = await expandSyncedBlocks(references(result.blocks ?? []), id => syncedContent(env, owner, id, credential));
    }
    return Response.json(result.status === 200 ? { blocks: result.blocks, ...(request.method === 'GET' && url.searchParams.get('expandSyncedBlocks') === 'true' ? { syncedBlocks: expanded } : {}) } : { message: result.message }, { status: result.status, headers: { 'Cache-Control': 'no-store', ...(result.etag ? { ETag: result.etag } : {}) } });
  }
  url.pathname = '/api' + path;
  return await handlePages(new Request(url, request), env, owner, now) ?? keyJson({ message: '找不到 API' }, 404);
}
