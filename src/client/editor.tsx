import { useEffect, useState } from 'react';
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
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import './style.css';

export type Session = { doc: Y.Doc; cache: IndexeddbPersistence; provider: YProvider; room: string; checkAccess?: () => Promise<boolean> };

export function Editor({ session, title }: { session: Session; title?: string }) {
  const { doc, cache, provider, room } = session;
  const editor = useCreateBlockNote(withCollaboration({
    collaboration: { fragment: doc.getXmlFragment('body'), provider, user: { name: '本機測試', color: '#2563eb' } },
  }));
  const [local, setLocal] = useState('本機儲存中');
  const [cloud, setCloud] = useState('同步中');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let revision = 0;
    let latestId: string | undefined;
    let disposed = false;
    const flush = async () => {
      const current = ++revision;
      latestId = undefined;
      setLocal('本機儲存中');
      setCloud(navigator.onLine ? '同步中' : '離線，待同步');
      try {
        await saveLocal(cache);
        if (disposed || current !== revision) return;
        setLocal('本機已儲存');
        if (provider.wsconnected && provider.synced) {
          latestId = crypto.randomUUID();
          provider.sendMessage(JSON.stringify({ type: 'commit', id: latestId, update: toBase64(Y.encodeStateAsUpdate(doc)) }));
        }
      } catch { if (!disposed && current === revision) setLocal('本機儲存失敗'); }
    };
    const update = (_bytes: Uint8Array, origin: unknown) => { if (origin !== cache) void flush(); };
    const synced = (value: boolean) => { if (value) void flush(); };
    const receipt = (message: string) => {
      try {
        const value: unknown = JSON.parse(message);
        if (isCurrentReceipt(latestId, value)) setCloud('雲端已儲存');
        else if (value && typeof value === 'object' && 'type' in value && value.type === 'error') setCloud('雲端儲存失敗，可重試');
      } catch { setCloud('確認格式錯誤'); }
    };
    const offline = () => { latestId = undefined; provider.disconnect(); setCloud('離線，待同步'); };
    const online = () => {
      setCloud('同步中');
      void (async () => {
        if (session.checkAccess && !await session.checkAccess()) { setCloud('登入或頁面權限已失效'); return; }
        await provider.connect();
      })().catch(() => setCloud('連線失敗，可重試'));
    };
    const closed = (event: CloseEvent) => {
      if (event.code === 4001) { provider.disconnect(); setCloud('登入或頁面權限已失效'); void session.checkAccess?.(); }
    };
    const foreground = () => { if (document.visibilityState === 'visible' && navigator.onLine && session.checkAccess) online(); };
    doc.on('update', update);
    provider.on('sync', synced);
    provider.on('custom-message', receipt);
    provider.on('connection-close', closed);
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    window.addEventListener('focus', foreground);
    document.addEventListener('visibilitychange', foreground);
    window.probe = { editor, doc, provider, cache, flush, localState: () => readLocal(cache), room };
    setReady(true);
    void flush();
    return () => {
      disposed = true;
      doc.off('update', update);
      provider.off('sync', synced);
      provider.off('custom-message', receipt);
      provider.off('connection-close', closed);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
      window.removeEventListener('focus', foreground);
      document.removeEventListener('visibilitychange', foreground);
      delete window.probe;
    };
  }, [doc, cache, provider, editor, room]);

  const currentBlock = () => editor.getTextCursorPosition().block;
  const insert = (type: 'paragraph' | 'image') => {
    const [block] = editor.insertBlocks([type === 'image'
      ? { type, props: { url: '/fixtures/pixel.png', name: '測試圖片', showPreview: true } }
      : { type }], currentBlock(), 'after');
    editor.setTextCursorPosition(block, 'start');
    editor.focus();
  };
  return <main>
    <h1>{title ?? 'p-note 技術驗證'}</h1>
    {!title && <p>本機原型：圖片為固定 fixture，正式資產服務尚未接入。</p>}
    <div className="status" aria-live="polite">
      <span data-testid="ready">{ready ? '可編輯' : '載入中'}</span>
      <span data-testid="local-status">{local}</span>
      <span data-testid="cloud-status">{cloud}</span>
      <button onClick={() => { void window.probe?.flush(); }}>重試儲存</button>
    </div>
    <details><summary>區塊操作</summary><div className="actions">
      <button onClick={() => insert('paragraph')}>插入段落</button>
      <button onClick={() => { editor.moveBlocksUp(); editor.focus(); }}>上移區塊</button>
      <button onClick={() => { editor.moveBlocksDown(); editor.focus(); }}>下移區塊</button>
      <button onClick={() => { editor.removeBlocks([currentBlock()]); editor.focus(); }}>刪除區塊</button>
    </div></details>
    {!title && <div className="actions">
      <button onClick={() => insert('image')}>插入測試圖片</button>
      <button onClick={() => {
        const block = currentBlock();
        if (block.type === 'codeBlock') {
          const code = block.content.map(item => item.type === 'text' ? item.text : '').join('');
          void navigator.clipboard.writeText(code).catch(() => setCloud('複製失敗'));
        }
      }}>複製程式碼</button>
    </div>}
    <BlockNoteView editor={editor} theme="light" />
  </main>;
}

export async function start(scope?: string[], checkAccess?: Session['checkAccess']): Promise<Session> {
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) throw new Error('原型只限本機');
  await navigator.serviceWorker.register('/sw.js');
  const params = new URLSearchParams(location.search);
  scope ??= ['owner', 'page', 'generation'].map((name, index) => params.get(name) ?? ['owner', 'default', 'g1'][index]);
  if (scope.some(value => !/^[\w-]{1,80}$/.test(value))) throw new Error('無效頁面識別');
  const room = await roomName(scope[0], scope[1], scope[2]);
  const doc = new Y.Doc();
  const cache = new IndexeddbPersistence(`p-note:${room}`, doc);
  await cache._db;
  await cache.whenSynced;
  // shortcut: y-indexeddb 9.0.12 不回報寫入完成／錯誤；升級前重驗此掛鉤與 saveLocal。
  doc.off('update', cache._storeUpdate);
  if (!navigator.onLine && !(await cache.get('downloaded'))) throw new Error('此頁尚未下載，請連線後再開啟');
  const provider = new YProvider(checkAccess ? location.host : '127.0.0.1:8787', room, doc, {
    party: checkAccess ? 'sync' : 'rooms', connect: false, disableBc: true,
    ...(checkAccess ? { params: { page: scope[1], generation: scope[2] } } : {}),
  });
  if (navigator.onLine) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { provider.disconnect(); reject(new Error('同步服務未連線')); }, 10000);
      provider.on('sync', (value: boolean) => { if (value) { clearTimeout(timer); resolve(); } });
      void provider.connect().catch(error => { clearTimeout(timer); reject(error); });
    });
  }
  return { doc, cache, provider, room, checkAccess };
}
