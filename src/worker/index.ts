import { routePartykitRequest } from 'partyserver';
import type { Connection } from 'partyserver';
import { YServer } from 'y-partyserver';
import { fromBase64 } from 'lib0/buffer';
import * as decoding from 'lib0/decoding';
import * as Y from 'yjs';

// shortcut: 原型單筆更新限 512 KiB；正式正文限制須在產品整合前驗證。
const MAX_UPDATE_BYTES = 512 * 1024;

export class ProbeRoom extends YServer<Env> {
  static options = { hibernate: true };
  private tail: Promise<void> = Promise.resolve();

  async onLoad(): Promise<Y.Doc> {
    const sql = this.ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS updates (checkpoint INTEGER PRIMARY KEY AUTOINCREMENT, payload BLOB NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY CHECK(id = 1), checkpoint INTEGER NOT NULL, payload BLOB NOT NULL)');
    const doc = new Y.Doc();
    try {
      for (const row of sql.exec<{ payload: ArrayBuffer }>('SELECT payload FROM snapshot')) Y.applyUpdate(doc, new Uint8Array(row.payload));
      for (const row of sql.exec<{ payload: ArrayBuffer }>('SELECT payload FROM updates ORDER BY checkpoint')) Y.applyUpdate(doc, new Uint8Array(row.payload));
      return doc;
    } catch (error) {
      doc.destroy();
      throw error;
    }
  }

  onMessage(connection: Connection, message: string | ArrayBuffer): Promise<void> {
    const work = this.tail.then(() => this.receive(connection, message));
    this.tail = work.catch(() => {});
    return work;
  }

  private async receive(connection: Connection, message: string | ArrayBuffer): Promise<void> {
    let id: string | undefined;
    try {
      let update: Uint8Array | undefined;
      if (typeof message === 'string') {
        if (!message.startsWith('__YPS:') || message.length > MAX_UPDATE_BYTES * 1.4 + 256) throw new Error('無效提交');
        const value: unknown = JSON.parse(message.slice(6));
        if (!value || typeof value !== 'object' || !('type' in value) || value.type !== 'commit'
          || !('id' in value) || typeof value.id !== 'string' || !/^[\w-]{1,80}$/.test(value.id)
          || !('update' in value) || typeof value.update !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.update)) throw new Error('無效提交');
        id = value.id;
        update = fromBase64(value.update);
      } else {
        const bytes = new Uint8Array(message);
        if (bytes.length > MAX_UPDATE_BYTES + 16) throw new Error('更新超限');
        const decoder = decoding.createDecoder(bytes);
        if (decoding.readVarUint(decoder) === 0) {
          const subtype = decoding.readVarUint(decoder);
          if (subtype === 1 || subtype === 2) update = decoding.readVarUint8Array(decoder);
        }
      }
      if (update) {
        if (update.byteLength > MAX_UPDATE_BYTES) throw new Error('更新超限');
        const candidate = new Y.Doc();
        try {
          Y.applyUpdate(candidate, Y.encodeStateAsUpdate(this.document));
          Y.applyUpdate(candidate, update);
        } finally {
          candidate.destroy();
        }
        const checkpoint = this.ctx.storage.transactionSync(() => {
          this.ctx.storage.sql.exec('INSERT INTO updates (payload) VALUES (?)', update!);
          return this.ctx.storage.sql.exec<{ checkpoint: number }>('SELECT last_insert_rowid() AS checkpoint').one().checkpoint;
        });
        await this.ctx.storage.sync();
        if (id) this.sendCustomMessage(connection, JSON.stringify({ type: 'persisted', id, checkpoint }));
      }
      // 預設廣播同步發生在 applyUpdate；必須先完成持久寫入才交給套件。
      if (typeof message === 'string') Y.applyUpdate(this.document, update!, connection);
      else super.onMessage(connection, message);
    } catch {
      this.sendCustomMessage(connection, JSON.stringify({ type: 'error', id, message: '更新未保存，請重試' }));
    }
  }

  async onRequest(request: Request): Promise<Response> {
    await this.tail;
    const path = new URL(request.url).pathname;
    if (path.endsWith('/state')) return new Response(Y.encodeStateAsUpdate(this.document));
    if (path.endsWith('/compact') && request.method === 'POST') {
      try {
        const checkpoint = this.ctx.storage.sql.exec<{ checkpoint: number }>(
          'SELECT COALESCE(MAX(checkpoint), 0) AS checkpoint FROM (SELECT checkpoint FROM updates UNION ALL SELECT checkpoint FROM snapshot)',
        ).one().checkpoint;
        this.ctx.storage.transactionSync(() => {
          this.ctx.storage.sql.exec('INSERT OR REPLACE INTO snapshot VALUES (1, ?, ?)', checkpoint, Y.encodeStateAsUpdate(this.document));
          this.ctx.storage.sql.exec('DELETE FROM updates WHERE checkpoint <= ?', checkpoint);
        });
        await this.ctx.storage.sync();
        return new Response('ok');
      } catch {
        return new Response('整理失敗，原紀錄保留', { status: 503 });
      }
    }
    return new Response('Not found', { status: 404 });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      return new Response('原型只限本機', { status: 403 });
    }
    if (url.pathname === '/health') return new Response('ok');
    return await routePartykitRequest(request, env) ?? new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
