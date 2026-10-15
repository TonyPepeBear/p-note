import { useEffect, useState } from 'react';
import { Alert, Button, Group, Modal, Paper, Stack, Text, Title } from '@mantine/core';
import { api } from './api';

type Connection = { id: string; name: string; scopes: string; created_at: number; expires_at: number };
export function McpConnections({ unauthorized }: { unauthorized: () => void }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selected, setSelected] = useState<Connection>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function request(path: string, input?: object) {
    const response = await api(path, input);
    if (response.status === 401) unauthorized();
    if (!response.ok) throw new Error('無法管理 MCP 連線，請重新登入或稍後重試');
    return response;
  }
  async function load() {
    setError('');
    try { setConnections(await (await request('/api/mcp-connections')).json()); }
    catch (failure) { setError((failure as Error).message); }
  }
  useEffect(() => { void load(); }, []);
  return <section className="settings-section" aria-labelledby="mcp-connections-title">
    <Title id="mcp-connections-title" order={2} size="sm">MCP 雲端連線</Title>
    <Text size="sm" c="dimmed" mt={6}>管理已授權的應用。撤銷後立即停止筆記存取；網站登入仍可使用。</Text>
    {error && <Alert color="red" role="alert" mt="sm">{error}<Button variant="subtle" onClick={() => void load()}>重新載入</Button></Alert>}
    {!connections.length && <Text size="sm" mt="md">目前沒有已授權的 MCP 連線。</Text>}
    <Stack gap="sm" mt="md">{connections.map(connection => <Paper key={connection.id} data-testid="mcp-connection" withBorder p="md">
      <Group justify="space-between"><div><Text fw={500}>{connection.name}</Text><Text size="sm" c="dimmed">{connection.scopes.split(' ').includes('notes:write') ? '可讀取及修改筆記' : '唯讀筆記'} · 到期 {new Date(connection.expires_at).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' })}</Text></div><Button color="red" variant="subtle" disabled={busy} onClick={() => setSelected(connection)}>撤銷連線</Button></Group>
    </Paper>)}</Stack>
    <Modal opened={!!selected} onClose={() => !busy && setSelected(undefined)} title="撤銷 MCP 連線？" centered>
      <Text size="sm">撤銷「{selected?.name}」後，該應用需重新授權才能存取筆記。</Text>
      <Group justify="flex-end" mt="md"><Button variant="default" disabled={busy} onClick={() => setSelected(undefined)}>取消</Button><Button color="red" loading={busy} onClick={() => {
        if (!selected) return;
        const id = selected.id; setBusy(true); setError('');
        void request(`/api/mcp-connections/${id}/revoke`, {}).then(() => { setConnections(current => current.filter(item => item.id !== id)); setSelected(undefined); }).catch(failure => setError((failure as Error).message)).finally(() => setBusy(false));
      }}>確認撤銷連線</Button></Group>
    </Modal>
  </section>;
}
