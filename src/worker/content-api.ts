import { contentPermission, type ContentCredential } from './mcp-permissions';
import { bytes } from './request';
import { roomName } from '../shared/room';
import { apiKeyOwner, keyHash, keyJson } from './api-keys';
import { handlePages, PageError, visiblePage } from './pages';

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
  const isContent = !!content && ['GET', 'PUT'].includes(request.method);
  const allowed = request.method === 'GET' ? /^\/(pages(?:\/[\w-]{1,80})?|journals|search)$/.test(path)
    : request.method === 'POST' && /^\/(pages|journal|pages\/[\w-]{1,80}\/(title|icon|move))$/.test(path);
  if (!allowed && !isContent) return keyJson({ message: 'API key 不允許此操作' }, 403);
  if (await env.DB.prepare('SELECT 1 FROM restore_operations WHERE owner_id = ?').bind(owner).first()) throw new PageError(503, '還原處理中，請稍後重試');
  const page = path.match(/^\/pages\/([\w-]{1,80})/);
  if (page && !await visiblePage(env.DB, owner, page[1])) throw new PageError(404, '找不到頁面');
  if (isContent && content) {
    const current = await visiblePage(env.DB, owner, content[1]);
    if (!current) throw new PageError(404, '找不到頁面');
    let input: { blocks: unknown; etag: string } | undefined;
    if (request.method === 'PUT') {
      const etag = request.headers.get('If-Match'); if (!etag) throw new PageError(428, '請提供讀取正文時的 If-Match');
      try {
        if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new Error();
        const value = JSON.parse(new TextDecoder().decode(await bytes(request, 256 * 1024)));
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => k !== 'blocks') || !Array.isArray(value.blocks)) throw new Error();
        input = { blocks: value.blocks, etag };
      } catch { throw new PageError(400, '請提供最多 256 KiB 的區塊 JSON'); }
    }
    const result = await env.SYNC.getByName(await roomName(owner, current.id, current.sync_generation)).content({ owner: owner, page: current.id, generation: current.sync_generation }, credential, input);
    return Response.json(result.status === 200 ? { blocks: result.blocks } : { message: result.message }, { status: result.status, headers: { 'Cache-Control': 'no-store', ...(result.etag ? { ETag: result.etag } : {}) } });
  }
  url.pathname = '/api' + path;
  return await handlePages(new Request(url, request), env, owner, now) ?? keyJson({ message: '找不到 API' }, 404);
}
