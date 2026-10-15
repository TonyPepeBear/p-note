import { IndexeddbPersistence } from 'y-indexeddb';
import YProvider from 'y-partyserver/provider';
import * as Y from 'yjs';
import { toBase64 } from 'lib0/buffer';
import { api, registerDraft } from './api';
import { saveLocal } from './cache';
import { isCurrentReceipt } from '../shared/receipt';
import { roomName } from '../shared/room';

export type SyncedMetadata = { id: string; sync_generation: string; room?: string };
export type SyncedState = { ready: boolean; local: string; cloud: string; error: string; blocked?: boolean };
export type SyncedScope = { ownerId: string; pageId: string; generation: string; checkAccess?: () => Promise<boolean>; readOnly?: boolean };
const sessions = new Map<string, Promise<SyncedSession>>();
const metadataKey = (owner: string, id: string, generation: string) => `p-note:synced-block:${owner}:${id}:${generation}`;

export async function createSyncedBlock(blocks: unknown[]): Promise<SyncedMetadata> {
  if (!navigator.onLine) throw new Error('離線時不能建立同步區塊');
  const response = await api('/api/synced-blocks', { blocks }, AbortSignal.timeout(15000));
  if (!response.ok) throw new Error('同步區塊建立失敗，請重試');
  return response.json();
}

export class SyncedSession {
  state: SyncedState = { ready: false, local: '本機儲存中', cloud: '同步中', error: '' };
  listeners = new Set<(state: SyncedState) => void>();
  revision = 0;
  latestId: string | undefined;
  stopped = false;
  connecting = false;
  retries = 1000;
  timer: ReturnType<typeof setTimeout> | undefined;
  loadTimer: ReturnType<typeof setTimeout>;
  unregisterDraft: () => void;
  users = 0;
  constructor(public scope: SyncedScope, public metadata: SyncedMetadata, public doc: Y.Doc,
    public cache: IndexeddbPersistence, public provider: YProvider) {
    this.loadTimer = setTimeout(() => {
      if (!this.stopped && !this.state.ready) this.publish({ cloud: navigator.onLine ? '同步區塊載入失敗' : '離線，待同步', error: navigator.onLine ? '同步區塊載入失敗，請重試' : '離線無法載入' });
    }, 10000);
    this.unregisterDraft = registerDraft(() => this.state.ready ? saveLocal(cache) : Promise.resolve(), () => this.state.ready && this.state.local !== '本機已儲存');
    doc.on('update', this.updated);
    provider.on('sync', this.synced);
    provider.on('custom-message', this.receipt);
    provider.on('connection-close', this.closed);
    window.addEventListener('online', this.connect);
    window.addEventListener('offline', this.offline);
    window.addEventListener('focus', this.foreground);
  }
  publish(next: Partial<SyncedState>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener(this.state);
  }
  updated = (_update: Uint8Array, origin: unknown) => { if (origin !== this.cache && this.state.ready) void this.flush(); };
  flush = async () => {
    const revision = ++this.revision;
    this.latestId = undefined;
    this.publish({ local: '本機儲存中', cloud: navigator.onLine ? '同步中' : '離線，待同步' });
    try {
      await saveLocal(this.cache);
      if (this.stopped || revision !== this.revision) return;
      this.publish({ local: '本機已儲存' });
      if (!this.scope.readOnly && !this.state.blocked && this.provider.wsconnected && this.provider.synced) {
        this.latestId = crypto.randomUUID();
        this.provider.sendMessage(JSON.stringify({ type: 'commit', id: this.latestId, update: toBase64(Y.encodeStateAsUpdate(this.doc)) }));
      }
    } catch {
      if (!this.stopped && revision === this.revision) this.publish({ local: '本機儲存失敗', cloud: '同步區塊儲存失敗', error: '同步區塊本機儲存失敗，請重試' });
    }
  };
  synced = (value: boolean) => {
    if (!value || this.stopped) return;
    this.retries = 1000;
    this.publish({ ready: true, error: '', blocked: false });
    void this.flush();
  };
  receipt = (message: string) => {
    try {
      const value = JSON.parse(message);
      if (isCurrentReceipt(this.latestId, value)) this.publish({ cloud: '雲端已儲存', error: '' });
      else if (value?.type === 'error') this.publish({ cloud: '同步區塊儲存失敗', error: '同步區塊儲存失敗，請重試' });
    } catch { this.publish({ cloud: '同步區塊儲存失敗', error: '同步區塊回應異常，請重試' }); }
  };
  later = () => {
    if (this.stopped || this.scope.readOnly || this.state.blocked || !navigator.onLine || this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.connect(); }, this.retries);
    this.retries = Math.min(this.retries * 2, 30000);
  };
  connect = () => {
    if (this.stopped || this.scope.readOnly || this.connecting || !navigator.onLine) return;
    this.connecting = true;
    clearTimeout(this.timer); this.timer = undefined;
    this.publish({ cloud: '同步中' });
    void (async () => {
      if (this.scope.checkAccess && !(await this.scope.checkAccess())) { this.publish({ blocked: true }); throw new Error('頁面權限或世代已變更，本機內容已保留'); }
      const response = await api('/api/synced-blocks/' + encodeURIComponent(this.metadata.id), undefined, AbortSignal.timeout(8000));
      if (response.status === 401 || response.status === 403 || response.status === 404 || response.status === 409) {
        this.publish({ blocked: true });
        throw new Error('同步區塊已無法存取，本機內容已保留');
      }
      if (!response.ok) throw new Error('同步區塊載入失敗，請重試');
      const current = await response.json() as SyncedMetadata;
      if (current.sync_generation !== this.metadata.sync_generation) {
        this.publish({ blocked: true });
        throw new Error('同步區塊已還原為新版本，本機內容已保留');
      }
      if (this.stopped) return;
      const stale = this.provider.ws;
      if (stale && stale.readyState >= WebSocket.CLOSING) {
        stale.addEventListener('close', event => event.stopImmediatePropagation(), { capture: true });
        this.provider.ws = null; this.provider.wsconnected = false; this.provider.synced = false;
      }
      await this.provider.connect();
    })().catch(failure => {
      if (this.stopped) return;
      this.publish({ cloud: '同步區塊載入失敗', error: failure instanceof Error ? failure.message : '同步區塊載入失敗，請重試' });
      this.later();
    }).finally(() => { this.connecting = false; });
  };
  closed = () => {
    if (this.stopped) return;
    this.latestId = undefined;
    this.provider.disconnect();
    this.publish({ cloud: navigator.onLine ? '同步區塊連線失敗' : '離線，待同步', error: navigator.onLine ? '同步區塊連線失敗，請重試' : '' });
    this.later();
  };
  offline = () => {
    clearTimeout(this.timer); this.timer = undefined;
    this.latestId = undefined; this.provider.disconnect();
    this.publish({ cloud: '離線，待同步', error: this.state.ready ? '' : '離線無法載入' });
  };
  foreground = () => { if (document.visibilityState === 'visible' && !this.provider.wsconnected) this.connect(); };
  retry = () => {
    if (!this.state.ready) this.provider.disconnect();
    this.connect();
    if (this.state.ready) void this.flush();
  };
  destroy() {
    this.stopped = true; clearTimeout(this.timer); clearTimeout(this.loadTimer);
    this.unregisterDraft();
    window.removeEventListener('online', this.connect); window.removeEventListener('offline', this.offline); window.removeEventListener('focus', this.foreground);
    this.doc.off('update', this.updated); this.provider.off('sync', this.synced); this.provider.off('custom-message', this.receipt); this.provider.off('connection-close', this.closed);
    this.provider.destroy();
    void this.cache.destroy(); this.doc.destroy();
  }
}

