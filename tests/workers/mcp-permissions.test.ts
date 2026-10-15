import { env } from 'cloudflare:workers';
import { reset, runInDurableObject } from 'cloudflare:test';
import { afterEach, expect, it } from 'vitest';
import { authenticated } from './helpers';
import { createBackup, readManifest } from '../../src/worker/backups';
import type { SyncRoom } from '../../src/worker/sync-room';

afterEach(async () => { await reset(); });
async function setup() {
  const auth = await authenticated(); const page = await auth.note('OAuth 正文權限');
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO mcp_grants (id, owner_id, name, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, page.owner_id, '測試 MCP 連線', 'notes:read notes:write', auth.now, auth.now + 86400000).run();
  const scope = { owner: page.owner_id, page: page.id, generation: page.sync_generation };
  const credential = { grantId: id, scopes: ['notes:read', 'notes:write'] };
  const stub = env.SYNC.getByName(page.room);
  return { auth, page, id, scope, credential, stub };
}
it('PLUGIN-08：Durable Object 檢查 owner、scope、到期與撤銷並保留正文', async () => {
  const a = await setup(); const current = await a.stub.content(a.scope, a.credential);
  expect(current.status).toBe(200);
  const input = { blocks: [{ type: 'paragraph', content: '受保護正文' }], etag: current.etag! };
  expect((await a.stub.content(a.scope, { ...a.credential, scopes: ['notes:read'] }, input)).status).toBe(401);
  expect((await a.stub.content({ ...a.scope, owner: 'other' }, a.credential, input)).status).toBe(401);
  expect((await a.stub.content(a.scope, a.credential, input)).status).toBe(200);
  await env.DB.prepare('UPDATE mcp_grants SET expires_at = ? WHERE id = ?').bind(a.auth.now - 1, a.id).run();
  expect((await a.stub.content(a.scope, a.credential)).status).toBe(401);
  await env.DB.prepare('UPDATE mcp_grants SET expires_at = ?, revoked_at = ? WHERE id = ?').bind(a.auth.now + 86400000, a.auth.now, a.id).run();
  expect((await a.stub.content(a.scope, a.credential, input)).status).toBe(401);
  await env.DB.prepare('UPDATE mcp_grants SET revoked_at = NULL WHERE id = ?').bind(a.id).run();
  expect(JSON.stringify((await a.stub.content(a.scope, a.credential)).blocks)).toContain('受保護正文');
});
it('PLUGIN-08：保存前撤銷的 OAuth 授權不能寫入或進入備份', async () => {
  const a = await setup(); const current = await a.stub.content(a.scope, a.credential);
  const result = await runInDurableObject<SyncRoom, number>(a.stub, async instance => {
    const prune = Reflect.get(instance, 'prune') as () => Promise<void>;
    Reflect.set(instance, 'prune', async () => {
      await prune.call(instance);
      await env.DB.prepare('UPDATE mcp_grants SET revoked_at = ? WHERE id = ?').bind(a.auth.now, a.id).run();
    });
    try { return (await instance.content(a.scope, a.credential, { blocks: [{ type: 'paragraph', content: '不應保存的修改' }], etag: current.etag! })).status; }
    finally { Reflect.set(instance, 'prune', prune); }
  });
  expect(result).toBe(401);
  await env.DB.prepare('UPDATE mcp_grants SET revoked_at = NULL WHERE id = ?').bind(a.id).run();
  expect((await a.stub.content(a.scope, a.credential)).blocks).toEqual(current.blocks);
  const backup = await createBackup(env, a.page.owner_id, () => a.auth.now);
  const manifest = await readManifest(env, a.page.owner_id, backup.id, a.auth.now);
  const text = JSON.stringify(manifest);
  expect(text.includes('mcp_grants')).toBe(false); expect(text.includes(a.id)).toBe(false);
  for (const item of [...manifest.pages, ...manifest.assets]) {
    const object = await env.BACKUPS.get(`${a.page.owner_id}/${backup.id}/${item.file.path}`);
    expect((await object!.text()).includes(a.id)).toBe(false);
  }
});
