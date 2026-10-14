import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Code, Container, Group, Loader, Modal, Paper, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconArrowLeft, IconKey } from '@tabler/icons-react';
import { api } from './api';

type KeyInfo = { id: string; name: string; prefix: string; created_at: number; last_used_at: number | null };
export function ApiKeySettings({ close, unauthorized }: { close: () => void; unauthorized: () => void }) {
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [name, setName] = useState('');
  const [shown, setShown] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<KeyInfo | null>(null);
  async function request(path: string, data?: object) {
    const response = await api(path, data);
    if (response.status === 401) { setShown({}); unauthorized(); throw new Error('請重新登入'); }
    if (!response.ok) { const value = await response.json().catch(() => ({})) as { message?: string }; throw new Error(value.message ?? '操作失敗，請稍後重試'); }
    return response;
  }
  async function load() { setKeys(await (await request('/api/keys')).json() as KeyInfo[]); }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (failure) { setError(failure instanceof Error ? failure.message : '操作失敗，請重試'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load().catch(() => setError('無法載入 API key，請重試')).finally(() => setLoading(false)); }, []);
  return <Container size="sm" py="xl" component="main">
    <Stack gap="lg">
      <Button variant="subtle" leftSection={<IconArrowLeft size={18} />} onClick={close} style={{ alignSelf: 'flex-start' }}>返回筆記</Button>
      <div><Title order={1}>設定</Title><Text c="dimmed" mt="xs">管理自己的 API key，讓程式連接你的筆記與日記。</Text></div>
      {error && <Alert color="red" role="alert" title="操作未完成">{error}<Button variant="subtle" disabled={busy} onClick={() => void run(load)}>重新載入</Button></Alert>}
      {notice && <Text role="status" c="teal">{notice}</Text>}
      <Paper withBorder p="lg" radius="md"><Stack>
        <Group><IconKey size={22} /><Title order={2} size="h3">API key</Title><Badge>自己的帳號</Badge></Group>
        <Text size="sm">可讀取、搜尋、建立及修改自己的筆記與日記。不能刪除、操作備份或管理其他 key。Key 沒有到期日，可隨時撤銷。</Text>
        <form onSubmit={event => { event.preventDefault(); void run(async () => { const item = await (await request('/api/keys', { name: name.trim() })).json() as KeyInfo; setKeys(current => [item, ...current]); setName(''); setNotice('API key 已建立，點選「顯示」即可查看。'); }); }}>
          <Stack gap="sm"><TextInput label="API key 名稱" placeholder="例如：我的自動化" value={name} onChange={event => setName(event.currentTarget.value)} maxLength={80} required />
          <Button type="submit" disabled={busy || !name.trim() || loading} loading={busy}>建立 API key</Button></Stack>
        </form>
      </Stack></Paper>
      {loading ? <Loader aria-label="載入 API key" /> : !keys.length && <Text c="dimmed">尚未建立 API key。</Text>}
      {keys.map(item => <Paper key={item.id} data-testid="api-key-card" withBorder p="lg" radius="md"><Stack gap="sm">
        <Text fw={600} style={{ overflowWrap: 'anywhere' }}>{item.name}</Text>
        <Text size="xs" c="dimmed">建立於 {new Date(item.created_at).toLocaleString('zh-TW')} · {item.last_used_at ? '最近使用 ' + new Date(item.last_used_at).toLocaleString('zh-TW') : '尚未使用'}</Text>
        {shown[item.id] ? <TextInput label="完整 API key" value={shown[item.id]} readOnly styles={{ input: { fontFamily: 'monospace' } }} /> : <Code>{item.prefix}••••••••</Code>}
        <Group>
          <Button variant="light" disabled={busy} onClick={() => { if (shown[item.id]) setShown(current => { const next = { ...current }; delete next[item.id]; return next; }); else void run(async () => { const result = await (await request(`/api/keys/${item.id}/reveal`, {})).json() as { key: string }; setShown(current => ({ ...current, [item.id]: result.key })); }); }}>{shown[item.id] ? '隱藏' : '顯示'}</Button>
          {shown[item.id] && <Button variant="default" disabled={busy} onClick={() => void run(async () => { try { await navigator.clipboard.writeText(shown[item.id]); setNotice('已複製 API key。'); } catch { throw new Error('無法存取剪貼簿，請選取上方 key 手動複製'); } })}>複製</Button>}
          <Button color="red" variant="subtle" disabled={busy} onClick={() => setSelected(item)}>撤銷</Button>
        </Group>
      </Stack></Paper>)}
      <Paper withBorder p="lg" radius="md"><Stack gap="xs"><Title order={2} size="h3">如何使用</Title>
        <Text size="sm">API 網址：<Code>{location.origin}/api/v1</Code></Text>
        <Text size="sm">在請求標頭帶上 <Code>Authorization: Bearer YOUR_API_KEY</Code>。例如 <Code>GET /api/v1/pages</Code> 列出筆記與日記。</Text>
        <Text size="sm">讀取正文：<Code>GET /api/v1/pages/:id/content</Code>。更新時以 <Code>PUT</Code> 傳送 <Code>{'{"blocks":[{"type":"paragraph","content":"你好"}]}'}</Code>，並把讀取回應的 ETag 放在 <Code>If-Match</Code> 標頭。</Text>
        <Text size="sm" c="dimmed">Key 之後仍可再次顯示。請只交給你信任的程式；離開此頁後會重新隱藏。</Text>
      </Stack></Paper>
    </Stack>
    <Modal opened={!!selected} onClose={() => !busy && setSelected(null)} title="撤銷 API key？" centered>
      <Stack><Text>「{selected?.name}」撤銷後，使用這把 key 的程式將無法繼續存取。</Text><Group justify="flex-end"><Button variant="default" disabled={busy} onClick={() => setSelected(null)}>取消</Button><Button color="red" loading={busy} onClick={() => { if (selected) void run(async () => { await request(`/api/keys/${selected.id}/revoke`, {}); setKeys(current => current.filter(k => k.id !== selected.id)); setShown(current => { const next = { ...current }; delete next[selected.id]; return next; }); setSelected(null); setNotice('API key 已撤銷。'); }); }}>確認撤銷</Button></Group></Stack>
    </Modal>
  </Container>;
}
