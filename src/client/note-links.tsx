import { Button } from '@mantine/core';
import { IconBook2, IconChevronDown, IconFileText, IconLink, IconSearch } from '@tabler/icons-react';
import { useCallback, useEffect, useId, useState } from 'react';
import { SuggestionMenuController, type SuggestionMenuProps } from '@blocknote/react';
import type { BlockNoteEditor } from '@blocknote/core';
import type { PageRow } from '../shared/pages';
import { noteLinkHref, noteLinkId, type Backlink } from '../shared/note-links';
import { api, navigate, signedOut } from './api';
import './note-links.css';

type Item = { id?: string; title: string; detail: string; query?: string };
function LinkMenu({ items, selectedIndex, onItemClick, loadingState }: SuggestionMenuProps<Item>) {
  return <div className="note-link-menu">
    <div className="note-link-menu-label">連結筆記或日記</div>
    <div className="note-link-options" role="listbox" id="bn-suggestion-menu" aria-label="筆記連結搜尋">
      {items.map((item, index) => <button type="button" role="option" id={'bn-suggestion-menu-item-' + index}
        key={item.id ?? 'message'} aria-selected={index === selectedIndex} className="note-link-option"
        onMouseDown={event => event.preventDefault()} onClick={() => onItemClick?.(item)}>
        {item.id ? (item.detail === '日記'
          ? <IconBook2 className="note-link-option-icon" size={17} aria-hidden="true" />
          : <IconFileText className="note-link-option-icon" size={17} aria-hidden="true" />)
          : <IconSearch className="note-link-option-icon" size={17} aria-hidden="true" />}
        <span className="note-link-option-copy">
          <span className="note-link-option-title">{item.title}</span>
          <span className="note-link-option-detail">{item.detail}</span>
        </span>
      </button>)}
      {!items.length && <div className="note-link-empty">{loadingState.startsWith('loading') ? '搜尋中…' : '沒有符合的筆記'}</div>}
    </div>
  </div>;
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
    return matches.map(p => ({ id: p.id, title: p.title, detail: p.kind === 'journal' ? '日記' : '筆記' }));
  }, [owner]);
  return <SuggestionMenuController triggerCharacter="[[" getItems={getItems} suggestionMenuComponent={LinkMenu}
    shouldOpen={() => editor.getTextCursorPosition().block.type !== 'codeBlock'}
    onItemClick={item => {
      if (!item.id) { editor.insertInlineContent('[[' + (item.query ?? '')); return; }
      editor.insertInlineContent([{ type: 'link', href: noteLinkHref(item.id), content: item.title }, ' ']);
    }} />;
}

export function Backlinks({ id }: { id: string }) {
  const [expanded, setExpanded] = useState(true);
  const contentId = useId();
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
  return <section className="note-backlinks" role="region" aria-label="反向連結">
    <button
      type="button"
      className="note-backlinks-toggle"
      aria-expanded={expanded}
      aria-controls={contentId}
      onClick={() => setExpanded(value => !value)}
    >
      <IconChevronDown size={14} aria-hidden="true" style={{ transform: expanded ? undefined : 'rotate(-90deg)' }} />
      <IconLink size={16} aria-hidden="true" />
      <span>反向連結</span>
      {links !== undefined && !offline && !error && <span className="note-backlinks-count">{links.length}</span>}
    </button>
    <div className="note-backlinks-content" id={contentId} hidden={!expanded}>
      <p className="note-backlinks-description">引用這頁的筆記</p>
      {offline ? <p className="note-backlinks-state">連線後可查看最新反向連結</p> : error ? <div className="note-backlinks-error" role="alert">
        <span>{error}</span>
        <Button className="note-backlinks-retry" variant="subtle" color="gray" size="xs" onClick={() => window.dispatchEvent(new Event('p-note:backlinks-retry'))}>重試反向連結</Button>
      </div> : links === undefined ? <p className="note-backlinks-state">正在讀取反向連結…</p> : !links.length ? <p className="note-backlinks-state">目前沒有其他筆記引用這頁</p> :
        <div className="note-backlinks-list">{links.map(p => <a className="note-backlink" key={p.id} href={noteLinkHref(p.id)} onClick={event => {
          if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault(); void navigate(p.id).catch(failure => setError((failure as Error).message));
        }}><IconFileText size={16} aria-hidden="true" /><span className="note-backlink-title">{p.title}</span></a>)}</div>}
    </div>
  </section>;
}

export function followNoteLink(event: React.MouseEvent<HTMLElement>, failure: (message: string) => void) {
  const anchor = event.target instanceof Element ? event.target.closest('a') : null;
  const id = noteLinkId(anchor?.getAttribute('href'));
  if (!id || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault(); event.stopPropagation();
  void navigate(id).catch(error => failure(error instanceof Error ? error.message : '換頁失敗，請重試'));
}
