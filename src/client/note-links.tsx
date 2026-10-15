import { Button } from '@mantine/core';
import { IconBook2, IconChevronDown, IconFileText, IconLink, IconSearch } from '@tabler/icons-react';
import { useCallback, useEffect, useId, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { SuggestionMenuController, useExtensionState, type SuggestionMenuProps } from '@blocknote/react';
import type { BlockNoteEditor } from '@blocknote/core';
import { SuggestionMenu } from '@blocknote/core/extensions';
import type { PageInfo, PageRow } from '../shared/pages';
import { isPageIcon } from '../shared/page-icon';
import { noteLinkHref, noteLinkId, type Backlink } from '../shared/note-links';
import { api, navigate, signedOut } from './api';
import { PageIcon, PageIconPicker } from './page-icon';
import { createNoteLinkIconsExtension } from './note-link-icons-extension';
export { createNoteLinkIconsExtension } from './note-link-icons-extension';
import './note-links.css';

type Item = { id?: string; title: string; detail: string; query?: string; page?: PageRow };
function LinkMenu({ items, selectedIndex, onItemClick, loadingState }: SuggestionMenuProps<Item>) {
  const state = useExtensionState(SuggestionMenu);
  const [updated, setUpdated] = useState<Record<string, PageInfo>>({});
  useEffect(() => {
    const metadata = (event: Event) => {
      const page = (event as CustomEvent<PageInfo>).detail;
      if (page) setUpdated(current => {
        const previous = current[page.id];
        if (previous?.sync_generation === page.sync_generation && previous.metadata_revision > page.metadata_revision) return current;
        return { ...current, [page.id]: page };
      });
    };
    window.addEventListener('p-note:page-metadata', metadata);
    return () => window.removeEventListener('p-note:page-metadata', metadata);
  }, []);
  const loading = loadingState !== 'loaded' || items.some(item => item.query !== state?.query);
  return <div className="note-link-menu" aria-busy={loading} data-note-query={state?.query}>
    <div className="note-link-menu-label">連結筆記或日記</div>
    <div className="note-link-options" role="listbox" id="bn-suggestion-menu" aria-label="筆記連結搜尋">
      {!loading && items.map((item, index) => {
        const received = item.page && updated[item.page.id];
        const iconPage = item.page && received?.owner_id === item.page.owner_id
          && !(received.sync_generation === item.page.sync_generation && received.metadata_revision < item.page.metadata_revision) ? received : item.page;
        return <div key={item.id ?? 'message'} className="note-link-option-row" data-selected={index === selectedIndex || undefined}>
        {iconPage && <button type="button" className="page-icon-trigger note-link-option-picker"
          aria-label={(iconPage.icon ? '更換' : '新增') + '「' + iconPage.title + '」圖示'} aria-haspopup="dialog" disabled={!navigator.onLine}
          onClick={event => {
            event.stopPropagation();
            window.dispatchEvent(new CustomEvent('p-note:pick-page-icon', { detail: iconPage }));
          }}><PageIcon page={iconPage} size={17} /></button>}
        <button type="button" role="option" id={'bn-suggestion-menu-item-' + index}
        aria-selected={index === selectedIndex} className="note-link-option"
        data-note-query={item.query}
        onMouseDown={event => event.preventDefault()} onClick={() => onItemClick?.(item)}>
        {!item.page && (item.id ? (item.detail === '日記'
          ? <IconBook2 className="note-link-option-icon" size={17} aria-hidden="true" />
          : <IconFileText className="note-link-option-icon" size={17} aria-hidden="true" />)
          : <IconSearch className="note-link-option-icon" size={17} aria-hidden="true" />)}
        <span className="note-link-option-copy">
          <span className="note-link-option-title">{item.title}</span>
          <span className="note-link-option-detail">{item.detail}</span>
        </span>
      </button></div>;
      })}
      {(loading || !items.length) && <div className="note-link-empty">{loading ? '搜尋中…' : '沒有符合的筆記'}</div>}
    </div>
  </div>;
}
function cachedLinkPages(owner: string): PageRow[] {
  const pages: PageRow[] = [];
  try {
    if (!signedOut()) for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith('p-note:page:' + owner + ':')) continue;
      try {
        const page = JSON.parse(localStorage.getItem(key)!);
        if (page.icon !== undefined && !isPageIcon(page.icon)) continue;
        if (page.owner_id === owner && typeof page.id === 'string' && typeof page.title === 'string' && page.deleted_at === null) pages.push(page);
      } catch { /* 不使用損毀的本機 metadata。 */ }
    }
  } catch { /* 禁用本機儲存時仍可使用已連線的筆記連結。 */ }
  return pages;
}
export function NoteLinkSuggestions({ editor, owner }: { editor: BlockNoteEditor; owner: string }) {
  const [iconTarget, setIconTarget] = useState<PageRow | null>(null);
  useEffect(() => {
    const pick = (event: Event) => {
      const page = (event as CustomEvent<PageRow>).detail;
      if (page?.owner_id === owner) setIconTarget(page);
    };
    window.addEventListener('p-note:pick-page-icon', pick);
    return () => window.removeEventListener('p-note:pick-page-icon', pick);
  }, [owner]);
  const getItems = useCallback(async (query: string): Promise<Item[]> => {
    let pages: PageRow[];
    if (!navigator.onLine) {
      pages = cachedLinkPages(owner);
    } else {
      try {
        const response = await api('/api/pages', undefined, AbortSignal.timeout(8000));
        if (!response.ok) throw new Error('搜尋失敗');
        pages = await response.json();
      } catch { return [{ title: '搜尋失敗，請重試', detail: '按 Esc 保留文字，重新輸入 [[ 再搜尋', query }]; }
    }
    const q = query.trim().normalize('NFC').toLocaleLowerCase();
    const matches = pages.filter(p => p.title.normalize('NFC').toLocaleLowerCase().includes(q)).sort((a, b) => b.updated_at - a.updated_at || a.id.localeCompare(b.id));
    return matches.map(p => ({ id: p.id, title: p.title, detail: p.kind === 'journal' ? '日記' : '筆記', query, page: p }));
  }, [owner]);
  return <><SuggestionMenuController triggerCharacter="[[" getItems={getItems} suggestionMenuComponent={LinkMenu}
    shouldOpen={() => editor.getTextCursorPosition().block.type !== 'codeBlock'}
    onItemClick={item => {
      if (!item.id) { editor.insertInlineContent('[[' + (item.query ?? '')); return; }
      editor.insertInlineContent([{ type: 'link', href: noteLinkHref(item.id), content: item.title }, ' ']);
    }} />
    {iconTarget && <PageIconPicker key={iconTarget.id} page={iconTarget} opened hideTrigger
      onOpenedChange={opened => { if (!opened) setIconTarget(null); }} />}
  </>;
}

