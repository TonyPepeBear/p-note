import app from '../src/worker/app';
import runtime from './runtime';
export { ProbeRoom, SyncRoom, RestoreCoordinator } from './runtime';

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/') || path.startsWith('/parties/sync/') || path.startsWith('/__test/') || path === '/health') return runtime.fetch(request, env, ctx);
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
