import { contentPermission, type ContentCredential } from './mcp-permissions';
import { keyHash } from './api-keys';
import { blockEditor, validatedBlocks, replaceBlocks, readBlocks } from './block-json';
import type { Connection, ConnectionContext } from 'partyserver';
import { ProbeRoom } from './index';
import { VISIBLE } from './pages';
import { roomName } from '../shared/room';
import * as Y from 'yjs';
import { noteLinkId } from '../shared/note-links';
import { syncedBlockIds } from '../shared/synced-blocks';
import { fromBase64 } from 'lib0/buffer';
import * as decoding from 'lib0/decoding';

type Permission = { session: string; owner: string; page: string; generation: string; allowed: boolean; kind?: 'syncedBlock'; referencePage?: string };
export type Scope = Pick<Permission, 'owner' | 'page' | 'generation' | 'kind'>;
const scopeRoomName = (scope: Scope) => roomName(scope.owner, scope.kind === 'syncedBlock' ? `synced-block:${scope.page}` : scope.page, scope.generation);

export class SyncRoom extends ProbeRoom {
  private permissionTail: Promise<void> = Promise.resolve();
  private paused = false;
  private confirmations: { connection: Connection; message: string }[] | undefined;
  protected async now(): Promise<number> { return Date.now(); }
  async onStart(): Promise<void> {
    this.paused = await this.ctx.storage.get<boolean>('page-paused') ?? false;
    await this.prune(); await super.onStart();
    const scope = await this.ctx.storage.get<Scope>('scope');
    if (scope) await this.index(scope).catch(() => {});
  }

  *getConnections<TState = unknown>(tag?: string): Iterable<Connection<TState>> {
    for (const connection of super.getConnections<TState>(tag)) {
      if (!this.paused && (connection.state as Permission | null)?.allowed) yield connection;
    }
  }

  private async valid(state: Permission | null): Promise<boolean> {
    if (!state || this.paused) return false;
    const row = state.kind === 'syncedBlock'
      ? await this.env.DB.prepare(`${VISIBLE} SELECT session.expiresAt FROM session JOIN user ON user.id = session.userId
      JOIN synced_blocks block ON block.owner_id = user.id JOIN visible page ON page.owner_id = user.id
      WHERE session.id = ? AND user.id = ? AND lower(user.email) = ?
      AND block.id = ? AND block.sync_generation = ? AND page.id = ?`)
      .bind(state.owner, state.session, state.owner, this.env.OWNER_EMAIL.toLowerCase(), state.page, state.generation, state.referencePage ?? '').first<{ expiresAt: string }>()
      : await this.env.DB.prepare(`${VISIBLE} SELECT session.expiresAt FROM session JOIN user ON user.id = session.userId
      JOIN pages ON pages.owner_id = user.id WHERE session.id = ? AND user.id = ? AND user.email = ?
      AND pages.id = ? AND pages.sync_generation = ? AND pages.id IN (SELECT id FROM visible)`)
      .bind(state.owner, state.session, state.owner, this.env.OWNER_EMAIL.toLowerCase(), state.page, state.generation).first<{ expiresAt: string }>();
    if (!row || new Date(row.expiresAt).getTime() <= await this.now()) return false;
    if (state.kind === 'syncedBlock') {
      const page = await this.env.DB.prepare(`${VISIBLE} SELECT sync_generation FROM visible WHERE id = ?`).bind(state.owner, state.referencePage ?? '').first<{ sync_generation: string }>();
      if (!page) return false;
      return this.env.SYNC.getByName(await roomName(state.owner, state.referencePage!, page.sync_generation))
        .hasSyncedBlockReference({ owner: state.owner, page: state.referencePage!, generation: page.sync_generation }, state.page);
    }
    return true;
  }

  private async prune(): Promise<void> {
    for (const connection of super.getConnections<Permission>()) {
      let allowed = false;
      try { allowed = await this.valid(connection.state); } catch { /* 權限儲存不可用時拒絕傳送。 */ }
      connection.setState(connection.state ? { ...connection.state, allowed } : null);
      if (!allowed) connection.close(4001, '登入或頁面權限已失效');
    }
  }

