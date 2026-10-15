import app from '../src/worker/app';
import { oauthPath } from '../src/worker/oauth';
import runtime from './runtime';
export { ProbeRoom, SyncRoom, RestoreCoordinator } from './runtime';

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const path = new URL(request.url).pathname;
    if (path === '/cdn-cgi/rum') return new Response(null, { status: request.method === 'POST' ? 204 : 405 });
    if (oauthPath(path) || path.startsWith('/api/') || path.startsWith('/parties/sync/') || path.startsWith('/__test/') || path === '/health') return runtime.fetch(request, env, ctx);
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
