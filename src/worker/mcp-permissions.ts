import { apiKeyOwner } from './api-keys';

export type ContentCredential = string | { grantId: string; scopes: string[] };
export type McpGrant = { id: string; owner_id: string; scopes: string; expires_at: number };
export function activeMcpGrant(env: Env, id: string, now: number): Promise<McpGrant | null> {
  return env.DB.prepare(`SELECT g.id, g.owner_id, g.scopes, g.expires_at FROM mcp_grants g JOIN user u ON u.id = g.owner_id
    WHERE g.id = ? AND g.revoked_at IS NULL AND g.expires_at > ? AND lower(u.email) = ?`)
    .bind(id, now, env.OWNER_EMAIL.toLowerCase()).first<McpGrant>();
}
export async function contentPermission(env: Env, credential: ContentCredential, owner: string, write: boolean, now: number): Promise<boolean> {
  if (typeof credential === 'string') return (await apiKeyOwner(env, credential))?.owner_id === owner;
  const grant = await activeMcpGrant(env, credential.grantId, now);
  const required = write ? ['notes:read', 'notes:write'] : ['notes:read'];
  return grant?.owner_id === owner && required.every(scope => credential.scopes.includes(scope) && grant.scopes.split(' ').includes(scope));
}
