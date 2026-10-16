import { prepareRoom, queueCleanup } from './storage-cleanup';
import { DurableObject } from 'cloudflare:workers';
import { createBackup, readFile, readManifest } from './backups';
import type { BackupManifest } from '../shared/backup';
import { roomName } from '../shared/room';
import { imageType } from '../shared/image';
import { PageError } from './pages';
import { backupDocument, backupReferences, verifyBackupReferences } from './backup-content';

type Operation = { id: string; backup_id: string; rollback_id: string | null; phase: 'pausing' | 'paused' | 'preparing' | 'resuming' };
type Member = { page_id: string; generation: string; kind: 'old' | 'new'; document_kind?: 'syncedBlock' };
const memberScope = (owner: string, member: Member) => ({ owner, page: member.page_id, generation: member.generation, ...(member.document_kind ? { kind: member.document_kind } : {}) });
const memberRoom = (owner: string, member: Member) => roomName(owner, member.document_kind ? `synced-block:${member.page_id}` : member.page_id, member.generation);

export class RestoreCoordinator extends DurableObject<Env> {
  private tail: Promise<void> = Promise.resolve();
  protected async now(): Promise<number> { return Date.now(); }
  async run(owner: string, backup: string, request: string): Promise<{ ok: true; rollback: string }> {
    if (this.ctx.id.name !== owner) throw new Error('無效還原擁有者');
    const work = this.tail.then(() => this.restore(owner, backup, request));
    this.tail = work.then(() => {}, () => {}); return work;
  }

  private async verified(owner: string, backup: string, operation?: string): Promise<BackupManifest> {
    const manifest = await readManifest(this.env, owner, backup, await this.now(), operation);
    const prefix = `${owner}/${backup}/`;
    const references: NonNullable<BackupManifest['page_synced_blocks']> = [];
    for (const page of manifest.pages) {
      const doc = backupDocument(await readFile(this.env, prefix, page.file));
      try { references.push(...backupReferences(doc, page.metadata.id)); } finally { doc.destroy(); }
    }
    for (const block of manifest.synced_blocks ?? []) backupDocument(await readFile(this.env, prefix, block.file), true).destroy();
    verifyBackupReferences(manifest, references);
    for (const asset of manifest.assets) if (imageType(await readFile(this.env, prefix, asset.file)) !== asset.metadata.mime_type) throw new Error('備份圖片格式無效');
    for (const [table, items] of [['pages', manifest.pages], ['assets', manifest.assets], ['synced_blocks', manifest.synced_blocks ?? []]] as const) {
      for (let i = 0; i < items.length; i += 100) {
        const ids = items.slice(i, i + 100).map(item => item.metadata.id);
        if (await this.env.DB.prepare(`SELECT 1 FROM ${table} WHERE owner_id <> ? AND id IN (SELECT value FROM json_each(?)) LIMIT 1`).bind(owner, JSON.stringify(ids)).first()) throw new Error('備份識別與其他擁有者衝突');
      }
    }
    return manifest;
  }

