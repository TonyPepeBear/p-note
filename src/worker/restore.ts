import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import { createBackup, readFile, readManifest } from './backups';
import type { BackupManifest } from '../shared/backup';
import { roomName } from '../shared/room';
import { imageType } from '../shared/image';
import { PageError } from './pages';

type Operation = { id: string; backup_id: string; rollback_id: string | null; phase: 'pausing' | 'paused' | 'preparing' | 'resuming' };
type Member = { page_id: string; generation: string; kind: 'old' | 'new' };

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
    for (const page of manifest.pages) {
      const bytes = await readFile(this.env, prefix, page.file); const doc = new Y.Doc();
      try { Y.applyUpdate(doc, bytes); } finally { doc.destroy(); }
    }
    for (const asset of manifest.assets) if (imageType(await readFile(this.env, prefix, asset.file)) !== asset.metadata.mime_type) throw new Error('備份圖片格式無效');
    const collisions = await this.env.DB.batch([
      this.env.DB.prepare("SELECT 1 FROM pages WHERE owner_id <> ? AND id IN (SELECT json_extract(value, '$.metadata.id') FROM json_each(?)) LIMIT 1").bind(owner, JSON.stringify(manifest.pages)),
      this.env.DB.prepare("SELECT 1 FROM assets WHERE owner_id <> ? AND id IN (SELECT json_extract(value, '$.metadata.id') FROM json_each(?)) LIMIT 1").bind(owner, JSON.stringify(manifest.assets)),
    ]);
    if (collisions.some(result => result.results.length)) throw new Error('備份識別與其他擁有者衝突');
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
        ...target.pages.map(page => db.prepare("INSERT INTO restore_members SELECT ?, ?, ?, 'new' WHERE EXISTS (SELECT 1 FROM restore_operations WHERE id = ?)").bind(id, page.metadata.id, crypto.randomUUID(), id)),
      ];
      const result = await db.batch(initial); if (!result[0].meta.changes) throw new PageError(409, '頁面變更處理中');
      op = { id, backup_id: backup, rollback_id: null, phase: 'pausing' };
    }
    const members = (await db.prepare('SELECT * FROM restore_members WHERE operation_id = ? ORDER BY page_id').bind(op.id).all<Member>()).results;
    if (op.phase === 'pausing') {
      for (const member of members.filter(member => member.kind === 'old')) await this.env.SYNC.getByName(await roomName(owner, member.page_id, member.generation)).pause();
      await db.prepare("UPDATE restore_operations SET phase = 'paused' WHERE id = ?").bind(op.id).run(); op.phase = 'paused';
    }
    if (op.phase === 'paused') {
      const rollback = await createBackup(this.env, owner, () => this.now(), op.id);
      await db.prepare("UPDATE restore_operations SET rollback_id = ?, phase = 'preparing' WHERE id = ?").bind(rollback.id, op.id).run();
      op.rollback_id = rollback.id; op.phase = 'preparing';
    }
    if (op.phase === 'preparing') {
      const prefix = `${owner}/${backup}/`; const generations = new Map(members.filter(member => member.kind === 'new').map(member => [member.page_id, member.generation]));
      for (const page of target.pages) {
        const generation = generations.get(page.metadata.id)!;
        await this.env.SYNC.getByName(await roomName(owner, page.metadata.id, generation)).prepare({ owner, page: page.metadata.id, generation }, await readFile(this.env, prefix, page.file), page.checkpoint);
      }
      for (const asset of target.assets) {
        const key = `${owner}/${asset.metadata.id}/restore/${op.id}`; const existing = await this.env.ASSETS.get(key);
        const bytes = await readFile(this.env, prefix, asset.file);
        if (!existing) await this.env.ASSETS.put(key, bytes, { onlyIf: { etagDoesNotMatch: '*' }, sha256: await crypto.subtle.digest('SHA-256', bytes), httpMetadata: { contentType: asset.metadata.mime_type } });
        const copied = await this.env.ASSETS.get(key);
        if (!copied || copied.size !== bytes.length || !equal(new Uint8Array(await copied.arrayBuffer()), bytes)) throw new Error('還原圖片準備失敗');
      }
      const remaining = new Map(target.pages.map(page => [page.metadata.id, page])); const ordered: typeof target.pages = []; const inserted = new Set<string>();
      while (remaining.size) {
        for (const [id, page] of remaining) if (page.metadata.parent_id === null || inserted.has(page.metadata.parent_id)) { ordered.push(page); inserted.add(id); remaining.delete(id); }
      }
      await db.batch([
        db.prepare('DELETE FROM pages WHERE owner_id = ?').bind(owner),
        ...ordered.map(({ metadata: p }) => db.prepare('INSERT INTO pages (id, owner_id, kind, title, parent_id, journal_date, sync_generation, metadata_revision, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(p.id, owner, p.kind, p.title, p.parent_id, p.journal_date, generations.get(p.id)!, p.metadata_revision, p.created_at, p.updated_at, p.deleted_at)),
        ...target.assets.map(({ metadata: a }) => db.prepare(`INSERT INTO assets (id, owner_id, object_key, original_name, mime_type, byte_size, checksum, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET object_key = excluded.object_key, original_name = excluded.original_name, mime_type = excluded.mime_type, byte_size = excluded.byte_size, checksum = excluded.checksum, created_at = excluded.created_at WHERE assets.owner_id = excluded.owner_id`)
          .bind(a.id, owner, `${owner}/${a.id}/restore/${op!.id}`, a.original_name, a.mime_type, a.byte_size, a.checksum, a.created_at)),
        db.prepare("UPDATE restore_operations SET phase = 'resuming' WHERE id = ? AND phase = 'preparing'").bind(op.id),
      ]); op.phase = 'resuming';
    }
    for (const member of members.filter(member => member.kind === 'new')) {
      const room = this.env.SYNC.getByName(await roomName(owner, member.page_id, member.generation));
      await room.reindex({ owner, page: member.page_id, generation: member.generation }); await room.resume();
    }
    await db.batch([
      db.prepare('INSERT INTO completed_restores VALUES (?, ?, ?, ?, ?)').bind(op.id, owner, backup, op.rollback_id!, await this.now()),
      db.prepare('DELETE FROM restore_operations WHERE id = ?').bind(op.id),
    ]);
    return { ok: true, rollback: op.rollback_id! };
  }
}
function equal(a: Uint8Array, b: Uint8Array): boolean { return a.length === b.length && a.every((value, index) => value === b[index]); }
