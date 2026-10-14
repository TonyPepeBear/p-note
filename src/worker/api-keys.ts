import { body } from './request';
import { PageError } from './pages';

const headers = { 'Cache-Control': 'no-store' };
export const keyJson = (value: unknown, status = 200) => Response.json(value, { status, headers });
const hex = (value: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(value), b => b.toString(16).padStart(2, '0')).join('');
const unhex = (value: string) => Uint8Array.from(value.match(/../g) ?? [], b => parseInt(b, 16));
export async function keyHash(value: string) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))); }
async function encryptionKey(env: Env) {
  if (!/^[a-f0-9]{64}$/.test(env.API_KEY_ENCRYPTION_SECRET ?? '')) throw new PageError(503, 'API key 加密設定尚未完成');
  return crypto.subtle.importKey('raw', unhex(env.API_KEY_ENCRYPTION_SECRET), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function apiKeyOwner(env: Env, hash: string): Promise<{ id: string; owner_id: string } | null> {
  return env.DB.prepare('SELECT k.id, k.owner_id FROM api_keys k JOIN user u ON u.id = k.owner_id WHERE k.key_hash = ? AND lower(u.email) = ?')
    .bind(hash, env.OWNER_EMAIL.toLowerCase()).first();
}
export async function handleKeys(request: Request, env: Env, owner: string, now: number): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === '/api/keys') {
    if (request.method === 'GET') return keyJson((await env.DB.prepare('SELECT id, name, prefix, created_at, last_used_at FROM api_keys WHERE owner_id = ? ORDER BY created_at DESC, id').bind(owner).all()).results);
    if (request.method === 'POST') {
      let data: Record<string, unknown>; try { data = await body(request); } catch { throw new PageError(400, '請提供有效名稱'); }
      if (typeof data.name !== 'string' || !data.name.trim() || data.name.trim().length > 80) throw new PageError(400, '名稱須為 1～80 個字元');
      const id = crypto.randomUUID(); const token = 'pn_' + hex(crypto.getRandomValues(new Uint8Array(32)));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`${owner}:${id}`) }, await encryptionKey(env), new TextEncoder().encode(token));
      const result = await env.DB.prepare(`INSERT INTO api_keys (id, owner_id, name, key_hash, ciphertext, iv, prefix, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT count(*) FROM api_keys WHERE owner_id = ?) < 20`)
        .bind(id, owner, data.name.trim(), await keyHash(token), hex(ciphertext), hex(iv), token.slice(0, 11), now, owner).run();
      if (!result.meta.changes) throw new PageError(409, '最多可建立 20 把 API key，請先撤銷不再使用的 key');
      return keyJson({ id, name: data.name.trim(), prefix: token.slice(0, 11), created_at: now, last_used_at: null }, 201);
    }
  }
  const match = path.match(/^\/api\/keys\/([\w-]{1,80})\/(reveal|revoke)$/);
  if (!match || request.method !== 'POST') return null;
  const row = await env.DB.prepare('SELECT id, ciphertext, iv FROM api_keys WHERE id = ? AND owner_id = ?').bind(match[1], owner).first<{ id: string; ciphertext: string; iv: string }>();
  if (!row) throw new PageError(404, '找不到 API key');
  if (match[2] === 'revoke') {
    await env.DB.prepare('DELETE FROM api_keys WHERE id = ? AND owner_id = ?').bind(row.id, owner).run();
    return keyJson({ ok: true });
  }
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(row.iv), additionalData: new TextEncoder().encode(`${owner}:${row.id}`) }, await encryptionKey(env), unhex(row.ciphertext));
  return keyJson({ key: new TextDecoder().decode(plain) });
}