/** 圖示使用編輯器裝飾，避免寫入筆記文字、同步內容或匯出資料。 */
export function NoteLinkIcons({ editor, owner, controller, disabled = false }: {
  editor: BlockNoteEditor; owner: string; controller: ReturnType<typeof createNoteLinkIconsExtension>; disabled?: boolean;
}) {
  const [pages, setPages] = useState<PageRow[]>(() => cachedLinkPages(owner));
  const hosts = useSyncExternalStore(controller.subscribe, controller.getHosts);
  useEffect(() => {
    let disposed = false;
    let loading = false;
    const refresh = async () => {
      if (!navigator.onLine) return;
      if (loading || document.visibilityState === 'hidden') return;
      loading = true;
      try {
        const response = await api('/api/pages', undefined, AbortSignal.timeout(8000));
        if (!response.ok) return;
        const next = await response.json() as PageRow[];
        if (!disposed) setPages(current => next.map(page => {
          const existing = current.find(item => item.id === page.id);
          return existing && existing.sync_generation === page.sync_generation && existing.metadata_revision > page.metadata_revision ? existing : page;
        }));
      } catch { /* 圖示載入失敗不影響連結或筆記編輯。 */ }
      finally { loading = false; }
    };
    const metadata = (event: Event) => {
      const page = (event as CustomEvent<PageInfo>).detail;
      if (!page || page.owner_id !== owner) return;
      setPages(current => {
        const existing = current.find(item => item.id === page.id);
        if (existing && existing.sync_generation === page.sync_generation && existing.metadata_revision > page.metadata_revision) return current;
        return [...current.filter(item => item.id !== page.id), page];
      });
    };
    const run = () => { void refresh(); };
    run(); const timer = setInterval(run, 3000);
    window.addEventListener('focus', run); window.addEventListener('online', run); window.addEventListener('offline', run);
    window.addEventListener('p-note:page-metadata', metadata);
    return () => {
      disposed = true; clearInterval(timer);
      window.removeEventListener('focus', run); window.removeEventListener('online', run); window.removeEventListener('offline', run);
      window.removeEventListener('p-note:page-metadata', metadata);
    };
  }, [owner]);
  useEffect(() => controller.setPages(pages, editor), [controller, editor, pages]);
  return <>{hosts.map(({ element, id, key }) => {
    const page = pages.find(item => item.id === id);
    return page && createPortal(<PageIconPicker page={page} size={17} disabled={disabled || !navigator.onLine} className="note-inline-icon-picker" />, element, key);
  })}</>;
}

