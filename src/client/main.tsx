import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor, start, type Session } from './editor';
import type { PageInfo } from '../shared/pages';
import { api, navigate, saveDraft } from './api';
import { BackupSettings } from './backup-settings';
import { Navigation } from './navigation';
import { rememberPage, cachedPage } from './page-cache';
import { readLocal, saveLocal } from './cache';

function Login({ confirm = false }: { confirm?: boolean }) {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (confirming: boolean) => {
    setBusy(true); setMessage(''); setError('');
    try {
      const response = await api(confirming ? '/api/confirm' : '/api/login', confirming ? { token: new URLSearchParams(location.search).get('token') } : { email });
      const data = await response.json() as { message?: string };
      if (!response.ok) { setError(data.message ?? '登入失敗，請稍後重試'); return; }
      if (confirming) {
        history.replaceState(null, '', '/');
        location.replace(sessionStorage.getItem('p-note-return-url') ?? '/');
      } else setMessage(data.message ?? '請查看登入郵件');
    } catch { setError('連線失敗，請稍後重試'); }
    finally { setBusy(false); }
  };
  return <section aria-label="登入">
    <h1>登入 p-note</h1>
    {confirm && <button disabled={busy} onClick={() => { void send(true); }}>確認登入</button>}
    <form onSubmit={event => { event.preventDefault(); void send(false); }}>
      <label>Email <input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>
      <button disabled={busy} type="submit">寄送登入連結</button>
    </form>
    <p role="status">{message}</p>
    {error && <p role="alert">{error}</p>}
  </section>;
}

