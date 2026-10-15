import OAuthProvider, { AuthorizationError, CimdFetchError, OAuthError, getOAuthApi, type OAuthHelpers, type OAuthProviderOptions, type OAuthResourceContext, type ConsentDescription } from '@cloudflare/workers-oauth-provider';
import { sessionFor } from './auth';
import type { Services } from './app';
import { activeMcpGrant } from './mcp-permissions';
import { serveMcp, type McpIdentity } from './mcp';
import { bytes } from './request';

const SCOPES = ['notes:read', 'notes:write', 'offline_access'];
const MONTH = 30 * 86400000;
const escape = (value: string) => value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
function consentHtml(details: ConsentDescription, handle: string) {
  const labels: Record<string, string> = { 'notes:read': '讀取筆記與日記', 'notes:write': '建立及修改筆記與日記', offline_access: '保持連線，最長 30 天，可隨時撤銷' };
  return `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>授權筆記存取 · p-note</title>
<style>body{font:16px/1.7 system-ui;margin:0;background:#f8f9fa;color:#212529}main{max-width:520px;margin:8vh auto;padding:32px;background:white;border:1px solid #dee2e6;border-radius:12px}h1{font-size:24px}label{display:block;margin:12px 0}button{font:inherit;padding:8px 20px;margin:16px 8px 0 0;cursor:pointer}p{overflow-wrap:anywhere}@media(max-width:600px){main{margin:16px;padding:24px}}</style>
<main><h1>授權筆記存取</h1><p>${escape(details.clientName)}</p><p>${details.clientDomain ? '發行網域：' + escape(details.clientDomain) : '此應用自行註冊，顯示名稱未經驗證。'}</p>
<p>授權將返回：<strong>${escape(details.redirectHost)}</strong></p>${details.redirectIsLoopback ? '<p>這會授權你電腦上的應用，請確認是你剛開始的連線。</p>' : ''}
<form method="post" action="/oauth/authorize"><input type="hidden" name="handle" value="${escape(handle)}">${details.scope.map(scope => `<label><input type="checkbox" name="scope" value="${escape(scope)}" checked> <span>${labels[scope]}</span></label>`).join('')}
<p>允許此應用代表你使用以上權限。可於 p-note 設定撤銷連線。</p><button name="decision" value="approve">同意授權</button><button name="decision" value="deny">拒絕</button></form></main></html>`;
}
function options(env: Env, services: Services): OAuthProviderOptions<Env> {
  return {
    apiRoute: '/mcp', authorizeEndpoint: '/oauth/authorize', tokenEndpoint: '/oauth/token', clientRegistrationEndpoint: '/oauth/register',
    resourceMetadata: { resource: env.BETTER_AUTH_URL + '/mcp', authorization_servers: [env.BETTER_AUTH_URL] },
    requiredScopes: ['notes:read'], scopesSupported: SCOPES, clientIdMetadataDocumentEnabled: true,
    accessTokenTTL: 3600, refreshTokenTTL: MONTH / 1000,
    onError: () => {},
    tokenExchangeCallback: async ({ props, userId, grantId, env: current }) => {
      const identity: Partial<McpIdentity> | undefined = props;
      const grant = identity && typeof identity.connectionId === 'string' ? await activeMcpGrant(current, identity.connectionId, services.now()) : null;
      if (!grant || grant.owner_id !== userId || identity?.owner !== userId) throw new OAuthError('invalid_grant', { description: '連線已撤銷或到期，請重新授權' });
      await current.DB.prepare('UPDATE mcp_grants SET provider_grant_id = ? WHERE id = ?').bind(grantId, grant.id).run();
      return {};
    },
    apiHandler: { fetch: (request, current, context) => serveMcp(request, current, context as OAuthResourceContext<unknown>, services.now) },
    defaultHandler: { fetch: async (request, current) => {
      if (new URL(request.url).pathname !== '/oauth/authorize') return new Response('Not found', { status: 404 });
      const oauth = (current as Env & { OAUTH_PROVIDER: OAuthHelpers }).OAUTH_PROVIDER;
      try {
        if (request.method === 'GET') {
          const auth = await oauth.parseAuthRequest(request);
          if (auth.scope.some(scope => !SCOPES.includes(scope))) return json({ message: '不支援的授權範圍' }, 400);
          if (!auth.scope.length) auth.scope = ['notes:read'];
          if (!auth.scope.includes('notes:read')) return json({ message: '必須包含讀取權限' }, 400);
          const session = await sessionFor(request, current, services);
          if (!session) {
            const url = new URL(request.url);
            return new Response(null, { status: 302, headers: { Location: '/oauth/login?returnTo=' + encodeURIComponent(url.pathname + url.search), 'Cache-Control': 'no-store' } });
          }
          const details = await oauth.describeConsent(auth);
          const consent = await oauth.beginConsent(auth);
          consent.headers.set('Content-Type', 'text/html; charset=utf-8');
          consent.headers.set('Referrer-Policy', 'same-origin');
          consent.headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
          return new Response(consentHtml(details, consent.handle), { headers: consent.headers });
        }
        if (request.method !== 'POST') return new Response(null, { status: 405 });
        if (request.headers.get('Origin') !== current.BETTER_AUTH_URL || request.headers.get('Sec-Fetch-Site') === 'cross-site') return json({ message: '來源不允許' }, 403);
        const session = await sessionFor(request, current, services);
        if (!session) return json({ message: '請重新登入再授權' }, 401);
        const form = await request.formData();
        const handle = String(form.get('handle') ?? '');
        if (form.get('decision') === 'deny') {
          const denied = await oauth.denyConsent(request, handle);
          return new Response(null, { status: 302, headers: denied.headers });
        }
        if (form.get('decision') !== 'approve') return json({ message: '請選擇同意或拒絕' }, 400);
        const scope = form.getAll('scope').map(String);
        if (!scope.includes('notes:read') || scope.some(value => !SCOPES.includes(value))) return json({ message: '請選擇有效權限' }, 400);
        const approved = await oauth.approveConsent(request, handle, { scope });
        const details = await oauth.describeConsent(approved.request);
        const id = crypto.randomUUID(); const now = services.now();
        await current.DB.prepare('INSERT INTO mcp_grants (id, owner_id, name, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(id, session.user.id, details.clientName.slice(0, 200), scope.join(' '), now, now + MONTH).run();
        const { redirectTo } = await oauth.completeAuthorization({ request: approved.request, userId: session.user.id, metadata: { connectionId: id }, scope, props: { owner: session.user.id, connectionId: id } satisfies McpIdentity });
        approved.headers.set('Location', redirectTo);
        return new Response(null, { status: 302, headers: approved.headers });
      } catch (error) {
        if (error instanceof AuthorizationError || error instanceof CimdFetchError) return json({ message: '授權請求無效或已過期，請從應用重新開始連線' }, 400);
        return json({ message: '授權服務暫時無法完成，請稍後重試' }, 503);
      }
    } },
  };
}
export function oauthPath(path: string): boolean {
  return path === '/mcp' || path.startsWith('/mcp/') || (path.startsWith('/oauth/') && path !== '/oauth/login') || path.startsWith('/.well-known/oauth-');
}
export async function handleOAuth(request: Request, env: Env, services: Services, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (request.headers.has('Origin') && request.headers.get('Origin') !== env.BETTER_AUTH_URL && !['/oauth/token', '/oauth/register'].includes(url.pathname)) return json({ message: '來源不允許' }, 403);
  if (request.method === 'POST' && url.pathname !== '/mcp') {
    try { request = new Request(request, { body: await bytes(request, 16 * 1024) }); }
    catch { return json({ message: '授權請求過大或無效' }, 400); }
  }
  const origin = new URL(env.BETTER_AUTH_URL);
  url.protocol = origin.protocol; url.host = origin.host;
  const response = await new OAuthProvider(options(env, services)).fetch(new Request(url, request), env, ctx);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
export async function handleConnections(request: Request, env: Env, owner: string, services: Services): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === '/api/mcp-connections' && request.method === 'GET') return json((await env.DB.prepare('SELECT id, name, scopes, created_at, expires_at FROM mcp_grants WHERE owner_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC').bind(owner, services.now()).all()).results);
  const match = path.match(/^\/api\/mcp-connections\/([\w-]{1,80})\/revoke$/);
  if (!match || request.method !== 'POST') return null;
  const grant = await env.DB.prepare('SELECT provider_grant_id FROM mcp_grants WHERE id = ? AND owner_id = ?').bind(match[1], owner).first<{ provider_grant_id: string | null }>();
  if (!grant) return json({ message: '找不到連線' }, 404);
  await env.DB.prepare('UPDATE mcp_grants SET revoked_at = ? WHERE id = ? AND owner_id = ?').bind(services.now(), match[1], owner).run();
  if (grant.provider_grant_id) await getOAuthApi(options(env, services), env).revokeGrant(grant.provider_grant_id, owner);
  return json({ ok: true });
}
