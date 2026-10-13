import { useEffect, useState, type MouseEvent } from 'react';
import type { PageInfo, PageRow } from '../shared/pages';
import { api, navigate, saveDraft } from './api';

export function Navigation({ page, changed, error }: { page: PageInfo; changed: (page: PageInfo) => void; error: (message: string) => void }) {
  const [pages, setPages] = useState<PageRow[]>([]);
  const [trash, setTrash] = useState<PageRow[]>([]);
  const [journals, setJournals] = useState<PageRow[]>([]);
  const [results, setResults] = useState<PageInfo[]>([]);
  const [view, setView] = useState('');
  const [date, setDate] = useState(page.journal_date ?? '');
  const [month, setMonth] = useState((page.journal_date ?? '').slice(0, 7));
  const [title, setTitle] = useState(page.title);
  const [parent, setParent] = useState(page.parent_id ?? '');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(() => sessionStorage.getItem('p-note-nav') === 'open' || !matchMedia('(max-width: 600px)').matches);
  const refresh = async () => {
    const response = await api('/api/pages');
    if (!response.ok) throw new Error('無法載入頁面列表');
    setPages(await response.json() as PageRow[]);
  };
  useEffect(() => { void refresh().catch(() => error('無法載入頁面列表，請重新整理')); }, []);
  useEffect(() => { setTitle(page.title); setParent(page.parent_id ?? ''); }, [page.title, page.parent_id]);
  const run = async (work: () => Promise<void>) => {
    setBusy(true); error('');
    try { await work(); } catch (failure) { error(failure instanceof Error ? failure.message : '操作失敗，請稍後重試'); }
    finally { setBusy(false); }
  };
  const request = async (path: string, data?: object) => {
    const response = await api(path, data); const value = await response.json() as PageInfo & { message?: string; page?: PageInfo };
    if (!response.ok) {
      if (response.status === 409 && value.page) { await navigate(value.page.id); return; }
      throw new Error(value.message ?? '操作失敗，請稍後重試');
    }
    return value;
  };
  const link = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); void run(() => navigate(id));
  };
  const pageLink = (item: PageRow, label = item.title) => <a href={'/?page=' + item.id} onClick={event => link(event, item.id)}>{label}</a>;
  const tree = (parentId: string | null): React.ReactNode => <ul>{pages.filter(item => item.kind === 'note' && item.parent_id === parentId).map(item => <li key={item.id}>{pageLink(item)}{tree(item.id)}</li>)}</ul>;
  return <aside className="navigation">
    <details open={expanded} onToggle={event => { const open = event.currentTarget.open; setExpanded(open); sessionStorage.setItem('p-note-nav', open ? 'open' : 'closed'); }}>
      <summary>導覽</summary>
      <div className="actions">
        <button disabled={busy} onClick={() => { void run(() => navigate()); }}>今天</button>
        <button disabled={busy} onClick={() => { void run(async () => { const created = await request('/api/pages', { title: '新增筆記', parent_id: null }); if (created) await navigate(created.id); }); }}>新增筆記</button>
        <button disabled={busy} onClick={() => { void run(async () => { const response = await api('/api/trash'); if (!response.ok) throw new Error('無法載入垃圾桶'); setTrash(await response.json() as PageRow[]); setView('trash'); }); }}>垃圾桶</button>
      </div>
      <form onSubmit={event => { event.preventDefault(); void run(async () => { const journal = await request('/api/journal', { date }); if (journal) await navigate(journal.id); }); }}>
        <label>日記日期 <input type="date" required value={date} onChange={event => setDate(event.target.value)} /></label>
        <button disabled={busy}>開啟日期日記</button>
      </form>
      <form onSubmit={event => { event.preventDefault(); void run(async () => { const response = await api('/api/journals?month=' + encodeURIComponent(month)); if (!response.ok) throw new Error('無效月份'); setJournals(await response.json() as PageRow[]); setView('journals'); }); }}>
        <label>日記月份 <input type="month" required value={month} onChange={event => setMonth(event.target.value)} /></label>
        <button disabled={busy}>查看月份</button>
      </form>
      {view === 'journals' && <section aria-label="月份日記"><h2>月份日記</h2><ul>{journals.map(item => <li key={item.id}>{pageLink(item, item.journal_date + ' ' + item.title)}</li>)}</ul></section>}
      <nav aria-label="筆記頁面"><h2>筆記</h2>{tree(null)}</nav>
      <form onSubmit={event => { event.preventDefault(); void run(async () => { const response = await api('/api/search?q=' + encodeURIComponent(query)); if (!response.ok) throw new Error('搜尋失敗，請重試'); setResults(await response.json() as PageInfo[]); setView('search'); }); }}>
        <label>搜尋文字 <input type="search" required value={query} onChange={event => setQuery(event.target.value)} /></label>
        <button disabled={busy}>搜尋</button>
      </form>
      {view === 'search' && <section aria-label="搜尋結果"><h2>搜尋結果</h2>{!results.length && <p>沒有符合的頁面</p>}<ul>{results.map(item => <li key={item.id}>{pageLink(item)}<p>{item.summary}</p></li>)}</ul></section>}
      {view === 'trash' && <section aria-label="垃圾桶內容"><h2>垃圾桶</h2>{!trash.length && <p>垃圾桶是空的</p>}<ul>{trash.map(item => <li key={item.id}>{item.title} <button disabled={busy} onClick={() => { void run(async () => { await request(`/api/pages/${item.id}/restore`, {}); await refresh(); setTrash(await (await api('/api/trash')).json() as PageRow[]); }); }}>還原 {item.title}</button></li>)}</ul></section>}
    </details>
    {page.deleted_at === null && <>
      <nav aria-label="頁面路徑">{page.ancestors?.map(item => <span key={item.id}>{pageLink(item)} / </span>)}<span>{page.title}</span></nav>
      <form onSubmit={event => { event.preventDefault(); void run(async () => { const updated = await request(`/api/pages/${page.id}/title`, { title }); if (updated) changed(updated); await refresh(); }); }}>
        <label>頁面標題 <input maxLength={200} required value={title} onChange={event => setTitle(event.target.value)} /></label><button disabled={busy}>儲存標題</button>
      </form>
      <details><summary>頁面操作</summary>
        {page.kind === 'note' && <>
          <button disabled={busy} onClick={() => { void run(async () => { const child = await request('/api/pages', { title: '新增子頁面', parent_id: page.id }); if (child) await navigate(child.id); }); }}>新增子頁面</button>
          <form onSubmit={event => { event.preventDefault(); void run(async () => { const moved = await request(`/api/pages/${page.id}/move`, { parent_id: parent || null }); if (moved) changed(moved); await refresh(); }); }}>
            <label htmlFor="parent-page">移動至上層</label><select id="parent-page" value={parent} onChange={event => setParent(event.target.value)}><option value="">最上層</option>{pages.filter(item => item.kind === 'note' && item.id !== page.id).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
            <button disabled={busy}>移動頁面</button>
          </form>
        </>}
        <button disabled={busy} onClick={() => { void run(async () => { await saveDraft(); await request(`/api/pages/${page.id}/delete`, {}); await navigate(); }); }}>移到垃圾桶</button>
      </details>
    </>}
  </aside>;
}
