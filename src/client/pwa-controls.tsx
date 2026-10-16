import { useEffect, useRef, useState } from "react";
import { Alert, Button, Modal, Stack, Text, Title } from "@mantine/core";
import { IconDeviceDesktop, IconDeviceMobile, IconDownload } from "@tabler/icons-react";
import { installPwa, standalone } from "./pwa";
import "./pwa-controls.css";

export function PwaControls({
  disabled = false,
  onHelpOpenChange,
}: {
  disabled?: boolean;
  onHelpOpenChange?: (open: boolean) => void;
}) {
  const [, refresh] = useState(0);
  const [help, setHelp] = useState(false);
  const [installError, setInstallError] = useState("");
  const [installing, setInstalling] = useState(false);
  const installButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const change = () => refresh((value) => value + 1);
    const display = matchMedia("(display-mode: standalone)");
    addEventListener("p-note:pwa", change);
    display.addEventListener("change", change);
    // 安裝狀態可能在首次繪製與 effect 之間改變，訂閱後再讀一次。
    change();
    return () => {
      removeEventListener("p-note:pwa", change);
      display.removeEventListener("change", change);
    };
  }, []);

  useEffect(() => {
    if (disabled) setHelp(false);
  }, [disabled]);

  const helpOpened = help && !disabled;
  useEffect(() => {
    onHelpOpenChange?.(helpOpened);
  }, [helpOpened, onHelpOpenChange]);
  useEffect(() => () => onHelpOpenChange?.(false), [onHelpOpenChange]);

  const canInstall = !standalone();
  if (!canInstall && !installError && !help) return null;

  return (
    <div className="pwa-controls">
      {canInstall && (
        <Button
          ref={installButton}
          className="pwa-control"
          variant="subtle"
          color="gray"
          fullWidth
          disabled={disabled || installing}
          loading={installing}
          leftSection={<IconDownload size={17} stroke={1.7} />}
          onClick={() => {
            if (disabled || installing) return;
            setInstalling(true);
            setInstallError("");
            void installPwa()
              .then((shown) => { if (!shown) setHelp(true); })
              .catch(() => setInstallError("無法開啟安裝提示，請重試或使用瀏覽器選單"))
              .finally(() => setInstalling(false));
          }}
        >
          安裝 p-note
        </Button>
      )}
      {installError && <Alert className="pwa-error" role="alert" color="red">{installError}</Alert>}
      <Modal
        opened={helpOpened}
        onClose={() => setHelp(false)}
        returnFocus={false}
        onExitTransitionEnd={() => installButton.current?.focus()}
        title="安裝 p-note"
        zIndex={300}
        size={440}
        centered
        padding={20}
        classNames={{ content: "pwa-install-dialog" }}
        closeButtonProps={{ "aria-label": "關閉安裝說明" }}
      >
        <Text size="sm" c="dimmed" mb={20}>
          將 p-note 加入主畫面，直接開啟你的工作區。
        </Text>
        <section className="pwa-install-platform" aria-labelledby="pwa-ios-title">
          <IconDeviceMobile size={19} stroke={1.6} aria-hidden="true" />
          <div>
            <Title id="pwa-ios-title" order={2} size="sm">iPhone／iPad</Title>
            <Text size="sm" mt={6}>
              以 Safari 開啟本站，點選「分享」，再選「加入主畫面」。
            </Text>
          </div>
        </section>
        <section className="pwa-install-platform" aria-labelledby="pwa-desktop-title">
          <IconDeviceDesktop size={19} stroke={1.6} aria-hidden="true" />
          <div>
            <Title id="pwa-desktop-title" order={2} size="sm">Android／電腦</Title>
            <Text size="sm" mt={6}>
              開啟瀏覽器選單，選擇「安裝應用程式」或「加入主畫面」。選項是否出現由瀏覽器決定。
            </Text>
          </div>
        </section>
        <Stack className="pwa-install-footer" gap="sm">
          <Text size="sm" c="dimmed">
            安裝後仍使用原本的私人帳號。首次登入與下載筆記需要網路；已下載的筆記可離線續寫。
          </Text>
          <Button className="pwa-install-done" variant="default" onClick={() => setHelp(false)}>知道了</Button>
        </Stack>
      </Modal>
    </div>
  );
}
