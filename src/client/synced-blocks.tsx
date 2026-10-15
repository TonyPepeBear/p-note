import { Alert, Button, Group, Modal, Stack, Text } from '@mantine/core';
import { IconCopy, IconLink, IconRefresh, IconUnlink } from '@tabler/icons-react';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { BlockNoteSchema, defaultBlockSpecs, type BlockNoteEditor } from '@blocknote/core';
import { createReactBlockSpec, useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { withCollaboration } from '@blocknote/core/yjs';
import { zhTW } from '@blocknote/core/locales';
import { syncedBlockConfig } from '../shared/block-schema';
import { api, navigate } from './api';
import { uploadImage } from './assets';
import { NoteLinkSuggestions, followNoteLink, selectNoteLinkSuggestion } from './note-links';
import { acquireSyncedSession, type SyncedScope, type SyncedSession, type SyncedState } from './synced-block-session';
import './synced-blocks.css';
import { useSafeRemoteNodeSelection } from './yjs-selection';

export const SYNCED_CLIPBOARD_PREFIX = 'p-note-synced-block:';
export type AnyEditor = BlockNoteEditor<any, any, any>;
type Context = SyncedScope & { report: (instance: string, state?: SyncedState) => void };
const SyncedContext = createContext<Context | undefined>(undefined);
export function SyncedBlocksProvider({ children, ...context }: Context & { children: ReactNode }) {
  return <SyncedContext.Provider value={context}>{children}</SyncedContext.Provider>;
}

function SyncedContent({ session, readOnly, ownerId, onEditor }: {
  session: SyncedSession; readOnly: boolean; ownerId: string; onEditor: (editor: AnyEditor) => void;
}) {
  const editor = useCreateBlockNote(withCollaboration({
    dictionary: zhTW,
    // provider 是 BlockNote 官方可選的游標 awareness，文件同步由共用 session 自行處理。
    // 同一文件的多個視圖不能共用一個游標狀態，否則 focus 與 blur 會互相清除並持續送出更新。
    collaboration: { fragment: session.doc.getXmlFragment('body'), user: { name: '我', color: '#2383e2' } },
    uploadFile: uploadImage,
  }));
  useSafeRemoteNodeSelection(editor, session.doc);
  useEffect(() => { onEditor(editor); }, [editor, onEditor]);
  const [error, setError] = useState('');
  return <div className="synced-block-editor" onClickCapture={event => followNoteLink(event, setError)}
    onKeyDownCapture={event => {
      // 內層編輯器自行處理選字與鍵盤操作，避免外層編輯器攔截。
      selectNoteLinkSuggestion(event, editor);
    }} onPasteCapture={event => {
      if (event.clipboardData.getData('text/plain').startsWith(SYNCED_CLIPBOARD_PREFIX)) {
        event.preventDefault(); event.stopPropagation(); setError('同步區塊不能放在另一個同步區塊裡');
      }
    }}>
    {error && <Alert role="alert" color="red">{error}</Alert>}
    <BlockNoteView editor={editor} theme="light" editable={!readOnly}>
      {!readOnly && <NoteLinkSuggestions editor={editor} owner={ownerId} />}
    </BlockNoteView>
  </div>;
}

function SyncedReference({ id, instanceId, parent }: { id: string; instanceId: string; parent: AnyEditor }) {
  const context = useContext(SyncedContext);
  const [session, setSession] = useState<SyncedSession>();
  const [state, setState] = useState<SyncedState>({ ready: false, local: '本機儲存中', cloud: '同步中', error: '' });
  const [attempt, setAttempt] = useState(0);
  const [actionError, setActionError] = useState('');
  const [references, setReferences] = useState<{ id: string; title: string }[]>();
  const [referencesOpen, setReferencesOpen] = useState(false);
  const [referenceError, setReferenceError] = useState('');
  const innerEditor = useRef<AnyEditor>(undefined);
  const report = context?.report;
  useEffect(() => {
    if (!context) return;
    let disposed = false;
    let release: (() => void) | undefined;
    let active: SyncedSession | undefined;
    const changed = (next: SyncedState) => { if (!disposed) { setState(next); report?.(instanceId, next); } };
    changed({ ready: false, local: '本機儲存中', cloud: '同步中', error: '' });
    void acquireSyncedSession(context, id).then(result => {
      if (disposed) { result.release(); return; }
      active = result.session; release = result.release;
      setSession(active); active.listeners.add(changed); changed(active.state);
    }).catch(failure => changed({ ready: false, local: '', cloud: navigator.onLine ? '同步區塊載入失敗' : '離線，待同步', error: !navigator.onLine ? '離線無法載入' : failure instanceof Error ? failure.message : '同步區塊載入失敗，請重試' }));
    return () => { disposed = true; active?.listeners.delete(changed); release?.(); report?.(instanceId); };
  }, [context?.ownerId, context?.pageId, context?.generation, context?.readOnly, id, instanceId, attempt, report]);
  useEffect(() => {
    const retry = () => {
      if (session) session.retry();
      else setAttempt(value => value + 1);
    };
    const offline = () => {
      if (!session) {
        const next: SyncedState = { ready: false, local: '', cloud: '離線，待同步', error: '離線無法載入' };
        setState(next); report?.(instanceId, next);
      }
    };
    window.addEventListener('online', retry); window.addEventListener('offline', offline);
    window.addEventListener('p-note:synced-blocks-retry', retry);
    return () => {
      window.removeEventListener('online', retry); window.removeEventListener('offline', offline);
      window.removeEventListener('p-note:synced-blocks-retry', retry);
    };
  }, [session, report, instanceId]);
  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      if (!navigator.onLine) return;
      try {
        const response = await api(`/api/synced-blocks/${encodeURIComponent(id)}/references`, undefined, AbortSignal.timeout(8000));
        if (!response.ok) throw new Error('引用清單載入失敗，請重試');
        const result = await response.json() as { id: string; title: string }[] | { pages: { id: string; title: string }[] };
        if (!disposed) { setReferences(Array.isArray(result) ? result : result.pages); setReferenceError(''); }
      } catch { if (!disposed) setReferenceError('引用清單載入失敗，請重試'); }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 3000);
    window.addEventListener('online', refresh);
    return () => { disposed = true; clearInterval(timer); window.removeEventListener('online', refresh); };
  }, [id, referencesOpen]);
  const retry = () => {
    if (session) session.retry();
    else setAttempt(value => value + 1);
  };
  return <section className="synced-block" data-testid="synced-block" data-synced-block-id={id}
    contentEditable={false} aria-label="同步區塊" onKeyDown={event => event.stopPropagation()}>
    <div className="synced-block-header">
      <span className="synced-block-label"><IconRefresh size={15} aria-hidden="true" />同步區塊</span>
      <Button variant="subtle" color="gray" size="compact-xs" leftSection={<IconLink size={13} />}
        onClick={() => setReferencesOpen(true)}>{references ? `已在 ${references.length} 個頁面使用` : '查看引用'}</Button>
    </div>
    <Group gap={4} className="synced-block-actions">
      <Button size="compact-xs" variant="subtle" color="gray" leftSection={<IconCopy size={13} />}
        onClick={() => void navigator.clipboard.writeText(SYNCED_CLIPBOARD_PREFIX + id).then(() => setActionError('')).catch(() => setActionError('複製同步區塊失敗，請重試'))}>複製同步區塊</Button>
      {!context?.readOnly && <Button size="compact-xs" variant="subtle" color="gray" leftSection={<IconUnlink size={13} />}
        disabled={!state.ready || !innerEditor.current}
        onClick={() => {
          const editor = innerEditor.current;
          if (!editor || !state.ready) return;
          // 移除識別碼，讓一般區塊擁有獨立的節點身分與後續修改。
          const clone = (blocks: any[]): any[] => blocks.map(({ id: _id, children, ...block }) => ({ ...block, ...(children?.length ? { children: clone(children) } : {}) }));
          parent.replaceBlocks([instanceId], clone(editor.document));
        }}>解除同步</Button>}
    </Group>
    {(state.error || actionError) && <Alert role="alert" color="red" className="synced-block-error">
      {actionError || state.error}
      {!actionError && <Button variant="subtle" size="compact-xs" onClick={retry}>重試同步區塊</Button>}
    </Alert>}
    {state.ready && session && context ? <SyncedContent key={`${session.metadata.id}:${session.metadata.sync_generation}`} session={session} readOnly={!!context.readOnly || !!state.blocked}
      ownerId={context.ownerId} onEditor={editor => { innerEditor.current = editor; }} /> : !state.error && <Text size="sm" c="dimmed" p="sm">同步區塊載入中…</Text>}
    {state.ready && <Text size="xs" c="dimmed" className="synced-block-status" data-testid="synced-block-status">{state.cloud}</Text>}
    <Modal opened={referencesOpen} onClose={() => setReferencesOpen(false)} title="同步區塊引用" centered>
      <Stack gap="sm">
        <Text size="xs" c="dimmed">同步區塊 ID：{id}</Text>
        {!navigator.onLine ? <Text>連線後可查看最新引用清單</Text> : referenceError ? <Alert role="alert" color="red">{referenceError}</Alert> : references?.map(page => <Button variant="subtle" color="gray" key={page.id}
          onClick={() => { setReferencesOpen(false); void navigate(page.id).catch(failure => setActionError((failure as Error).message)); }}>{page.title}</Button>)}
        {references?.length === 0 && <Text size="sm" c="dimmed">目前沒有可見的引用頁面</Text>}
      </Stack>
    </Modal>
  </section>;
}

export const syncedEditorSchema = BlockNoteSchema.create({ blockSpecs: {
  ...defaultBlockSpecs,
  syncedBlock: createReactBlockSpec(syncedBlockConfig, {
    render: ({ block, editor }) => <SyncedReference id={block.props.syncedBlockId} instanceId={block.id} parent={editor} />,
    toExternalHTML: ({ block }) => <div data-synced-block-id={block.props.syncedBlockId}>同步區塊：{block.props.syncedBlockId}</div>,
  })(),
} });
