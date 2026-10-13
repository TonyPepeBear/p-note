import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { magicLink } from 'better-auth/plugins/magic-link';
import type { Services } from './app';

export const SESSION_MS = 30 * 86400000;
export const LINK_MS = 600000;

export function configured(env: Env): boolean {
  try {
    const url = new URL(env.BETTER_AUTH_URL);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.OWNER_EMAIL)
      && env.BETTER_AUTH_SECRET.length >= 32 && url.origin === env.BETTER_AUTH_URL
      && (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)));
  } catch { return false; }
}

export function createAuth(env: Env, services: Services) {
  return betterAuth({
    database: env.DB, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.BETTER_AUTH_URL],
    session: { expiresIn: SESSION_MS / 1000, disableSessionRefresh: true, cookieCache: { enabled: false } },
    rateLimit: { enabled: false }, logger: { disabled: true },
    databaseHooks: {
      user: { create: { before: async user => {
        if (user.email.toLowerCase() !== env.OWNER_EMAIL.toLowerCase()) throw new APIError('FORBIDDEN');
        return { data: user };
      } } },
      session: { create: { before: async session => {
        const now = new Date(services.now());
        return { data: { ...session, createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + SESSION_MS) } };
      } } },
      verification: { create: { before: async value => {
        const now = new Date(services.now());
        return { data: { ...value, createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + LINK_MS) } };
      } } },
    },
    plugins: [magicLink({
      expiresIn: LINK_MS / 1000, storeToken: 'hashed',
      sendMagicLink: async ({ email, token }) => {
        const url = new URL('/login/confirm', env.BETTER_AUTH_URL); url.searchParams.set('token', token);
        try { await services.sendMail(email, url.toString()); }
        catch (error) {
          await env.DB.prepare('DELETE FROM verification WHERE identifier = ?').bind(await tokenIdentifier(token)).run();
          throw error;
        }
      },
    })],
  });
}

export async function tokenIdentifier(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  // Better Auth 1.7.7 的 magic link 使用 SHA-256 base64url；升級時以憑證往返測試核對。
  const hash = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `magic-link:${hash}`;
}

export async function sessionFor(request: Request, env: Env, services: Services) {
  const session = await createAuth(env, services).api.getSession({ headers: request.headers });
  if (!session || session.user.email.toLowerCase() !== env.OWNER_EMAIL.toLowerCase()
    || new Date(session.session.expiresAt).getTime() <= services.now()) return null;
  return session;
}
