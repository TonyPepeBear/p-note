import type { Connection, ConnectionContext } from 'partyserver';
import { ProbeRoom } from './index';
import { VISIBLE } from './pages';
import { roomName } from '../shared/room';
import * as Y from 'yjs';

type Permission = { session: string; owner: string; page: string; generation: string; allowed: boolean };
type Scope = Pick<Permission, 'owner' | 'page' | 'generation'>;

export class SyncRoom extends ProbeRoom {
  private permissionTail: Promise<void> = Promise.resolve();
  private paused = false;
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
    const row = await this.env.DB.prepare(`${VISIBLE} SELECT session.expiresAt FROM session JOIN user ON user.id = session.userId
      JOIN pages ON pages.owner_id = user.id WHERE session.id = ? AND user.id = ? AND user.email = ?
      AND pages.id = ? AND pages.sync_generation = ? AND pages.id IN (SELECT id FROM visible)`)
      .bind(state.owner, state.session, state.owner, this.env.OWNER_EMAIL.toLowerCase(), state.page, state.generation).first<{ expiresAt: string }>();
    return !!row && new Date(row.expiresAt).getTime() > await this.now();
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
    connection.setState({ session: headers.get('x-p-note-session') ?? '', owner: headers.get('x-p-note-owner') ?? '', page: headers.get('x-p-note-page') ?? '', generation: headers.get('x-p-note-generation') ?? '', allowed: false });
    await this.ctx.storage.put('scope', { owner: connection.state!.owner, page: connection.state!.page, generation: connection.state!.generation });
    await this.prune(); if (connection.state?.allowed) super.onConnect(connection, context);
  }

  onMessage(connection: Connection<Permission>, message: string | ArrayBuffer): Promise<void> {
    const work = this.permissionTail.then(async () => {
      await this.prune();
      if (connection.state?.allowed) {
        await super.onMessage(connection, message);
        await this.index(connection.state).catch(() => {});
      }
    });
    this.permissionTail = work.catch(() => {}); return work;
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

  private async index(scope: Scope): Promise<void> {
    if (await roomName(scope.owner, scope.page, scope.generation) !== this.name) return;
    const fragment = this.document.getXmlFragment('body');
    const plain = Array.from(fragment.createTreeWalker(node => node instanceof Y.XmlText))
      .map(node => (node as Y.XmlText).toDelta().map((part: { insert: unknown }) => typeof part.insert === 'string' ? part.insert : '').join('')).join('\n').normalize('NFC');
    const checkpoint = this.ctx.storage.sql.exec<{ checkpoint: number }>('SELECT COALESCE(MAX(checkpoint), 0) AS checkpoint FROM (SELECT checkpoint FROM updates UNION ALL SELECT checkpoint FROM snapshot)').one().checkpoint;
    await this.env.DB.prepare(`INSERT INTO page_search SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM pages WHERE id = ? AND owner_id = ? AND sync_generation = ?)
      ON CONFLICT(page_id) DO UPDATE SET plain_text = excluded.plain_text, summary = excluded.summary, indexed_generation = excluded.indexed_generation, indexed_checkpoint = excluded.indexed_checkpoint
      WHERE excluded.indexed_generation <> page_search.indexed_generation OR excluded.indexed_checkpoint >= page_search.indexed_checkpoint`)
      .bind(scope.page, scope.owner, plain, plain.slice(0, 160), scope.generation, checkpoint, scope.page, scope.owner, scope.generation).run();
  }
}
