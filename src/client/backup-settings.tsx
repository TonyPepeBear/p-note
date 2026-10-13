import { useEffect, useState } from 'react';
import { api } from './api';
import type { BackupCatalog } from '../shared/backup';

export function BackupSettings({ close, unauthorized }: { close: () => void; unauthorized: () => void }) {
  const [backups, setBackups] = useState<BackupCatalog[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [selected, setSelected] = useState(''); const [acknowledged, setAcknowledged] = useState(false);
  const [operation, setOperation] = useState<{ backup: string; id: string }>();
  const [interrupted, setInterrupted] = useState(false);
  const load = async () => {
    const response = await api('/api/backups');
    if (response.status === 401) unauthorized();
    if (!response.ok) throw new Error('無法載入備份，請重新登入或稍後重試');
    const data = await response.json() as { backups: BackupCatalog[]; restore: { id: string; backup_id: string } | null };
    setBackups(data.backups);
    if (data.restore) {
      const pending = { backup: data.restore.backup_id, id: data.restore.id };
      sessionStorage.setItem('p-note-restore-request', JSON.stringify(pending));
      setOperation(pending); setSelected(pending.backup); setInterrupted(true);
    }
  };
  const restore = async () => {
    if (!selected || !acknowledged) return;
    setBusy(true); setError('');
    try {
      const saved = sessionStorage.getItem('p-note-restore-request');
      const pending = operation ?? (saved ? JSON.parse(saved) as { backup: string; id: string } : undefined);
      const request = pending?.backup === selected ? pending : { backup: selected, id: crypto.randomUUID() };
      // 重試必須沿用請求識別，避免回應遺失後再次覆蓋使用者的新內容。
      sessionStorage.setItem('p-note-restore-request', JSON.stringify(request)); setOperation(request);
      const response = await api(`/api/backups/${selected}/restore`, { request_id: request.id });
      if (response.status === 401) unauthorized();
      if (!response.ok) throw new Error((await response.json() as { message: string }).message);
      sessionStorage.removeItem('p-note-restore-request'); sessionStorage.removeItem('p-note-scope');
      sessionStorage.setItem('p-note-load-current', 'restored');
      location.assign('/');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '還原未完成，請重試相同備份');
      await load().catch(() => {});
    } finally { setBusy(false); }
  };
  useEffect(() => { void load().catch(() => setError('無法載入備份，請重新登入或稍後重試')); }, []);
  const create = async () => {
    setBusy(true); setError('');
    try {
      const response = await api('/api/backups', {});
      if (response.status === 401) unauthorized();
      if (!response.ok) throw new Error((await response.json() as { message: string }).message);
      await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : '備份未完成，請稍後重試'); }
    finally { setBusy(false); }
  };
  const labels = { pending: '處理中', success: '成功', failed: '失敗', expiring: '清理中' };
  return <main>
    <h1>備份設定</h1>
    <p>每日台北 03:00 備份，成功後保留 90 天。備份只包含已送達雲端的內容。</p>
    <button disabled={busy || interrupted} onClick={() => { void create(); }}>建立備份</button>{' '}
    <button disabled={busy || interrupted} onClick={close}>返回編輯</button>
    {interrupted && <p role="status">還原尚未完成，請重試相同備份；完成前暫停頁面存取。</p>}
    {error && <p role="alert">{error}</p>}
    <ul>{backups.map(backup => <li key={backup.id}>
      <time dateTime={new Date(backup.completed_at ?? backup.started_at).toISOString()}>{new Date(backup.completed_at ?? backup.started_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}</time>{' '}
      <span>{labels[backup.status]}</span>{' '}
      {backup.status === 'success' && <a href={`/api/backups/${backup.id}/export`} download={`p-note-${backup.id}.zip`}>下載 ZIP</a>}
      {backup.status === 'success' && <button disabled={busy || (interrupted && selected !== backup.id)} onClick={() => {
        setSelected(backup.id); setAcknowledged(false);
        if (operation?.backup !== backup.id) setOperation(undefined);
      }}>選擇還原</button>}
      {backup.error && <p>{backup.error}</p>}
    </li>)}</ul>
    {selected && <section aria-label="覆蓋還原確認">
      <p>還原會覆蓋目前所有頁面、日記與階層。開始前會備份目前的雲端內容；其他分頁的本機草稿會保留並隔離。</p>
      <label><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} />我知道將以備份覆蓋目前頁面</label>{' '}
      <button disabled={busy || !acknowledged} onClick={() => { void restore(); }}>{busy ? '還原處理中' : '覆蓋還原'}</button>
    </section>}
  </main>;
}
