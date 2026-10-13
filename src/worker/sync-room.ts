import type { Connection, ConnectionContext } from 'partyserver';
import { ProbeRoom } from './index';

type Permission = { session: string; owner: string; page: string; generation: string; allowed: boolean };

export class SyncRoom extends ProbeRoom {
  private permissionTail: Promise<void> = Promise.resolve();
  protected async now(): Promise<number> { return Date.now(); }
  async onStart(): Promise<void> { await this.prune(); await super.onStart(); }

  *getConnections<TState = unknown>(tag?: string): Iterable<Connection<TState>> {
    for (const connection of super.getConnections<TState>(tag)) {
      if ((connection.state as Permission | null)?.allowed) yield connection;
    }
  }

  private async valid(state: Permission | null): Promise<boolean> {
    if (!state) return false;
    const row = await this.env.DB.prepare(`SELECT session.expiresAt FROM session JOIN user ON user.id = session.userId
      JOIN pages ON pages.owner_id = user.id WHERE session.id = ? AND user.id = ? AND user.email = ?
      AND pages.id = ? AND pages.sync_generation = ? AND pages.deleted_at IS NULL`)
      .bind(state.session, state.owner, this.env.OWNER_EMAIL.toLowerCase(), state.page, state.generation).first<{ expiresAt: string }>();
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
    await this.prune(); if (connection.state?.allowed) super.onConnect(connection, context);
  }

  onMessage(connection: Connection<Permission>, message: string | ArrayBuffer): Promise<void> {
    const work = this.permissionTail.then(async () => { await this.prune(); if (connection.state?.allowed) await super.onMessage(connection, message); });
    this.permissionTail = work.catch(() => {}); return work;
  }

  async onClose(connection: Connection, code: number, reason: string, wasClean: boolean): Promise<void> {
    await this.prune(); super.onClose(connection, code, reason, wasClean);
  }
  async onRequest(): Promise<Response> { return new Response('Not found', { status: 404 }); }
}
