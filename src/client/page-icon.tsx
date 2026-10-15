import { Alert, Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { IconBook2, IconDatabase, IconFileText, IconMoodSmile } from '@tabler/icons-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { PageInfo, PageRow } from '../shared/pages';
import { isPageIcon } from '../shared/page-icon';
import { api } from './api';
import { rememberPage } from './page-cache';
import './page-icon.css';

export type IconPage = Pick<PageRow, 'id' | 'title' | 'kind'> & {
  icon?: string | null;
  database_config?: string | null;
  metadata_revision?: number;
  sync_generation?: string;
};
type IconSize = number | 'large' | 'small';
type DisplayPage = Pick<IconPage, 'kind' | 'icon' | 'database_config'>;

const choices = ['📄', '📝', '📚', '📖', '📅', '🗂️', '💡', '⭐', '🌟', '🎯', '✅', '💼',
  '🏠', '🌱', '🌸', '🌈', '☀️', '🌙', '🔥', '❤️', '🎨', '🎵', '🎉', '☕',
  '🍀', '🐱', '🐶', '🚀', '✈️', '🌍', '💻', '🔬', '🧠', '🛠️', '📊', '🗃️'];
const pixels = (size: IconSize) => typeof size === 'number' ? size : size === 'large' ? 64 : 18;

function samePageVersion(a: IconPage, b: IconPage) {
  return a.id === b.id && (!a.sync_generation || !b.sync_generation || a.sync_generation === b.sync_generation);
}
function olderMetadata(next: IconPage, current: IconPage) {
  return current.metadata_revision !== undefined
    && (next.metadata_revision === undefined || next.metadata_revision < current.metadata_revision);
}

export function publishPageMetadata(page: PageInfo) {
  try { rememberPage(page); } catch { /* 仍以已儲存的伺服器回應更新畫面。 */ }
  window.dispatchEvent(new CustomEvent<PageInfo>('p-note:page-metadata', { detail: page }));
}

export function PageIcon({ page, size = 'small', className = '', fallback }: {
  page: DisplayPage;
  size?: IconSize;
  className?: string;
  fallback?: ReactNode;
}) {
  const width = pixels(size);
  const Fallback = page.database_config ? IconDatabase : page.kind === 'journal' ? IconBook2 : IconFileText;
  return <span className={'page-icon ' + className} aria-hidden="true" data-page-icon={page.icon ?? ''}
    style={{ '--page-icon-size': width + 'px' } as CSSProperties}>
    {page.icon || fallback || <Fallback size={width} stroke={1.6} />}
  </span>;
}

export function PageIconPicker({ page, changed, disabled = false, size = 'small', className = '', fallback, opened: controlledOpened, onOpenedChange, hideTrigger = false }: {
  page: IconPage;
  changed?: (page: PageInfo) => void;
  disabled?: boolean;
  size?: IconSize;
  className?: string;
  fallback?: ReactNode;
  opened?: boolean;
  onOpenedChange?: (opened: boolean) => void;
  hideTrigger?: boolean;
}) {
  const [received, setReceived] = useState<IconPage>(page);
  const authoritative = samePageVersion(page, received) && olderMetadata(page, received) ? received : page;
  const latest = useRef(authoritative);
  latest.current = authoritative;
  const icon = authoritative.icon ?? null;
  const mounted = useRef(true);
  const [internalOpened, setInternalOpened] = useState(false);
  const opened = controlledOpened ?? internalOpened;
  const setOpened = (next: boolean) => { setInternalOpened(next); onOpenedChange?.(next); };
  const [draft, setDraft] = useState(page.icon ?? '');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    mounted.current = true;
    const updated = (event: Event) => {
      const next = (event as CustomEvent<PageInfo>).detail;
      if (!samePageVersion(next, latest.current) || olderMetadata(next, latest.current)) return;
      latest.current = next;
      setReceived(next);
    };
    addEventListener('p-note:page-metadata', updated);
    return () => { mounted.current = false; removeEventListener('p-note:page-metadata', updated); };
  }, []);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    addEventListener('online', update);
    addEventListener('offline', update);
    return () => { removeEventListener('online', update); removeEventListener('offline', update); };
  }, []);
  const blocked = disabled || !online || busy;
  const save = async (next: string | null) => {
    if (blocked || !navigator.onLine) return;
    if (!isPageIcon(next)) { setFailure('請輸入一個 emoji 作為圖示'); return; }
    if (next === icon) { setOpened(false); return; }
    setBusy(true);
    setFailure('');
    try {
      const response = await api('/api/pages/' + encodeURIComponent(page.id) + '/icon', { icon: next });
      const value = await response.json() as PageInfo & { message?: string };
      if (!response.ok) throw new Error(value.message ?? '圖示儲存失敗，請重試');
      if (!mounted.current) return;
      if (samePageVersion(value, latest.current) && !olderMetadata(value, latest.current)) {
        latest.current = value;
        setReceived(value);
        publishPageMetadata(value);
        changed?.(value);
      }
      setOpened(false);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : '圖示儲存失敗，請重試');
    } finally { setBusy(false); }
  };
  const large = size === 'large';
  return <>
    {!hideTrigger && <button type="button" className={'page-icon-trigger ' + (large ? 'page-icon-trigger-large ' : '') + className}
      aria-label={(icon ? '更換' : '新增') + '「' + page.title + '」圖示'}
      aria-haspopup="dialog" aria-expanded={opened} disabled={blocked}
      title={!online ? '連線後可更換頁面圖示' : icon ? '更換圖示' : '新增圖示'}
      onClick={event => {
        event.stopPropagation();
        setDraft(icon ?? ''); setFailure(''); setOpened(true);
      }}>
      {large && !icon ? <><IconMoodSmile size={17} stroke={1.6} aria-hidden="true" /><span>新增圖示</span></>
        : <PageIcon page={{ ...page, icon }} size={size} fallback={fallback} />}
    </button>}
    <Modal opened={opened} onClose={() => { if (!busy) setOpened(false); }} title="頁面圖示"
      size="sm" className="page-icon-dialog" closeButtonProps={{ 'aria-label': '關閉圖示選擇' }}
      closeOnClickOutside={!busy} closeOnEscape={!busy}>
      <Stack gap="md">
        <Text size="sm" c="dimmed">為「{page.title}」選擇一個 emoji。</Text>
        {!online && <Text size="sm" role="status">連線後可更換頁面圖示</Text>}
        <div className="page-icon-choices" role="group" aria-label="常用 emoji">
          {choices.map(value => <button type="button" key={value} className="page-icon-choice"
            aria-label={'選擇圖示 ' + value} aria-pressed={icon === value} disabled={blocked}
            onClick={() => { void save(value); }}>{value}</button>)}
        </div>
        <form onSubmit={event => { event.preventDefault(); void save(draft.trim()); }}>
          <Stack gap="xs">
            <TextInput label="自訂 emoji" placeholder="輸入或貼上一個 emoji" value={draft}
              disabled={blocked} onChange={event => { setDraft(event.currentTarget.value); setFailure(''); }} />
            <Group justify="space-between">
              <Button variant="subtle" color="gray" disabled={blocked || !icon} onClick={() => { void save(null); }}>移除圖示</Button>
              <Button type="submit" loading={busy} disabled={blocked || !draft.trim()}>套用圖示</Button>
            </Group>
          </Stack>
        </form>
        {failure && <Alert color="red" role="alert">{failure}</Alert>}
      </Stack>
    </Modal>
  </>;
}
