import { Alert, Anchor, Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { useCallback, useEffect, useState } from 'react';
import { SuggestionMenuController, type SuggestionMenuProps } from '@blocknote/react';
import type { BlockNoteEditor } from '@blocknote/core';
import type { PageRow } from '../shared/pages';
import { noteLinkHref, noteLinkId, type Backlink } from '../shared/note-links';
import { api, navigate, signedOut } from './api';

type Item = { id?: string; title: string; detail: string; query?: string };
function LinkMenu({ items, selectedIndex, onItemClick, loadingState }: SuggestionMenuProps<Item>) {
  return <Paper withBorder shadow="md" p="xs" radius="md" style={{ width: 320, maxWidth: 'calc(100vw - 32px)', maxHeight: 300, overflowY: 'auto' }}>
    <Text size="xs" c="dimmed" px="xs" mb="xs">連結筆記或日記</Text>
    <div role="listbox" id="bn-suggestion-menu" aria-label="筆記連結搜尋">
      {items.map((item, index) => <button type="button" role="option" id={'bn-suggestion-menu-item-' + index}
        key={item.id ?? 'message'} aria-selected={index === selectedIndex} className="note-link-option"
        onMouseDown={event => event.preventDefault()} onClick={() => onItemClick?.(item)}>
        <Text component="span" size="sm" fw={500} style={{ display: 'block', overflowWrap: 'anywhere' }}>{item.title}</Text>
        <Text component="span" size="xs" c="dimmed">{item.detail}</Text>
      </button>)}
      {!items.length && <Text size="sm" p="xs">{loadingState.startsWith('loading') ? '搜尋中…' : '沒有符合的筆記'}</Text>}
    </div>
  </Paper>;
}
export function NoteLinkSuggestions({ editor, owner }: { editor: BlockNoteEditor; owner: string }) {
  const getItems = useCallback(async (query: string): Promise<Item[]> => {
    let pages: PageRow[];
    if (!navigator.onLine) {
      pages = [];
      if (!signedOut()) for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith('p-note:page:' + owner + ':')) continue;
        try {
          const p = JSON.parse(localStorage.getItem(key)!);
          if (p.owner_id === owner && typeof p.id === 'string' && typeof p.title === 'string' && p.deleted_at === null) pages.push(p);
        } catch { /* 不使用損毀的本機 metadata。 */ }
      }
    } else {
      try {
        const response = await api('/api/pages', undefined, AbortSignal.timeout(8000));
        if (!response.ok) throw new Error('搜尋失敗');
        pages = await response.json();
      } catch { return [{ title: '搜尋失敗，請重試', detail: '按 Esc 保留文字，重新輸入 [[ 再搜尋', query }]; }
    }
    const q = query.trim().normalize('NFC').toLocaleLowerCase();
    const matches = pages.filter(p => p.title.normalize('NFC').toLocaleLowerCase().includes(q)).sort((a, b) => b.updated_at - a.updated_at || a.id.localeCompare(b.id));
    return matches.map(p => ({ id: p.id, title: p.title, detail: p.kind === 'journal' ? '日記 · ' + p.journal_date : '筆記 · ' + p.id }));
  }, [owner]);
  return <SuggestionMenuController triggerCharacter="[[" getItems={getItems} suggestionMenuComponent={LinkMenu}
    shouldOpen={() => editor.getTextCursorPosition().block.type !== 'codeBlock'}
    onItemClick={item => {
      if (!item.id) { editor.insertInlineContent('[[' + (item.query ?? '')); return; }
      editor.insertInlineContent([{ type: 'link', href: noteLinkHref(item.id), content: item.title }, ' ']);
    }} />;
}

export function Backlinks({ id }: { id: string }) {
  const [links, setLinks] = useState<Backlink[]>();
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(!navigator.onLine);
  useEffect(() => {
    let disposed = false; let loading = false;
    const refresh = async () => {
      setOffline(!navigator.onLine);
      if (!navigator.onLine || loading) return;
      loading = true;
      try {
        const r = await api('/api/pages/' + id + '/backlinks', undefined, AbortSignal.timeout(8000));
        if (!r.ok) throw new Error('反向連結讀取失敗，請重試');
        const next = await r.json() as Backlink[];
        if (!disposed) { setLinks(next); setError(''); }
      } catch { if (!disposed) setError('反向連結讀取失敗，請重試'); }
      finally { loading = false; }
    };
    const run = () => { void refresh(); };
    run(); const timer = setInterval(run, 3000);
    window.addEventListener('focus', run); window.addEventListener('online', run); window.addEventListener('offline', run); window.addEventListener('p-note:backlinks-retry', run);
    return () => { disposed = true; clearInterval(timer); window.removeEventListener('focus', run); window.removeEventListener('online', run); window.removeEventListener('offline', run); window.removeEventListener('p-note:backlinks-retry', run); };
  }, [id]);
  return <Paper component="section" role="region" aria-label="反向連結" withBorder p="lg" mt="xl" radius="md">
    <Group justify="space-between" mb="sm"><Title order={2} size="h4">反向連結</Title><Text size="xs" c="dimmed">引用這頁的筆記</Text></Group>
    {offline ? <Text size="sm" c="dimmed">連線後可查看最新反向連結</Text> : error ? <Alert color="red" role="alert">
      {error}<Button variant="subtle" size="xs" onClick={() => window.dispatchEvent(new Event('p-note:backlinks-retry'))}>重試反向連結</Button>
    </Alert> : links === undefined ? <Text size="sm" c="dimmed">正在讀取反向連結…</Text> : !links.length ? <Text size="sm" c="dimmed">目前沒有其他筆記引用這頁</Text> :
      <Stack gap="xs">{links.map(p => <Anchor key={p.id} href={noteLinkHref(p.id)} style={{ overflowWrap: 'anywhere' }} onClick={event => {
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); void navigate(p.id).catch(failure => setError((failure as Error).message));
      }}>{p.title}</Anchor>)}</Stack>}
  </Paper>;
}

export function followNoteLink(event: React.MouseEvent<HTMLElement>, failure: (message: string) => void) {
  const anchor = event.target instanceof Element ? event.target.closest('a') : null;
  const id = noteLinkId(anchor?.getAttribute('href'));
  if (!id || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault(); event.stopPropagation();
  void navigate(id).catch(error => failure(error instanceof Error ? error.message : '換頁失敗，請重試'));
}
