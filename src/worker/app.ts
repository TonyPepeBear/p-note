import { handleKeys } from './api-keys';
import { handleOAuth, handleConnections, oauthPath } from './oauth';
import { oauthReturnTo } from '../shared/oauth';
import { handleDatabases } from './databases';
import { handleContentApi } from './content-api';
import { routePartykitRequest } from 'partyserver';
import { ProbeRoom } from './index';
import { SyncRoom } from './sync-room';
import { configured, createAuth, sessionFor, tokenIdentifier } from './auth';
import { roomName } from '../shared/room';
import { handlePages, visiblePage, PageError } from './pages';
import type { PageRow } from '../shared/pages';
import { body } from './request';
import { handleAssets } from './assets';
import { sendLoginMail } from './mail';
import { cleanupBackups, createBackup, handleBackups } from './backups';
import { RestoreCoordinator } from './restore';
import { handleSyncedBlocks, syncedBlockInfo } from './synced-blocks';
import { handleHistory } from './history';

export { ProbeRoom, SyncRoom, RestoreCoordinator };

export type Services = {
  now: () => number;
  sendMail: (email: string, url: string) => Promise<void>;
};

const error = (message: string, status: number) => Response.json({ message }, { status, headers: { 'Cache-Control': 'no-store' } });

export async function handle(request: Request, env: Env, services: Services = { now: Date.now, sendMail: (email, url) => sendLoginMail(env, email, url) }, ctx?: ExecutionContext): Promise<Response> {
  const url = new URL(request.url); const path = url.pathname;
  if (oauthPath(path)) {
    if (!configured(env) || !ctx) return error('授權服務設定不完整', 503);
    try { return await handleOAuth(request, env, services, ctx); }
    catch { return error('授權服務暫時無法完成', 503); }
  }
  if (path === '/health') return new Response('ok');
  if (path === '/login/confirm' && request.method === 'GET') return new Response('請在網站按下確認登入', { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  if (!path.startsWith('/api/') && !path.startsWith('/parties/sync/')) return new Response('Not found', { status: 404 });
  if (path.startsWith('/api/auth/')) return new Response('Not found', { status: 404 });
  if (!configured(env)) return error('登入設定不完整', 503);
  if (path.startsWith('/api/v1/')) {
    try { return await handleContentApi(request, env, services.now()); }
    catch (failure) { return error(failure instanceof PageError ? failure.message : '服務暫時無法完成，請稍後重試', failure instanceof PageError ? failure.status : 503); }
  }
  if (request.headers.has('Authorization')) return error('此入口僅限網站登入', 401);
  const origin = request.headers.get('Origin');
  if ((origin && origin !== env.BETTER_AUTH_URL) || (request.method !== 'GET' && origin !== env.BETTER_AUTH_URL)
    || request.headers.get('Sec-Fetch-Site') === 'cross-site') return error('來源不允許', 403);
  try {
    if (path === '/api/login' && request.method === 'POST') {
      let value: Record<string, unknown>;
      try { value = await body(request); } catch { return error('請輸入有效 Email', 400); }
      if (typeof value.email !== 'string') return error('請輸入有效 Email', 400);
      const returnTo = oauthReturnTo(value.returnTo);
      if (value.returnTo !== undefined && !returnTo) return error('無效的登入返回路徑', 400);
      const email = value.email.trim().toLowerCase();
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error('請輸入有效 Email', 400);
      const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'; const now = services.now();
      const results = await env.DB.batch([
        env.DB.prepare('DELETE FROM auth_requests WHERE requested_at <= ?').bind(now - 900000),
        env.DB.prepare(`INSERT INTO auth_requests SELECT ?, ?, ? WHERE
          (SELECT count(*) FROM auth_requests WHERE email = ?) < 5 AND
          NOT EXISTS (SELECT 1 FROM auth_requests WHERE email = ? AND requested_at > ?) AND
          (SELECT count(*) FROM auth_requests WHERE ip = ?) < 20`).bind(email, ip, now, email, email, now - 60000, ip),
      ]);
      if (!results[1].meta.changes) return error('申請太頻繁，請稍後重試', 429);
      if (email === env.OWNER_EMAIL.toLowerCase()) await createAuth(env, returnTo ? { ...services, sendMail: (recipient, link) => {
        const target = new URL(link); target.searchParams.set('returnTo', returnTo);
        return services.sendMail(recipient, target.toString());
      } } : services).api.signInMagicLink({ headers: request.headers, body: { email } });
      return Response.json({ message: '若此 Email 可登入，請查看登入郵件' }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (path === '/api/confirm' && request.method === 'POST') {
      let value: Record<string, unknown>;
      try { value = await body(request); } catch { return error('連結無效或已過期，請重新申請', 400); }
      if (typeof value.token !== 'string' || !/^[A-Za-z]{32}$/.test(value.token)) return error('連結無效或已過期，請重新申請', 400);
      const identifier = await tokenIdentifier(value.token);
      const pending = await env.DB.prepare('SELECT expiresAt FROM verification WHERE identifier = ?').bind(identifier).first<{ expiresAt: string }>();
      if (!pending || new Date(pending.expiresAt).getTime() <= services.now()) {
        await env.DB.prepare('DELETE FROM verification WHERE identifier = ?').bind(identifier).run();
        return error('連結無效或已過期，請重新申請', 400);
      }
      const response = await createAuth(env, services).api.magicLinkVerify({ headers: request.headers, query: { token: value.token }, asResponse: true });
      if (response.status !== 200) return error('連結無效或已過期，請重新申請', 400);
      const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      for (const cookie of response.headers.getSetCookie()) headers.append('Set-Cookie', cookie);
      return new Response(JSON.stringify({ ok: true }), { headers });
    }
    const session = await sessionFor(request, env, services);
    if (!session) return error('登入已到期，請重新登入', 401);
    if (path === '/api/session' && request.method === 'GET') return Response.json({ user: { id: session.user.id, email: session.user.email }, expiresAt: session.session.expiresAt }, { headers: { 'Cache-Control': 'no-store' } });
    if (path === '/api/logout' && request.method === 'POST') {
      const response = await createAuth(env, services).api.signOut({ headers: request.headers, asResponse: true });
      response.headers.set('Cache-Control', 'no-store');
      return response;
    }
    const keysResponse = await handleKeys(request, env, session.user.id, services.now());
    if (keysResponse) return keysResponse;
    const connectionsResponse = await handleConnections(request, env, session.user.id, services);
    if (connectionsResponse) return connectionsResponse;
    if (!path.startsWith('/api/backups') && await env.DB.prepare('SELECT 1 FROM restore_operations WHERE owner_id = ?').bind(session.user.id).first()) return error('還原處理中，請重試原備份', 503);
    if (path !== '/api/history-restore' && !/^\/api\/pages\/[\w-]{1,80}\/history(?:\/|$)/.test(path) && await env.DB.prepare('SELECT 1 FROM page_history_restores WHERE owner_id = ?').bind(session.user.id).first()) return error('版本還原處理中，請重試原版本', 503);
    const historyResponse = await handleHistory(request, env, session.user.id);
    if (historyResponse) return historyResponse;
    const backupResponse = await handleBackups(request, env, session.user.id, services.now, ctx);
    if (backupResponse) return backupResponse;
    const assetResponse = await handleAssets(request, env, session.user.id, services.now());
    if (assetResponse) return assetResponse;
    const databaseResponse = await handleDatabases(request, env, session.user.id, services.now());
    if (databaseResponse) return databaseResponse;
    const syncedBlockResponse = await handleSyncedBlocks(request, env, session.user.id, services.now());
    if (syncedBlockResponse) return syncedBlockResponse;
    const pageResponse = await handlePages(request, env, session.user.id, services.now());
    if (pageResponse) return pageResponse;
    if (path.startsWith('/parties/sync/')) {
      const blockId = url.searchParams.get('syncedBlock');
      if (blockId !== null) {
        const block = await syncedBlockInfo(env, session.user.id, blockId);
        if (!block) return error('找不到同步區塊', 404);
        const page = url.searchParams.get('page'); const referencePage = page && await visiblePage(env.DB, session.user.id, page);
        if (!referencePage || referencePage.sync_generation !== url.searchParams.get('pageGeneration')) return error('引用頁面世代已改變，本機內容已隔離', 409);
        const reference = await env.SYNC.getByName(await roomName(session.user.id, referencePage.id, referencePage.sync_generation))
          .hasSyncedBlockReference({ owner: session.user.id, page: referencePage.id, generation: referencePage.sync_generation }, block.id);
        if (!reference || block.sync_generation !== url.searchParams.get('generation')) return error('同步區塊引用或世代已改變，本機內容已隔離', 409);
        if (path !== `/parties/sync/${block.room}`) return error('無效房間', 403);
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket' || origin !== env.BETTER_AUTH_URL) return error('無效同步請求', 400);
        const headers = new Headers(request.headers);
        for (const name of [...headers.keys()]) if (name.startsWith('x-partykit-') || name.startsWith('x-p-note-')) headers.delete(name);
        headers.set('x-p-note-session', session.session.id); headers.set('x-p-note-owner', session.user.id);
        headers.set('x-p-note-page', block.id); headers.set('x-p-note-generation', block.sync_generation);
        headers.set('x-p-note-kind', 'syncedBlock'); headers.set('x-p-note-reference-page', page!);
        headers.set('x-p-note-reference-generation', referencePage.sync_generation);
        return await routePartykitRequest(new Request(request, { headers }), env) ?? error('找不到房間', 404);
      }
      const page = await env.DB.prepare('SELECT * FROM pages WHERE id = ? AND owner_id = ?').bind(url.searchParams.get('page'), session.user.id).first<PageRow>();
      if (!page) return error('找不到頁面', 404);
      if (!await visiblePage(env.DB, session.user.id, page.id) || page.sync_generation !== url.searchParams.get('generation')) return error('頁面狀態已改變，本機內容已隔離', 409);
      if (path !== `/parties/sync/${await roomName(session.user.id, page.id, page.sync_generation)}`) return error('無效房間', 403);
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket' || origin !== env.BETTER_AUTH_URL) return error('無效同步請求', 400);
      const headers = new Headers(request.headers);
      for (const name of [...headers.keys()]) if (name.startsWith('x-partykit-') || name.startsWith('x-p-note-')) headers.delete(name);
      headers.set('x-p-note-session', session.session.id); headers.set('x-p-note-owner', session.user.id);
      headers.set('x-p-note-page', page.id); headers.set('x-p-note-generation', page.sync_generation);
      return await routePartykitRequest(new Request(request, { headers }), env) ?? error('找不到房間', 404);
    }
    return new Response('Not found', { status: 404 });
  } catch (failure) { return error(failure instanceof PageError ? failure.message : '服務暫時無法完成，請稍後重試', failure instanceof PageError ? failure.status : 503); }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url); const path = url.pathname;
    if (oauthPath(path) || path.startsWith('/api/') || path.startsWith('/parties/') || path === '/health') return handle(request, env, undefined, ctx);
    if (path.startsWith('/__test') || path === '/probe' || !['GET', 'HEAD'].includes(request.method)) return new Response('Not found', { status: 404 });
    const confirm = path === '/login/confirm' || path === '/oauth/login';
    if (confirm) { url.pathname = '/'; url.search = ''; }
    const response = await env.STATIC.fetch(confirm ? new Request(url, request) : request);
    if (!confirm) return response;
    const headers = new Headers(response.headers); headers.set('Cache-Control', 'no-store'); headers.set('Referrer-Policy', 'no-referrer');
    return new Response(response.body, { status: response.status, headers });
  },
  async scheduled(controller: ScheduledController, env: Env) {
    if (controller.cron !== '0 19 * * *' || !configured(env)) throw new Error('備份排程設定不完整');
    const owner = await env.DB.prepare('SELECT id FROM user WHERE email = ?').bind(env.OWNER_EMAIL.toLowerCase()).first<string>('id');
    try { if (owner) await createBackup(env, owner, Date.now); }
    finally { await cleanupBackups(env, Date.now()); }
  },
} satisfies ExportedHandler<Env>;
