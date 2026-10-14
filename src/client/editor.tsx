import { useEffect, useRef, useState } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { withCollaboration } from '@blocknote/core/yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import YProvider from 'y-partyserver/provider';
import * as Y from 'yjs';
import { toBase64 } from 'lib0/buffer';
import { saveLocal, readLocal } from './cache';
import { isCurrentReceipt } from '../shared/receipt';
import { roomName } from '../shared/room';
import { IMAGE_TYPES, IMAGE_RULE } from '../shared/image';
import { uploadImage } from './assets';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import './style.css';

export type Session = { doc: Y.Doc; cache: IndexeddbPersistence; provider: YProvider; room: string; checkAccess?: () => Promise<boolean> };

export function Editor({ session, title, readOnly = false }: { session: Session; title?: string; readOnly?: boolean }) {
  const { doc, cache, provider, room } = session;
  const [image, setImage] = useState<{ file: File; blockId?: string }>();
  const [uploading, setUploading] = useState(false);
  const [imageError, setImageError] = useState('');
  const [copyError, setCopyError] = useState('');
  const editor = useCreateBlockNote(withCollaboration({
    collaboration: { fragment: doc.getXmlFragment('body'), provider, user: { name: '本機測試', color: '#2563eb' } },
    ...(title ? { uploadFile: async (file: File, blockId?: string) => {
      setImage({ file, blockId }); setUploading(true); setImageError('');
      try { const url = await uploadImage(file); setImage(undefined); return url; }
      catch (failure) { setImageError(failure instanceof Error ? failure.message : '圖片上傳失敗，請重試'); throw failure; }
      finally { setUploading(false); }
    } } : {}),
  }));
  const [local, setLocal] = useState('本機儲存中');
  const [cloud, setCloud] = useState('同步中');
  const [ready, setReady] = useState(false);
  const reconnect = useRef(() => {});
  useEffect(() => {
    let revision = 0;
    let latestId: string | undefined;
    let disposed = false;
    let blocked = false; let connecting = false; let retryDelay = 1000;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const flush = async () => {
      const current = ++revision;
      latestId = undefined;
      setLocal('本機儲存中');
      setCloud(!navigator.onLine ? '離線，待同步' : blocked ? '登入或頁面權限已失效'
        : session.checkAccess && !provider.shouldConnect ? '連線失敗，可重試' : '同步中');
      try {
        await saveLocal(cache);
        if (disposed || current !== revision) return;
        setLocal('本機已儲存');
        if (!readOnly && provider.wsconnected && provider.synced) {
          latestId = crypto.randomUUID();
          provider.sendMessage(JSON.stringify({ type: 'commit', id: latestId, update: toBase64(Y.encodeStateAsUpdate(doc)) }));
        }
      } catch { if (!disposed && current === revision) setLocal('本機儲存失敗'); }
    };
    const update = (_bytes: Uint8Array, origin: unknown) => { if (origin !== cache) void flush(); };
    const synced = (value: boolean) => { if (value) { retryDelay = 1000; void flush(); } };
    const receipt = (message: string) => {
      try {
        const value: unknown = JSON.parse(message);
        if (isCurrentReceipt(latestId, value)) setCloud('雲端已儲存');
        else if (value && typeof value === 'object' && 'type' in value && value.type === 'error') setCloud('雲端儲存失敗，可重試');
      } catch { setCloud('確認格式錯誤'); }
    };
    const offline = () => { clearTimeout(retryTimer); retryTimer = undefined; latestId = undefined; provider.disconnect(); setCloud('離線，待同步'); };
    const retryLater = () => {
      if (disposed || blocked || !navigator.onLine || retryTimer) return;
      retryTimer = setTimeout(() => { retryTimer = undefined; online(); }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30000);
    };
    const online = () => {
      if (readOnly || disposed || connecting || !navigator.onLine) return;
      clearTimeout(retryTimer); retryTimer = undefined; connecting = true;
      setCloud('同步中');
      void (async () => {
        if (session.checkAccess && !await session.checkAccess()) { blocked = true; setCloud('登入或頁面權限已失效'); return; }
        if (disposed) return;
        blocked = false;
        await provider.connect();
      })().catch(() => { if (!disposed) { setCloud('連線失敗，可重試'); retryLater(); } }).finally(() => { connecting = false; });
    };
    const closed = (event: CloseEvent) => {
      if (session.checkAccess) {
        latestId = undefined; provider.disconnect();
        setCloud(navigator.onLine ? '連線失敗，可重試' : '離線，待同步');
        if (event.code === 4001 || event.code === 4002) online(); else retryLater();
      }
    };
    const foreground = () => { if (document.visibilityState === 'visible' && navigator.onLine && session.checkAccess) online(); };
    const resized = () => requestAnimationFrame(() => {
      if (!disposed && editor.prosemirrorView.hasFocus()) editor.prosemirrorView.dispatch(editor.prosemirrorView.state.tr.scrollIntoView());
    });
    doc.on('update', update);
    provider.on('sync', synced);
    provider.on('custom-message', receipt);
    provider.on('connection-close', closed);
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    window.addEventListener('focus', foreground);
    window.addEventListener('resize', resized);
    window.visualViewport?.addEventListener('resize', resized);
    document.addEventListener('visibilitychange', foreground);
    window.probe = { editor, doc, provider, cache, flush, localState: () => readLocal(cache), room };
    reconnect.current = online;
    setReady(true);
    void flush();
    if (navigator.onLine && session.checkAccess && !provider.shouldConnect) online();
    return () => {
      disposed = true;
      clearTimeout(retryTimer); reconnect.current = () => {};
      doc.off('update', update);
      provider.off('sync', synced);
      provider.off('custom-message', receipt);
      provider.off('connection-close', closed);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
      window.removeEventListener('focus', foreground);
      window.removeEventListener('resize', resized);
      window.visualViewport?.removeEventListener('resize', resized);
      document.removeEventListener('visibilitychange', foreground);
      delete window.probe;
    };
  }, [doc, cache, provider, editor, room, readOnly]);

  const currentBlock = () => editor.getTextCursorPosition().block;
  const insert = (type: 'paragraph' | 'image') => {
    const [block] = editor.insertBlocks([type === 'image'
      ? { type, props: { url: '/fixtures/pixel.png', name: '測試圖片', showPreview: true } }
      : { type }], currentBlock(), 'after');
    editor.setTextCursorPosition(block, 'start');
    editor.focus();
  };
  const upload = async () => {
    if (!image || uploading) return;
    try {
      const anchor = currentBlock();
      const url = await editor.uploadFile!(image.file, image.blockId);
      if (typeof url !== 'string') return;
      const block = image.blockId && editor.getBlock(image.blockId);
      if (block) editor.updateBlock(block, { type: 'image', props: { url, name: image.file.name, showPreview: true } });
      else editor.insertBlocks([{ type: 'image', props: { url, name: image.file.name, showPreview: true } }], editor.getBlock(anchor.id) ?? editor.document[0], 'after');
    } catch (failure) {
      setImage(image); setImageError(failure instanceof Error ? failure.message : '圖片插入失敗，請重試');
    }
  };
  return <main>
    <h1>{title ?? 'p-note 技術驗證'}</h1>
    {!title && <p>本機原型：圖片為固定 fixture，正式資產服務尚未接入。</p>}
    <div className="status" aria-live="polite">
      <span data-testid="ready">{ready ? readOnly ? '僅供檢視' : '可編輯' : '載入中'}</span>
      <span data-testid="local-status">{local}</span>
      <span data-testid="cloud-status">{readOnly ? '本機草稿已隔離' : cloud}</span>
      {!readOnly && <button onClick={() => { if (!provider.wsconnected && navigator.onLine) reconnect.current(); void window.probe?.flush(); }}>重試儲存</button>}
    </div>
    {!readOnly && <details><summary>區塊操作</summary><div className="actions">
      <button onClick={() => insert('paragraph')}>插入段落</button>
      <button onClick={() => { editor.moveBlocksUp(); editor.focus(); }}>上移區塊</button>
      <button onClick={() => { editor.moveBlocksDown(); editor.focus(); }}>下移區塊</button>
      <button onClick={() => { editor.removeBlocks([currentBlock()]); editor.focus(); }}>刪除區塊</button>
    </div></details>}
    {title && !readOnly && <section className="image-upload" aria-label="圖片上傳">
      <label htmlFor="image-file">圖片檔案</label>{' '}
      <input id="image-file" type="file" accept={IMAGE_TYPES.join(',')} disabled={uploading} onChange={event => {
        setImage(event.target.files?.[0] ? { file: event.target.files[0] } : undefined); setImageError('');
      }} />
      <button disabled={!image || uploading} onClick={() => { void upload(); }}>{uploading ? '圖片上傳中' : imageError ? '重試上傳' : '上傳圖片'}</button>
      <p>{IMAGE_RULE}，保留原圖不壓縮。</p>
      {imageError && <p role="alert">{imageError}</p>}
    </section>}
    <div className="actions">
      {!title && <button onClick={() => insert('image')}>插入測試圖片</button>}
      <button onClick={async () => {
        setCopyError('');
        const block = currentBlock();
        if (block.type === 'codeBlock') {
          const code = block.content.map(item => item.type === 'text' ? item.text : '').join('');
          try { await navigator.clipboard.writeText(code); }
          catch { setCopyError('複製失敗，請手動選取程式碼複製'); }
        }
      }}>複製程式碼</button>
    </div>
    {copyError && <p role="alert">{copyError}</p>}
    <BlockNoteView editor={editor} theme="light" editable={!readOnly} />
  </main>;
}

