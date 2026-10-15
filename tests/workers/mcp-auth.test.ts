import { env } from 'cloudflare:workers';
import { createExecutionContext, reset, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, expect, it, vi } from 'vitest';
import { authenticated, origin } from './helpers';
import { handleOAuth } from '../../src/worker/oauth';

afterEach(async () => { vi.restoreAllMocks(); await reset(); });
it('PLUGIN-05：CIMD client metadata 可驗證並產生安全同意畫面', async () => {
  const auth = await authenticated();
  const clientId = 'https://client.example.test/metadata.json';
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    expect(String(input)).toBe(clientId);
    return Response.json({ client_id: clientId, client_name: '測試 CIMD', redirect_uris: ['https://client.example.test/callback'], token_endpoint_auth_method: 'none' }, { headers: { 'Cache-Control': 'public, max-age=60' } });
  });
  const url = new URL('/oauth/authorize', origin);
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: 'https://client.example.test/callback', response_type: 'code', scope: 'notes:read', state: 'test-state', code_challenge: 'A'.repeat(43), code_challenge_method: 'S256', resource: origin + '/mcp' }).toString();
  const context = createExecutionContext();
  const response = await handleOAuth(new Request(url, { headers: { Cookie: auth.cookie } }), env, { now: () => auth.now, sendMail: async () => {} }, context);
  await waitOnExecutionContext(context);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const html = await response.text();
  expect(html).toContain('測試 CIMD'); expect(html).toContain('client.example.test');
  expect(response.headers.get('set-cookie')?.includes('Secure; HttpOnly')).toBe(true);
});