  async onConnect(connection: Connection<Permission>, context: ConnectionContext): Promise<void> {
    const headers = context.request.headers;
    connection.setState({ session: headers.get('x-p-note-session') ?? '', owner: headers.get('x-p-note-owner') ?? '', page: headers.get('x-p-note-page') ?? '', generation: headers.get('x-p-note-generation') ?? '', allowed: false,
      ...(headers.get('x-p-note-kind') === 'syncedBlock' ? { kind: 'syncedBlock', referencePage: headers.get('x-p-note-reference-page') ?? '' } : {}) });
    const { owner, page, generation, kind } = connection.state!;
    await this.ctx.storage.put('scope', { owner, page, generation, ...(kind ? { kind } : {}) });
    await this.prune(); if (connection.state?.allowed) super.onConnect(connection, context);
  }

  onMessage(connection: Connection<Permission>, message: string | ArrayBuffer): Promise<void> {
    const work = this.permissionTail.then(async () => {
      await this.prune();
      if (connection.state?.allowed) {
        try { await this.validateUpdate(connection.state, message); }
        catch {
          let id: string | undefined;
          try { if (typeof message === 'string' && message.startsWith('__YPS:')) id = JSON.parse(message.slice(6)).id; } catch { /* 保留無效訊息的拒絕回覆。 */ }
          super.sendCustomMessage(connection, JSON.stringify({ type: 'error', id, message: '區塊內容或同步引用無效，更新未保存' })); return;
        }
        await this.prune(); if (!connection.state?.allowed) return;
        this.confirmations = [];
        try {
          await super.onMessage(connection, message);
          await this.index(connection.state).catch(() => {});
          for (const reply of this.confirmations) super.sendCustomMessage(reply.connection, reply.message);
        } finally { this.confirmations = undefined; }
      }
    });
    this.permissionTail = work.catch(() => {}); return work;
  }

  sendCustomMessage(connection: Connection, message: string): void {
    if (this.confirmations && JSON.parse(message).type === 'persisted') this.confirmations.push({ connection, message });
    else super.sendCustomMessage(connection, message);
  }