  private async restore(owner: string, backup: string, request: string): Promise<{ ok: true; rollback: string }> {
    const db = this.env.DB;
    const completed = await db.prepare('SELECT backup_id, rollback_id FROM completed_restores WHERE id = ? AND owner_id = ?').bind(request, owner).first<{ backup_id: string; rollback_id: string }>();
    if (completed) {
      if (completed.backup_id !== backup) throw new Error('還原請求識別已用於其他備份');
      return { ok: true, rollback: completed.rollback_id };
    }
    let op = await db.prepare('SELECT * FROM restore_operations WHERE owner_id = ?').bind(owner).first<Operation>();
    if (op && op.backup_id !== backup) throw new PageError(409, '另一還原處理中，請重試原備份');
    if (op && op.id !== request) throw new PageError(409, '請重試原還原請求');
    const target = await this.verified(owner, backup, op?.id);
    if (!op) {
      const id = request;
      const initial = [
        db.prepare(`INSERT INTO restore_operations (id, owner_id, backup_id, phase, started_at)
          SELECT ?, ?, ?, 'pausing', ? WHERE NOT EXISTS (SELECT 1 FROM page_operations WHERE owner_id = ?)`)
          .bind(id, owner, backup, await this.now(), owner),
        db.prepare("INSERT INTO restore_members SELECT ?, id, sync_generation, 'old' FROM pages WHERE owner_id = ? AND EXISTS (SELECT 1 FROM restore_operations WHERE id = ?)").bind(id, owner, id),
        db.prepare("INSERT INTO restore_synced_block_members SELECT ?, id, sync_generation, 'old' FROM synced_blocks WHERE owner_id = ? AND EXISTS (SELECT 1 FROM restore_operations WHERE id = ?)").bind(id, owner, id),
      ];
      const result = await db.batch(initial); if (!result[0].meta.changes) throw new PageError(409, '頁面變更處理中');
      op = { id, backup_id: backup, rollback_id: null, phase: 'pausing' };
    }
    // 可重試的小批次，不把整份備份綁成單一 SQL 參數。
    for (const [table, items] of [['restore_members', target.pages], ['restore_synced_block_members', target.synced_blocks ?? []]] as const) {
      for (let i = 0; i < items.length; i += 50) await db.batch(items.slice(i, i + 50).map(item =>
        db.prepare(`INSERT OR IGNORE INTO ${table} SELECT ?, ?, ?, 'new' WHERE EXISTS (SELECT 1 FROM restore_operations WHERE id = ?)`).bind(op!.id, item.metadata.id, crypto.randomUUID(), op!.id)));
    }
    const members = (await db.prepare(`SELECT page_id, generation, kind, NULL AS document_kind FROM restore_members WHERE operation_id = ?
      UNION ALL SELECT synced_block_id AS page_id, generation, kind, 'syncedBlock' AS document_kind FROM restore_synced_block_members WHERE operation_id = ? ORDER BY document_kind DESC, page_id`).bind(op.id, op.id).all<Member>()).results;
    if (op.phase === 'pausing') {
      for (const member of members.filter(member => member.kind === 'old')) await this.env.SYNC.getByName(await memberRoom(owner, member)).pause();
      await db.prepare("UPDATE restore_operations SET phase = 'paused' WHERE id = ?").bind(op.id).run(); op.phase = 'paused';
    }
    if (op.phase === 'paused') {
      const rollback = await createBackup(this.env, owner, () => this.now(), op.id);
      await db.prepare("UPDATE restore_operations SET rollback_id = ?, phase = 'preparing' WHERE id = ?").bind(rollback.id, op.id).run();
      op.rollback_id = rollback.id; op.phase = 'preparing';
    }
    if (op.phase === 'preparing') {
      const prefix = `${owner}/${backup}/`; const generations = new Map(members.filter(member => member.kind === 'new' && !member.document_kind).map(member => [member.page_id, member.generation]));
      const blockGenerations = new Map(members.filter(member => member.kind === 'new' && member.document_kind).map(member => [member.page_id, member.generation]));
      for (const block of target.synced_blocks ?? []) {
        const generation = blockGenerations.get(block.metadata.id)!;
        await prepareRoom(this.env, { owner, page: block.metadata.id, generation, kind: 'syncedBlock' }, await readFile(this.env, prefix, block.file), block.checkpoint);
      }
      for (const page of target.pages) {
        const generation = generations.get(page.metadata.id)!;
        await prepareRoom(this.env, { owner, page: page.metadata.id, generation }, await readFile(this.env, prefix, page.file), page.checkpoint);
      }
      for (const asset of target.assets) {
        const key = `${owner}/${asset.metadata.id}/restore/${op.id}`; const existing = await this.env.ASSETS.get(key);
        const bytes = await readFile(this.env, prefix, asset.file);
        await queueCleanup(this.env, owner, 'asset', key);
        if (!existing) await this.env.ASSETS.put(key, bytes, { onlyIf: { etagDoesNotMatch: '*' }, sha256: await crypto.subtle.digest('SHA-256', bytes), httpMetadata: { contentType: asset.metadata.mime_type } });
        const copied = await this.env.ASSETS.get(key);
        if (!copied || copied.size !== bytes.length || !equal(new Uint8Array(await copied.arrayBuffer()), bytes)) throw new Error('還原圖片準備失敗');
      }
      const staging = [
        ...target.pages.map(item => ({ kind: 'page', id: item.metadata.id, payload: item.metadata })),
        ...(target.synced_blocks ?? []).map(item => ({ kind: 'block', id: item.metadata.id, payload: item.metadata })),
        ...target.assets.map(item => ({ kind: 'asset', id: item.metadata.id, payload: item.metadata })),
        ...(target.page_synced_blocks ?? []).map(item => ({ kind: 'reference', id: item.page_id + '/' + item.synced_block_id, payload: item })),
      ];
      for (const item of staging) await db.prepare('INSERT OR REPLACE INTO restore_staging VALUES (?, ?, ?, ?)').bind(op.id, item.kind, item.id, JSON.stringify(item.payload)).run();
      for (const member of members.filter(member => member.kind === 'old')) await queueCleanup(this.env, owner, 'room', JSON.stringify(memberScope(owner, member)));
      const cleanupAt = Date.now() + 3600000;
      await db.batch([
        db.prepare("INSERT OR IGNORE INTO storage_cleanup SELECT owner_id, 'asset', object_key, ? FROM assets WHERE owner_id = ?").bind(cleanupAt, owner),
        db.prepare("INSERT OR IGNORE INTO storage_cleanup SELECT owner_id, 'version', object_key, ? FROM page_versions WHERE owner_id = ? AND page_id NOT IN (SELECT id FROM restore_staging WHERE operation_id = ? AND kind = 'page')").bind(cleanupAt, owner, op.id),
        db.prepare("DELETE FROM page_versions WHERE owner_id = ? AND page_id NOT IN (SELECT id FROM restore_staging WHERE operation_id = ? AND kind = 'page')").bind(owner, op.id),
        db.prepare('DELETE FROM pages WHERE owner_id = ?').bind(owner),
        db.prepare('DELETE FROM synced_blocks WHERE owner_id = ?').bind(owner),
        db.prepare(`INSERT INTO synced_blocks (id, owner_id, sync_generation, created_at, updated_at)
          SELECT s.id, ?, m.generation, json_extract(payload, '$.created_at'), json_extract(payload, '$.updated_at')
          FROM restore_staging s JOIN restore_synced_block_members m ON m.operation_id = s.operation_id AND m.synced_block_id = s.id AND m.kind = 'new'
          WHERE s.operation_id = ? AND s.kind = 'block'`).bind(owner, op.id),
        db.prepare(`INSERT INTO pages (id, owner_id, kind, title, icon, parent_id, journal_date, sync_generation, metadata_revision, created_at, updated_at, deleted_at, database_config, property_values)
          SELECT s.id, ?, json_extract(payload, '$.kind'), json_extract(payload, '$.title'), json_extract(payload, '$.icon'), json_extract(payload, '$.parent_id'), json_extract(payload, '$.journal_date'),
            m.generation, json_extract(payload, '$.metadata_revision'), json_extract(payload, '$.created_at'), json_extract(payload, '$.updated_at'), json_extract(payload, '$.deleted_at'), json_extract(payload, '$.database_config'), COALESCE(json_extract(payload, '$.property_values'), '{}')
          FROM restore_staging s JOIN restore_members m ON m.operation_id = s.operation_id AND m.page_id = s.id AND m.kind = 'new'
          WHERE s.operation_id = ? AND s.kind = 'page'`).bind(owner, op.id),
        db.prepare(`INSERT INTO page_synced_blocks (page_id, synced_block_id) SELECT json_extract(payload, '$.page_id'), json_extract(payload, '$.synced_block_id') FROM restore_staging WHERE operation_id = ? AND kind = 'reference'`).bind(op.id),
        db.prepare(`INSERT INTO assets (id, owner_id, object_key, original_name, mime_type, byte_size, checksum, created_at)
          SELECT id, ?, ? || '/' || id || '/restore/' || ?, json_extract(payload, '$.original_name'), json_extract(payload, '$.mime_type'), json_extract(payload, '$.byte_size'), json_extract(payload, '$.checksum'), json_extract(payload, '$.created_at')
          FROM restore_staging WHERE operation_id = ? AND kind = 'asset'
          ON CONFLICT(id) DO UPDATE SET object_key = excluded.object_key, original_name = excluded.original_name, mime_type = excluded.mime_type, byte_size = excluded.byte_size, checksum = excluded.checksum, created_at = excluded.created_at WHERE assets.owner_id = excluded.owner_id`).bind(owner, owner, op.id, op.id),
        db.prepare("UPDATE restore_operations SET phase = 'resuming' WHERE id = ? AND phase = 'preparing'").bind(op.id),
      ]); op.phase = 'resuming';
    }
    for (const member of members.filter(member => member.kind === 'new')) {
      const room = this.env.SYNC.getByName(await memberRoom(owner, member));
      await room.reindex(memberScope(owner, member)); await room.resume();
    }
    await db.batch([
      db.prepare('INSERT INTO completed_restores VALUES (?, ?, ?, ?, ?)').bind(op.id, owner, backup, op.rollback_id!, await this.now()),
      db.prepare('DELETE FROM restore_operations WHERE id = ?').bind(op.id),
    ]);
    return { ok: true, rollback: op.rollback_id! };
  }
}
function equal(a: Uint8Array, b: Uint8Array): boolean { return a.length === b.length && a.every((value, index) => value === b[index]); }
