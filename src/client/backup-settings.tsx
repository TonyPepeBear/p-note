import { useEffect, useState } from 'react';
import { api } from './api';
import type { BackupCatalog } from '../shared/backup';

export function BackupSettings({ close, unauthorized }: { close: () => void; unauthorized: () => void }) {
  const [backups, setBackups] = useState<BackupCatalog[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const load = async () => {
    const response = await api('/api/backups');
    if (response.status === 401) unauthorized();
    if (!response.ok) throw new Error('無法載入備份，請重新登入或稍後重試');
    setBackups((await response.json() as { backups: BackupCatalog[] }).backups);
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
    <button disabled={busy} onClick={() => { void create(); }}>{busy ? '備份建立中' : '建立備份'}</button>{' '}
    <button disabled={busy} onClick={close}>返回編輯</button>
    {error && <p role="alert">{error}</p>}
    <ul>{backups.map(backup => <li key={backup.id}>
      <time dateTime={new Date(backup.completed_at ?? backup.started_at).toISOString()}>{new Date(backup.completed_at ?? backup.started_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}</time>{' '}
      <span>{labels[backup.status]}</span>{' '}
      {backup.status === 'success' && <a href={`/api/backups/${backup.id}/export`} download={`p-note-${backup.id}.zip`}>下載 ZIP</a>}
      {backup.error && <p>{backup.error}</p>}
    </li>)}</ul>
  </main>;
}