async function open(scope: SyncedScope, id: string): Promise<SyncedSession> {
  let metadata: SyncedMetadata | undefined;
  try { metadata = JSON.parse(localStorage.getItem(metadataKey(scope.ownerId, id, scope.generation)) ?? 'null') ?? undefined; } catch { /* 不使用損毀的本機中繼資料。 */ }
  if (!metadata) {
    if (!navigator.onLine) throw new Error('離線無法載入');
    const response = await api('/api/synced-blocks/' + encodeURIComponent(id), undefined, AbortSignal.timeout(8000));
    if (!response.ok) throw new Error('同步區塊載入失敗，請重試');
    metadata = await response.json() as SyncedMetadata;
    localStorage.setItem(metadataKey(scope.ownerId, id, scope.generation), JSON.stringify(metadata));
  }
  const room = await roomName(scope.ownerId, `synced-block:${id}`, metadata.sync_generation);
  const doc = new Y.Doc();
  const cache = new IndexeddbPersistence(`p-note:${room}`, doc);
  await cache._db; await cache.whenSynced;
  doc.off('update', cache._storeUpdate);
  const downloaded = !!await cache.get('downloaded');
  if (!downloaded && (!navigator.onLine || scope.readOnly)) {
    await cache.destroy(); doc.destroy();
    throw new Error(navigator.onLine ? '此同步區塊尚未下載' : '離線無法載入');
  }
  const provider = new YProvider(location.host, room, doc, {
    party: 'sync', connect: false, disableBc: true, protocol: location.protocol === 'https:' ? 'wss' : 'ws',
    params: { syncedBlock: id, page: scope.pageId, generation: metadata.sync_generation },
  });
  const session = new SyncedSession(scope, metadata, doc, cache, provider);
  if (downloaded) { session.publish({ ready: true, local: '本機已儲存', cloud: navigator.onLine ? '同步中' : '離線，待同步' }); }
  session.connect();
  return session;
}

export async function acquireSyncedSession(scope: SyncedScope, id: string) {
  const key = JSON.stringify([scope.ownerId, scope.pageId, scope.generation, !!scope.readOnly, id]);
  let pending = sessions.get(key);
  if (!pending) {
    pending = open(scope, id);
    sessions.set(key, pending);
    void pending.catch(() => { if (sessions.get(key) === pending) sessions.delete(key); });
  }
  const session = await pending;
  session.users++;
  return { session, release: () => {
    session.users--;
    if (!session.users) {
      // 先完成本機交易再關閉，讓換頁保留最後一次編輯。
      void (session.state.ready ? saveLocal(session.cache) : Promise.resolve()).then(() => {
        if (!session.users) { session.destroy(); if (sessions.get(key) === pending) sessions.delete(key); }
      }).catch(() => {
        // 最後一個引用被移除也不能丟掉尚未落盤的草稿；再次引用時仍可重試。
        session.publish({ local: '本機儲存失敗', error: '同步區塊本機儲存失敗，請重試' });
      });
    }
  } };
}
