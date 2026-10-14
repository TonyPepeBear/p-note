import { useEffect, useState } from 'react';
import { Alert, Button, Modal, Stack, Text } from '@mantine/core';
import { IconDownload, IconRefresh } from '@tabler/icons-react';
import { applyPwaUpdate, installPwa, standalone, updateAvailable } from './pwa';

export function PwaControls() {
  const [, refresh] = useState(0);
  const [help, setHelp] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const change = () => refresh(value => value + 1);
    const display = matchMedia('(display-mode: standalone)');
    addEventListener('p-note:pwa', change);
    display.addEventListener('change', change);
    // 註冊可能在首次繪製與 effect 之間完成，訂閱後再讀一次 waiting 狀態。
    change();
    return () => { removeEventListener('p-note:pwa', change); display.removeEventListener('change', change); };
  }, []);
  return <Stack gap="xs">
    {!standalone() && <Button variant="subtle" leftSection={<IconDownload size={18} />} onClick={() => {
      void installPwa().then(shown => { if (!shown) setHelp(true); }).catch(() => setError('無法開啟安裝提示，請重試或使用瀏覽器選單'));
    }}>安裝 p-note</Button>}
    {updateAvailable() && <Button variant="light" loading={busy} leftSection={<IconRefresh size={18} />} onClick={() => {
      setBusy(true); setError('');
      void applyPwaUpdate().catch(failure => setError(failure instanceof Error ? failure.message : '更新失敗，請重試'))
        .finally(() => setBusy(false));
    }}>更新 p-note</Button>}
    {error && <Alert role="alert" color="red">{error}</Alert>}
    <Modal opened={help} onClose={() => setHelp(false)} title="安裝 p-note" closeButtonProps={{ 'aria-label': '關閉安裝說明' }}>
      <Stack>
        <Text>iPhone／iPad：以 Safari 開啟本站，點選「分享」，再選「加入主畫面」。</Text>
        <Text>Android／電腦：開啟瀏覽器選單，選擇「安裝應用程式」或「加入主畫面」。選項是否出現由瀏覽器決定。</Text>
        <Text size="sm" c="dimmed">安裝後仍使用原本的私人帳號。首次登入與下載筆記需要網路；已下載的筆記可離線續寫。</Text>
      </Stack>
    </Modal>
  </Stack>;
}
