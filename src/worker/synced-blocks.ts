import { prepareRoom } from './storage-cleanup';
import * as Y from 'yjs';
import { roomName } from '../shared/room';
import type { SyncedBlockInfo, SyncedBlockReference, SyncedBlockRow } from '../shared/synced-blocks';
import { blockEditor, replaceBlocks, validatedBlocks } from './block-json';
import { PageError, VISIBLE } from './pages';
import { body } from './request';

const json = (value: unknown) => Response.json(value, { headers: { 'Cache-Control': 'no-store' } });
export function syncedBlockRoom(owner: string, id: string, generation: string): Promise<string> {
  return roomName(owner, `synced-block:${id}`, generation);
}
export async function syncedBlockInfo(env: Env, owner: string, id: string): Promise<SyncedBlockInfo | null> {
  const row = await env.DB.prepare('SELECT * FROM synced_blocks WHERE id = ? AND owner_id = ?').bind(id, owner).first<SyncedBlockRow>();
  return row ? { ...row, room: await syncedBlockRoom(owner, id, row.sync_generation) } : null;
}
export async function syncedBlockReferences(env: Env, owner: string, id: string): Promise<SyncedBlockReference[]> {
  return (await env.DB.prepare(`${VISIBLE} SELECT visible.id, visible.title, visible.kind FROM visible
    JOIN page_synced_blocks refs ON refs.page_id = visible.id WHERE refs.synced_block_id = ? ORDER BY visible.title, visible.id`)
    .bind(owner, id).all<SyncedBlockReference>()).results;
}
export async function handleSyncedBlocks(request: Request, env: Env, owner: string, now: number): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === '/api/synced-blocks' && request.method === 'POST') {
    let input: Record<string, unknown>;
    try { input = await body(request, 256 * 1024); } catch { throw new PageError(400, '無效的同步區塊內容'); }
    if (Object.keys(input).some(key => key !== 'blocks')) throw new PageError(400, '無效的同步區塊內容');
    const editor = blockEditor();
    const blocks = await validatedBlocks(input.blocks ?? [], env, owner, editor, { allowSyncedBlocks: false });
    const id = crypto.randomUUID(); const generation = crypto.randomUUID();
    const name = await syncedBlockRoom(owner, id, generation); const room = env.SYNC.getByName(name);
    const doc = new Y.Doc(); let data: Uint8Array;
    try { replaceBlocks(doc, blocks, editor); data = Y.encodeStateAsUpdate(doc); } finally { doc.destroy(); }
    if (data.length > 512 * 1024) throw new PageError(400, '同步區塊超過大小限制');
    await prepareRoom(env, { owner, page: id, generation, kind: 'syncedBlock' }, data, 0);
    const inserted = await env.DB.prepare(`INSERT INTO synced_blocks (id, owner_id, sync_generation, created_at, updated_at)
      SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM restore_operations WHERE owner_id = ?)
      AND NOT EXISTS (SELECT 1 FROM page_operations WHERE owner_id = ?)`).bind(id, owner, generation, now, now, owner, owner).run();
    if (!inserted.meta.changes) throw new PageError(409, '頁面變更處理中，請稍後重試');
    await room.resume(); await room.reindex({ owner, page: id, generation, kind: 'syncedBlock' });
    return json({ id, owner_id: owner, sync_generation: generation, created_at: now, updated_at: now, room: name });
  }
  if (path === '/api/synced-blocks' && request.method === 'GET') {
    const rows = (await env.DB.prepare('SELECT * FROM synced_blocks WHERE owner_id = ? ORDER BY updated_at DESC, id').bind(owner).all<SyncedBlockRow>()).results;
    return json(await Promise.all(rows.map(async row => ({ ...row, room: await syncedBlockRoom(owner, row.id, row.sync_generation), reference_count: (await syncedBlockReferences(env, owner, row.id)).length }))));
  }
  const match = path.match(/^\/api\/synced-blocks\/([\w-]{1,80})(\/references)?$/);
  if (match && request.method === 'GET') {
    const info = await syncedBlockInfo(env, owner, match[1]);
    if (!info) throw new PageError(404, '找不到同步區塊');
    if (match[2]) { const pages = await syncedBlockReferences(env, owner, info.id); return json({ count: pages.length, pages }); }
    return json(info);
  }
  return null;
}