function App() {
  const [session, setSession] = useState<Session>();
  const [page, setPage] = useState<PageInfo>();
  const [recovery, setRecovery] = useState<PageInfo>();
  const [isolated, setIsolated] = useState<{ page: PageInfo; current?: PageInfo }>();
  const [viewDraft, setViewDraft] = useState(false); const [forking, setForking] = useState(false);
  const [login, setLogin] = useState(false);
  const [error, setError] = useState('');
  const confirm = location.pathname === '/login/confirm';
  const [settings, setSettings] = useState(false);
  useEffect(() => {
    if (confirm) return;
    let disposed = false; let opened: Session | undefined;
    const localPage = (id: string, owner: string) => {
      try { const cached = cachedPage(id); return cached.owner_id === owner ? cached : undefined; } catch { return undefined; }
    };
    const isolate = async (old: PageInfo, current?: PageInfo) => {
      setIsolated({ page: old, current }); setPage(old);
      opened = await start([old.owner_id, old.id, old.sync_generation], async () => false, true, true);
      if (disposed) { opened.provider.destroy(); await opened.cache.destroy(); opened.doc.destroy(); return; }
      setSession(opened);
    };
    void (async () => {
      const id = new URLSearchParams(location.search).get('page');
      let response: Response | undefined; let localOnly = false;
      try { response = await api(id ? `/api/pages/${encodeURIComponent(id)}` : '/api/today'); }
      catch { localOnly = true; }
      if (response && response.status >= 500) { response = undefined; localOnly = true; }
      if (response?.status === 401) { setLogin(true); return; }
      if (response && !response.ok) {
        const failure = await response.json() as { message: string; page?: PageInfo };
        setError(failure.message);
        if (failure.page) { setRecovery(failure.page); history.replaceState(null, '', '/?page=' + failure.page.id); }
        if (id) {
          const owner = failure.page?.owner_id ?? (await (await api('/api/session')).json() as { user?: { id: string } }).user?.id;
          const old = owner && localPage(id, owner);
          if (old) await isolate(old);
        }
        return;
      }
      const page = response ? await response.json() as PageInfo : cachedPage(id ?? undefined);
      const old = localPage(page.id, page.owner_id);
      const accepted = sessionStorage.getItem('p-note-load-current');
      if (old && old.sync_generation !== page.sync_generation && accepted !== page.id && accepted !== 'restored') {
        setError('頁面世代已變更，本機內容已隔離'); await isolate(old, page); return;
      }
      sessionStorage.removeItem('p-note-load-current');
      try { rememberPage(page); } catch { setError('頁面資訊本機儲存失敗，離線開啟可能不可用；正文仍可儲存'); }
      history.replaceState(null, '', `/?page=${page.id}`);
      sessionStorage.setItem('p-note-return-url', location.pathname + location.search);
      sessionStorage.setItem('p-note-scope', JSON.stringify(page));
      setPage(page);
      const checkAccess = async () => {
        const current = await api(`/api/pages/${page.id}`);
        if (disposed) return false;
        if (current.status === 401) { opened?.provider.disconnect(); setLogin(true); setError('登入已到期，請重新登入；本機草稿仍保留'); return false; }
        if (current.status >= 500) throw new Error('頁面服務暫時不可用');
        if (!current.ok) {
          opened?.provider.disconnect(); setError('頁面無法存取，本機內容已隔離'); setIsolated({ page });
          const failure = await current.json() as { page?: PageInfo }; if (failure.page) setRecovery(failure.page);
          return false;
        }
        const info = await current.json() as PageInfo;
        if (info.owner_id !== page.owner_id || info.sync_generation !== page.sync_generation) {
          opened?.provider.disconnect(); setError('頁面世代或權限已變更，本機內容已隔離');
          if (info.owner_id === page.owner_id) setIsolated({ page, current: info });
          return false;
        }
        return true;
      };
      opened = await start([page.owner_id, page.id, page.sync_generation], checkAccess, localOnly);
      if (disposed) { opened.provider.destroy(); await opened.cache.destroy(); opened.doc.destroy(); return; }
      setSession(opened);
    })().catch(failure => setError(failure instanceof Error && /尚未下載|本機啟動資源/.test(failure.message) ? failure.message : '載入失敗，請連線後再試'));
    return () => { disposed = true; opened?.provider.destroy(); void opened?.cache.destroy(); opened?.doc.destroy(); };
  }, [confirm]);
  if (confirm) return <main><Login confirm /></main>;
  const fork = async () => {
    if (!isolated || !session || forking) return;
    setForking(true);
    try {
      await saveLocal(session.cache);
      const response = await fetch(`/api/pages/${isolated.page.id}/fork`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: (await readLocal(session.cache)).slice() });
      if (response.status === 401) setLogin(true);
      if (!response.ok) throw new Error((await response.json() as { message: string }).message);
      const copy = await response.json() as PageInfo; await navigate(copy.id);
    } catch (failure) { setError(failure instanceof Error ? failure.message : '另存失敗，草稿仍保留，請重試'); }
    finally { setForking(false); }
  };
  return <>
    {error && <p role="alert">{error}</p>}
    {login && <main><Login /></main>}
    {page && !login && <button hidden={settings} onClick={() => {
      void saveDraft().then(() => setSettings(true)).catch(failure => setError(failure instanceof Error ? failure.message : '本機儲存失敗'));
    }}>備份設定</button>}
    {settings && <BackupSettings close={() => setSettings(false)} unauthorized={() => { setSettings(false); setLogin(true); }} />}
    <div className="workspace" hidden={settings} style={settings ? { display: 'none' } : undefined}>
      {!login && !isolated && (page || recovery) && <Navigation page={(page ?? recovery)!} changed={setPage} error={setError} />}
      {isolated && !login && <main>
        <p>本機草稿已隔離。{isolated.current ? `目前版本：${isolated.current.title}` : '原頁面無法編輯，請還原或另存。'}</p>
        <button onClick={() => setViewDraft(true)}>檢視本機草稿</button>{' '}
        <button disabled={forking || !session} onClick={() => { void fork(); }}>{forking ? '另存中' : '另存為筆記'}</button>{' '}
        {isolated.current && <button onClick={() => {
          sessionStorage.setItem('p-note-load-current', isolated.page.id); void navigate(isolated.page.id).catch(() => setError('本機儲存失敗，草稿仍保留'));
        }}>載入目前版本</button>}
      </main>}
      {recovery && <main><button onClick={() => {
        void api(`/api/pages/${recovery.id}/restore`, {}).then(async response => {
          if (!response.ok) { setError((await response.json() as { message: string }).message); return; }
          await navigate(recovery.id);
        }).catch(() => setError('還原失敗，請重試'));
      }}>還原此頁</button></main>}
      {session && page && (!isolated || viewDraft) ? <Editor session={session} title={(page.kind === 'journal' ? '日記 ' : '筆記 ') + page.title} readOnly={login || !!isolated} /> : !login && !error && <main><p>載入中</p></main>}
    </div>
  </>;
}

const root = createRoot(document.getElementById('root')!);
if (location.pathname === '/probe') {
  root.render(<main><h1>p-note 技術驗證</h1><p>載入中</p></main>);
  void start().then(session => root.render(<Editor session={session} />)).catch(error => {
    root.render(<main><h1>p-note 技術驗證</h1><p role="alert">{error instanceof Error ? error.message : '載入失敗'}</p></main>);
  });
} else root.render(<App />);