export async function start(scope?: string[], checkAccess?: Session['checkAccess'], localOnly = false, isolated = false): Promise<Session> {
  if (!checkAccess && !['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) throw new Error('原型只限本機');
  await navigator.serviceWorker.register('/sw.js');
  if (navigator.onLine) {
    const registration = await navigator.serviceWorker.ready;
    const urls = performance.getEntriesByType('resource').map(entry => entry.name);
    await new Promise<void>((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); reject(new Error('本機啟動資源下載失敗，請重試')); }, 10000);
      channel.port1.onmessage = event => {
        clearTimeout(timer); channel.port1.close();
        if (event.data?.ok) resolve(); else reject(new Error('本機啟動資源下載失敗，請重試'));
      };
      registration.active!.postMessage({ type: 'cache-resources', urls }, [channel.port2]);
    });
  }
  const params = new URLSearchParams(location.search);
  scope ??= ['owner', 'page', 'generation'].map((name, index) => params.get(name) ?? ['owner', 'default', 'g1'][index]);
  if (scope.some(value => !/^[\w-]{1,80}$/.test(value))) throw new Error('無效頁面識別');
  const room = await roomName(scope[0], scope[1], scope[2]);
  const doc = new Y.Doc();
  const cache = new IndexeddbPersistence(`p-note:${room}`, doc);
  await cache._db;
  await cache.whenSynced;
  const downloaded = await cache.get('downloaded');
  // shortcut: y-indexeddb 9.0.12 不回報寫入完成／錯誤；升級前重驗此掛鉤與 saveLocal。
  doc.off('update', cache._storeUpdate);
  if ((!navigator.onLine || localOnly || isolated) && !downloaded) throw new Error('此頁尚未下載，請連線後再開啟');
  const provider = new YProvider(checkAccess ? location.host : '127.0.0.1:8787', room, doc, {
    party: checkAccess ? 'sync' : 'rooms', connect: false, disableBc: true,
    ...(checkAccess ? { protocol: location.protocol === 'https:' ? 'wss' : 'ws', params: { page: scope[1], generation: scope[2] } } : {}),
  });
  if (navigator.onLine && !localOnly && !isolated) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { provider.disconnect(); reject(new Error('同步服務未連線')); }, 10000);
      provider.on('sync', (value: boolean) => { if (value) { clearTimeout(timer); resolve(); } });
      void provider.connect().catch(error => { clearTimeout(timer); reject(error); });
    }).catch(failure => { if (!checkAccess || !downloaded) throw failure; });
  }
  return { doc, cache, provider, room, checkAccess };
}
