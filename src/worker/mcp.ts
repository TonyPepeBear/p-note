import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { handleAuthorizedContent } from './content-api';
import { PageError } from './pages';
import { activeMcpGrant } from './mcp-permissions';
import type { OAuthResourceContext } from '@cloudflare/workers-oauth-provider';
import { isPageIcon } from '../shared/page-icon';

export type McpIdentity = { owner: string; connectionId: string };
const id = z.string().regex(/^[\w-]{1,80}$/);
const title = z.string().trim().min(1).max(200);
const parent = id.nullable();
const icon = z.string().max(64).refine(isPageIcon, '圖示須為單一 emoji').nullable();
const definitions = [
  { name: 'list_pages', description: '列出自己的可見筆記與日記。', input: z.object({}).strict(), method: 'GET', path: () => '/pages' },
  { name: 'get_page', description: '讀取頁面資訊與上層；正文請使用 get_content。', input: z.object({ page_id: id }).strict(), method: 'GET', path: (a: Args) => `/pages/${a.page_id}` },
  { name: 'search', description: '搜尋中文標題與正文，排除垃圾桶。', input: z.object({ query: z.string().trim().min(1).max(500) }).strict(), method: 'GET', path: (a: Args) => '/search?q=' + encodeURIComponent(String(a.query)) },
  { name: 'create_page', description: '建立筆記；parent_id 省略或 null 表示根目錄；icon 可設定單一 emoji。', input: z.object({ title, parent_id: parent.optional(), icon: icon.optional() }).strict(), method: 'POST', path: () => '/pages', body: (a: Args) => ({ title: a.title, parent_id: a.parent_id ?? null, icon: a.icon ?? null }) },
  { name: 'rename_page', description: '修改指定筆記的標題。', input: z.object({ page_id: id, title }).strict(), method: 'POST', path: (a: Args) => `/pages/${a.page_id}/title`, body: (a: Args) => ({ title: a.title }) },
  { name: 'set_page_icon', description: '設定指定筆記或日記的單一 emoji 圖示；icon 為 null 時移除圖示。', input: z.object({ page_id: id, icon }).strict(), method: 'POST', path: (a: Args) => `/pages/${a.page_id}/icon`, body: (a: Args) => ({ icon: a.icon }) },
  { name: 'move_page', description: '移動筆記；parent_id 為 null 表示移到根目錄。', input: z.object({ page_id: id, parent_id: parent }).strict(), method: 'POST', path: (a: Args) => `/pages/${a.page_id}/move`, body: (a: Args) => ({ parent_id: a.parent_id }) },
  { name: 'open_journal', description: '開啟或建立指定日期唯一日記；日期依使用者時區。', input: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(), method: 'POST', path: () => '/journal', body: (a: Args) => ({ date: a.date }) },
  { name: 'list_journals', description: '列出指定月份日記。', input: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).strict(), method: 'GET', path: (a: Args) => '/journals?month=' + encodeURIComponent(String(a.month)) },
  { name: 'get_content', description: '讀取完整 BlockNote blocks 與 etag；修改前必須先讀取。', input: z.object({ page_id: id }).strict(), method: 'GET', path: (a: Args) => `/pages/${a.page_id}/content` },
  { name: 'update_content', description: '以完整 blocks 替換正文，必須使用 get_content 的 etag；412 時先重新讀取並合併，不要盲目重送。', input: z.object({ page_id: id, etag: z.string().regex(/^"[^"\r\n]+"$/), blocks: z.array(z.record(z.string(), z.unknown())).max(1000) }).strict(), method: 'PUT', path: (a: Args) => `/pages/${a.page_id}/content`, body: (a: Args) => ({ blocks: a.blocks }) },
];
type Args = Record<string, unknown>;
const toolResult = (value: unknown, isError = false) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) });

export async function serveMcp(request: Request, env: Env, context: OAuthResourceContext<unknown>, now: () => number): Promise<Response> {
  const identity = context.props as Partial<McpIdentity> | undefined;
  if (!identity || typeof identity.owner !== 'string' || typeof identity.connectionId !== 'string') return new Response('授權無效', { status: 401 });
  const grant = await activeMcpGrant(env, identity.connectionId, now());
  if (!grant || grant.owner_id !== identity.owner) return new Response('授權無效或已撤銷', { status: 401 });
  const tokenScopes = context.auth.scope;
  if (!tokenScopes.includes('notes:read') || !grant.scopes.split(' ').includes('notes:read')) return new Response('缺少讀取權限', { status: 403 });
  const credential = { grantId: grant.id, scopes: tokenScopes };
  const server = new McpServer({ name: 'p-note', version: '0.2.0' });
  for (const tool of definitions) {
    server.registerTool(tool.name, {
      description: tool.description, inputSchema: tool.input,
      annotations: { readOnlyHint: tool.method === 'GET', destructiveHint: tool.method !== 'GET', idempotentHint: tool.method === 'GET', openWorldHint: true },
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: tool.method === 'GET' ? ['notes:read'] : ['notes:read', 'notes:write'] }] },
    }, async (args: Args) => {
      if (tool.method !== 'GET' && (!tokenScopes.includes('notes:write') || !grant.scopes.split(' ').includes('notes:write'))) return toolResult({ status: 403, message: '此連線只有讀取權限，請重新授權寫入。' }, true);
      try {
        const payload = tool.body ? JSON.stringify(tool.body(args)) : undefined;
        if (payload && new TextEncoder().encode(payload).length > 256 * 1024) return toolResult({ status: 400, message: 'JSON 不得超過 256 KiB' }, true);
        const response = await handleAuthorizedContent(new Request(new URL('/api/v1' + tool.path(args), env.BETTER_AUTH_URL), {
          method: tool.method, body: payload, headers: { ...(payload ? { 'Content-Type': 'application/json' } : {}), ...(tool.method === 'PUT' ? { 'If-Match': String(args.etag) } : {}) },
        }), env, now(), identity.owner!, credential);
        const value: Record<string, unknown> = await response.json();
        if (!response.ok) return toolResult({ status: response.status, message: value.message }, true);
        const etag = response.headers.get('ETag');
        return toolResult(etag ? { ...value, etag } : value);
      } catch (error) {
        return toolResult({ status: error instanceof PageError ? error.status : 503, message: error instanceof PageError ? error.message : '請求未能完成；寫入後請先重新讀取確認，不要自動重送。' }, true);
      }
    });
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 300 * 1024 });
  await server.connect(transport);
  try { return await transport.handleRequest(request); }
  finally { await server.close(); }
}