  private async validateUpdate(scope: Scope, message: string | ArrayBuffer): Promise<void> {
    let update: Uint8Array | undefined;
    if (typeof message === 'string') {
      if (message.length > 512 * 1024 * 1.4 + 256 || !message.startsWith('__YPS:')) return;
      const value = JSON.parse(message.slice(6));
      if (value.type === 'commit' && typeof value.update === 'string') update = fromBase64(value.update);
    } else {
      if (message.byteLength > 512 * 1024 + 16) return;
      const decoder = decoding.createDecoder(new Uint8Array(message));
      if (decoding.readVarUint(decoder) === 0) {
        const subtype = decoding.readVarUint(decoder);
        if (subtype === 1 || subtype === 2) update = decoding.readVarUint8Array(decoder);
      }
    }
    if (!update || update.byteLength > 512 * 1024) return;
    const candidate = new Y.Doc();
    try {
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(this.document)); Y.applyUpdate(candidate, update);
      const fragment = candidate.getXmlFragment('body');
      const references = (nodes: unknown[]): boolean => nodes.some(node => node instanceof Y.XmlElement
        && (node.nodeName === 'syncedBlock' || references(node.toArray())));
      const hasReference = references(fragment.toArray());
      // 舊頁面同步也接受 Y.Text；同步區塊正文則必須是可驗證的 XML 區塊。
      if (fragment.toArray().some(node => !(node instanceof Y.XmlElement) && !(node instanceof Y.XmlText))) {
        if (scope.kind === 'syncedBlock' || hasReference) throw new Error('同步區塊正文不是 XML 區塊');
        return;
      }
      if (scope.kind === 'syncedBlock' || hasReference) {
        const editor = blockEditor();
        await validatedBlocks(readBlocks(candidate, editor), this.env, scope.owner, editor, { allowSyncedBlocks: scope.kind !== 'syncedBlock' });
      }
      const refs = syncedBlockIds(fragment);
      if (scope.kind === 'syncedBlock' && refs.length) throw new Error('同步區塊不能巢狀引用');
      for (const id of refs) if (!await this.env.DB.prepare('SELECT 1 FROM synced_blocks WHERE id = ? AND owner_id = ?').bind(id, scope.owner).first()) throw new Error('無效同步區塊引用');
    } finally { candidate.destroy(); }
  }

  async onClose(connection: Connection, code: number, reason: string, wasClean: boolean): Promise<void> {
    await this.prune(); super.onClose(connection, code, reason, wasClean);
  }
  async onRequest(): Promise<Response> { return new Response('Not found', { status: 404 }); }

  async pause(): Promise<void> {
    await this.setName(this.ctx.id.name!);
    const work = this.permissionTail.then(async () => {
      this.paused = true;
      await this.ctx.storage.put('page-paused', true); await this.ctx.storage.sync();
      for (const connection of super.getConnections()) connection.close(4002, '頁面變更處理中');
    });
    this.permissionTail = work.catch(() => {}); return work;
  }

  async resume(): Promise<void> {
    await this.setName(this.ctx.id.name!);
    const work = this.permissionTail.then(async () => {
      await this.ctx.storage.put('page-paused', false); await this.ctx.storage.sync(); this.paused = false;
    });
    this.permissionTail = work.catch(() => {}); return work;
  }

  async reindex(scope: Scope): Promise<void> {
    await this.setName(this.ctx.id.name!);
    const work = this.permissionTail.then(() => this.index(scope));
    this.permissionTail = work.catch(() => {}); return work;
  }

  async hasSyncedBlockReference(scope: Scope, id: string): Promise<boolean> {
    await this.setName(this.ctx.id.name!);
    const work = this.permissionTail.then(async () => {
      if (scope.kind || this.paused || await scopeRoomName(scope) !== this.name) return false;
      const page = await this.env.DB.prepare(`${VISIBLE} SELECT 1 FROM visible WHERE id = ? AND sync_generation = ?`).bind(scope.owner, scope.page, scope.generation).first();
      if (!page) return false;
      const doc = await this.onLoad();
      try { return syncedBlockIds(doc.getXmlFragment('body')).includes(id); } finally { doc.destroy(); }
    });
    this.permissionTail = work.then(() => {}, () => {}); return work;
  }

  async content(scope: Scope, credential: ContentCredential, input?: { blocks: unknown; etag: string }): Promise<{ status: number; message?: string; blocks?: ReturnType<typeof readBlocks>; etag?: string }> {
    await this.setName(this.ctx.id.name!);
    const work = this.permissionTail.then(async () => {
      try {
        if (!await contentPermission(this.env, credential, scope.owner, !!input, await this.now())) return { status: 401, message: 'API key 無效或已撤銷' };
        if (this.paused || await scopeRoomName(scope) !== this.name) return { status: 409, message: '頁面狀態已改變' };
        const allowed = scope.kind === 'syncedBlock'
          ? await this.env.DB.prepare(`SELECT 1 FROM synced_blocks WHERE owner_id = ? AND id = ? AND sync_generation = ?
          AND NOT EXISTS (SELECT 1 FROM restore_operations WHERE owner_id = ?)
          AND NOT EXISTS (SELECT 1 FROM page_operations WHERE owner_id = ?)`).bind(scope.owner, scope.page, scope.generation, scope.owner, scope.owner).first()
          : await this.env.DB.prepare(`${VISIBLE} SELECT 1 FROM visible WHERE id = ? AND sync_generation = ?
          AND NOT EXISTS (SELECT 1 FROM restore_operations WHERE owner_id = ?)
          AND NOT EXISTS (SELECT 1 FROM page_operations WHERE owner_id = ?)`).bind(scope.owner, scope.page, scope.generation, scope.owner, scope.owner).first();
        if (!allowed) return { status: 409, message: '頁面狀態已改變' };
        const doc = await this.onLoad();
        try {
          const editor = blockEditor();
          const before = Y.encodeStateAsUpdate(doc);
          const etag = '"' + scope.generation + ':' + await keyHash(Array.from(before).join(',')) + '"';
          if (!input) return { status: 200, blocks: readBlocks(doc, editor), etag };
          if (input.etag !== etag) return { status: 412, message: '正文已更新，請重新讀取後再修改' };
          const blocks = await validatedBlocks(input.blocks, this.env, scope.owner, editor, { allowSyncedBlocks: scope.kind !== 'syncedBlock' });
          const vector = Y.encodeStateVector(doc);
          replaceBlocks(doc, blocks, editor);
          const output = readBlocks(doc, editor);
          const update = Y.encodeStateAsUpdate(doc, vector);
          if (update.length > 512 * 1024) return { status: 400, message: '正文更新超過大小限制' };
          await this.prune();
          if (!await contentPermission(this.env, credential, scope.owner, true, await this.now())) return { status: 401, message: 'API key 已撤銷' };
          const modified = await this.now();
          this.ctx.storage.transactionSync(() => {
            this.ctx.storage.sql.exec('INSERT INTO updates (payload) VALUES (?)', update);
            this.ctx.storage.sql.exec('INSERT INTO document_metadata VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET modified_at = MAX(modified_at, excluded.modified_at)', modified);
          });
          await this.ctx.storage.sync();
          Y.applyUpdate(this.document, update);
          await this.ctx.storage.put('scope', scope);
          await this.index(scope).catch(() => {});
          try {
            const pending = this.ctx.storage.sql.exec<{ count: number; bytes: number }>('SELECT count(*) AS count, COALESCE(SUM(length(payload)), 0) AS bytes FROM updates').one();
            if (pending.count >= 64 || pending.bytes >= 2 * 1024 * 1024) await this.compact();
          } catch { /* 整理失敗保留已保存的紀錄，下一次更新重試。 */ }
          return { status: 200, blocks: output, etag: '"' + scope.generation + ':' + await keyHash(Array.from(Y.encodeStateAsUpdate(doc)).join(',')) + '"' };
        } finally { doc.destroy(); }
      } catch (failure) { return { status: failure instanceof Error && 'status' in failure && failure.status === 400 ? 400 : 503, message: '正文未能處理，請檢查格式或稍後重試' }; }
    });
    this.permissionTail = work.then(() => {}, () => {}); return work;
  }

  async capture(scope: Scope): Promise<{ data: Uint8Array; checkpoint: number; generation: string; capturedAt: number }> {
    await this.setName(this.ctx.id.name!);
    const work = this.permissionTail.then(async () => {
      const matches = async () => await scopeRoomName(scope) === this.name
        && !!await this.env.DB.prepare(`SELECT 1 FROM ${scope.kind === 'syncedBlock' ? 'synced_blocks' : 'pages'} WHERE id = ? AND owner_id = ? AND sync_generation = ?
          AND NOT EXISTS (SELECT 1 FROM page_operations WHERE owner_id = ?)`).bind(scope.page, scope.owner, scope.generation, scope.owner).first();
      if (!await matches()) throw new Error('備份頁面世代或結構已變更');
      await this.ctx.storage.sync();
      // 從持久紀錄重建，避免以尚未落盤的程序狀態宣稱備份成功。
      const doc = await this.onLoad();
      try {
        const data = Y.encodeStateAsUpdate(doc);
        const checkpoint = this.ctx.storage.sql.exec<{ checkpoint: number }>('SELECT COALESCE(MAX(checkpoint), 0) AS checkpoint FROM (SELECT checkpoint FROM updates UNION ALL SELECT checkpoint FROM snapshot)').one().checkpoint;
        const capturedAt = await this.now();
        if (!await matches()) throw new Error('備份頁面世代或結構已變更');
        return { data, checkpoint, capturedAt, generation: scope.generation };
      } finally { doc.destroy(); }
    });
    this.permissionTail = work.then(() => {}, () => {}); return work;
  }

  async prepare(scope: Scope, data: Uint8Array, checkpoint: number): Promise<void> {
    await this.setName(this.ctx.id.name!);
    const work = this.permissionTail.then(async () => {
      if (await scopeRoomName(scope) !== this.name
        || await this.env.DB.prepare(`SELECT 1 FROM ${scope.kind === 'syncedBlock' ? 'synced_blocks' : 'pages'} WHERE id = ? AND owner_id = ? AND sync_generation = ?`).bind(scope.page, scope.owner, scope.generation).first()) throw new Error('不能覆寫活躍房間');
      const candidate = new Y.Doc(); let expected: Uint8Array;
      try { Y.applyUpdate(candidate, data); expected = Y.encodeStateAsUpdate(candidate); } finally { candidate.destroy(); }
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', expected)), value => value.toString(16).padStart(2, '0')).join('');
      const previous = await this.ctx.storage.get<string>('prepared-hash');
      if (previous && previous !== digest) throw new Error('準備世代已有不同內容');
      this.paused = true; await this.ctx.storage.put('page-paused', true);
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec('INSERT OR REPLACE INTO snapshot VALUES (1, ?, ?)', checkpoint, expected);
        this.ctx.storage.sql.exec('DELETE FROM updates');
      });
      await this.ctx.storage.put('scope', scope); await this.ctx.storage.put('prepared-hash', digest); await this.ctx.storage.sync();
      Y.applyUpdate(this.document, expected);
      const recovered = await this.onLoad(); try {
        if (!equal(Y.encodeStateAsUpdate(recovered), expected)) throw new Error('還原正文校驗失敗');
      } finally { recovered.destroy(); }
    });
    this.permissionTail = work.then(() => {}, () => {}); return work;
  }

  private async index(scope: Scope): Promise<void> {
    if (await scopeRoomName(scope) !== this.name) return;
    const modified = this.ctx.storage.sql.exec<{ modified_at: number }>('SELECT modified_at FROM document_metadata WHERE id = 1').toArray()[0]?.modified_at;
    if (modified !== undefined) await this.env.DB.prepare(`UPDATE ${scope.kind === 'syncedBlock' ? 'synced_blocks' : 'pages'} SET updated_at = MAX(updated_at, ?) WHERE id = ? AND owner_id = ? AND sync_generation = ?`)
      .bind(modified, scope.page, scope.owner, scope.generation).run();
    const fragment = this.document.getXmlFragment('body');
    const linked = new Set<string>();
    for (const node of fragment.createTreeWalker(node => node instanceof Y.XmlText)) {
      for (const part of (node as Y.XmlText).toDelta()) {
        const id = noteLinkId(part.attributes?.link?.href);
        if (id) linked.add(id);
      }
    }
    const plain = Array.from(fragment.createTreeWalker(node => node instanceof Y.XmlText))
      .map(node => (node as Y.XmlText).toDelta().map((part: { insert: unknown }) => typeof part.insert === 'string' ? part.insert : '').join('')).join('\n').normalize('NFC');
    const checkpoint = this.ctx.storage.sql.exec<{ checkpoint: number }>('SELECT COALESCE(MAX(checkpoint), 0) AS checkpoint FROM (SELECT checkpoint FROM updates UNION ALL SELECT checkpoint FROM snapshot)').one().checkpoint;
    if (scope.kind === 'syncedBlock') {
      await this.env.DB.prepare(`INSERT INTO synced_block_search (synced_block_id, owner_id, plain_text, linked_pages, indexed_generation, indexed_checkpoint)
        SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM synced_blocks WHERE id = ? AND owner_id = ? AND sync_generation = ?)
        ON CONFLICT(synced_block_id) DO UPDATE SET plain_text = excluded.plain_text, linked_pages = excluded.linked_pages,
          indexed_generation = excluded.indexed_generation, indexed_checkpoint = excluded.indexed_checkpoint
        WHERE excluded.indexed_generation <> synced_block_search.indexed_generation OR excluded.indexed_checkpoint >= synced_block_search.indexed_checkpoint`)
        .bind(scope.page, scope.owner, plain, JSON.stringify([...linked].sort()), scope.generation, checkpoint, scope.page, scope.owner, scope.generation).run();
      return;
    }
    const refs = syncedBlockIds(fragment);
    await this.env.DB.batch([this.env.DB.prepare(`INSERT INTO page_search (page_id, owner_id, plain_text, summary, indexed_generation, indexed_checkpoint, linked_pages) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM pages WHERE id = ? AND owner_id = ? AND sync_generation = ?)
      ON CONFLICT(page_id) DO UPDATE SET plain_text = excluded.plain_text, summary = excluded.summary, indexed_generation = excluded.indexed_generation, indexed_checkpoint = excluded.indexed_checkpoint, linked_pages = excluded.linked_pages
      WHERE excluded.indexed_generation <> page_search.indexed_generation OR excluded.indexed_checkpoint >= page_search.indexed_checkpoint`)
      .bind(scope.page, scope.owner, plain, plain.slice(0, 160), scope.generation, checkpoint, JSON.stringify([...linked].sort()), scope.page, scope.owner, scope.generation),
    this.env.DB.prepare(`DELETE FROM page_synced_blocks WHERE page_id = ? AND EXISTS
      (SELECT 1 FROM page_search JOIN pages ON pages.id = page_search.page_id WHERE pages.id = ? AND pages.owner_id = ?
      AND pages.sync_generation = ? AND page_search.indexed_generation = ? AND page_search.indexed_checkpoint = ?)`)
      .bind(scope.page, scope.page, scope.owner, scope.generation, scope.generation, checkpoint),
    this.env.DB.prepare(`INSERT INTO page_synced_blocks (page_id, synced_block_id) SELECT ?, json_each.value FROM json_each(?)
      JOIN synced_blocks ON synced_blocks.id = json_each.value AND synced_blocks.owner_id = ? WHERE EXISTS
      (SELECT 1 FROM page_search JOIN pages ON pages.id = page_search.page_id WHERE pages.id = ? AND pages.owner_id = ?
      AND pages.sync_generation = ? AND page_search.indexed_generation = ? AND page_search.indexed_checkpoint = ?)`)
      .bind(scope.page, JSON.stringify(refs), scope.owner, scope.page, scope.owner, scope.generation, scope.generation, checkpoint)]);
  }
}
function equal(a: Uint8Array, b: Uint8Array): boolean { return a.length === b.length && a.every((value, index) => value === b[index]); }