export function selectNoteLinkSuggestion(event: React.KeyboardEvent<HTMLElement>, editor: BlockNoteEditor) {
  if (event.nativeEvent.isComposing || !['Enter', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(event.key)) return;
  const state = editor.getExtension(SuggestionMenu)?.store.state;
  if (!state?.show || state.triggerCharacter !== '[[') return;
  const menu = event.currentTarget.querySelector<HTMLElement>('.note-link-menu');
  const ready = menu?.getAttribute('aria-busy') === 'false' && menu.dataset.noteQuery === state.query;
  if (ready && event.key !== 'Enter') return;
  // BlockNote 載入新查詢時仍保留舊的鍵盤選項；先攔截，僅選取目前畫面已完成的結果。
  event.preventDefault();
  event.stopPropagation();
  if (!ready) return;
  const selected = menu.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]');
  if (selected?.dataset.noteQuery === state.query) selected.click();
}

export function Backlinks({ id }: { id: string }) {
  const [expanded, setExpanded] = useState(true);
  const contentId = useId();
  const [links, setLinks] = useState<Backlink[]>();
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(!navigator.onLine);
  const older = (next: Backlink, current: Backlink) => next.sync_generation === current.sync_generation
    && (next.metadata_revision ?? -1) < (current.metadata_revision ?? -1);
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
        if (!disposed) {
          setLinks(current => next.map(page => {
            const existing = current?.find(item => item.id === page.id);
            return existing && older(page, existing) ? existing : page;
          }));
          setError('');
        }
      } catch { if (!disposed) setError('反向連結讀取失敗，請重試'); }
      finally { loading = false; }
    };
    const run = () => { void refresh(); };
    const metadata = (event: Event) => {
      const updated = (event as CustomEvent<PageInfo>).detail;
      if (updated) setLinks(current => current?.map(page => page.id === updated.id && !older(updated, page)
        ? { ...page, title: updated.title, icon: updated.icon, database_config: updated.database_config,
          metadata_revision: updated.metadata_revision, sync_generation: updated.sync_generation } : page));
    };
    run(); const timer = setInterval(run, 3000);
    window.addEventListener('focus', run); window.addEventListener('online', run); window.addEventListener('offline', run); window.addEventListener('p-note:backlinks-retry', run);
    window.addEventListener('p-note:page-metadata', metadata);
    return () => { disposed = true; clearInterval(timer); window.removeEventListener('focus', run); window.removeEventListener('online', run); window.removeEventListener('offline', run); window.removeEventListener('p-note:backlinks-retry', run); window.removeEventListener('p-note:page-metadata', metadata); };
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
        <div className="note-backlinks-list">{links.map(p => <div className="note-backlink-row" key={p.id}>
          <PageIconPicker page={p} size={16} />
          <a className="note-backlink" href={noteLinkHref(p.id)} onClick={event => {
          if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault(); void navigate(p.id).catch(failure => setError((failure as Error).message));
        }}><span className="note-backlink-title">{p.title}</span></a></div>)}</div>}
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
