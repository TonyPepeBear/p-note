import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  IconArrowLeft,
  IconCloud,
  IconDownload,
  IconHistory,
  IconShieldCheck,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { BackupCatalog } from "../shared/backup";
import "./settings.css";

export function BackupSettings({
  close,
  unauthorized,
  onNavigationLockChange,
}: {
  close: () => void;
  unauthorized: () => void;
  onNavigationLockChange?: (locked: boolean) => void;
}) {
  const [backups, setBackups] = useState<BackupCatalog[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [operation, setOperation] = useState<{ backup: string; id: string }>();
  const [interrupted, setInterrupted] = useState(false);
  const confirmation = useRef<HTMLElement>(null);
  useEffect(() => {
    onNavigationLockChange?.(busy || interrupted);
  }, [busy, interrupted, onNavigationLockChange]);
  useEffect(() => {
    // 只在實例卸載時釋放；busy 改變時不先解除，避免中斷重試短暫開放導覽。
    // React 先清理舊實例，再執行新實例的 effect，新的鎖定狀態不會被覆蓋。
    return () => onNavigationLockChange?.(false);
  }, [onNavigationLockChange]);
  useEffect(() => {
    if (selected)
      confirmation.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
  }, [selected]);
  const load = async () => {
    const response = await api("/api/backups");
    if (response.status === 401) unauthorized();
    if (!response.ok) throw new Error("無法載入備份，請重新登入或稍後重試");
    const data = (await response.json()) as {
      backups: BackupCatalog[];
      restore: { id: string; backup_id: string } | null;
    };
    setBackups(data.backups);
    if (data.restore) {
      const pending = { backup: data.restore.backup_id, id: data.restore.id };
      sessionStorage.setItem("p-note-restore-request", JSON.stringify(pending));
      setOperation(pending);
      setSelected(pending.backup);
      setInterrupted(true);
    }
  };
  const restore = async () => {
    if (!selected || !acknowledged) return;
    setBusy(true);
    setError("");
    try {
      const saved = sessionStorage.getItem("p-note-restore-request");
      const pending =
        operation ??
        (saved
          ? (JSON.parse(saved) as { backup: string; id: string })
          : undefined);
      const request =
        pending?.backup === selected
          ? pending
          : { backup: selected, id: crypto.randomUUID() };
      // 重試必須沿用請求識別，避免回應遺失後再次覆蓋使用者的新內容。
      sessionStorage.setItem("p-note-restore-request", JSON.stringify(request));
      setOperation(request);
      const response = await api(`/api/backups/${selected}/restore`, {
        request_id: request.id,
      });
      if (response.status === 401) unauthorized();
      if (!response.ok)
        throw new Error(
          ((await response.json()) as { message: string }).message,
        );
      sessionStorage.removeItem("p-note-restore-request");
      sessionStorage.removeItem("p-note-scope");
      sessionStorage.setItem("p-note-load-current", "restored");
      location.assign("/");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "還原未完成，請重試相同備份",
      );
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load()
      .catch(() => setError("無法載入備份，請重新登入或稍後重試"))
      .finally(() => setLoading(false));
  }, []);
  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await api("/api/backups", {});
      if (response.status === 401) unauthorized();
      if (!response.ok)
        throw new Error(
          ((await response.json()) as { message: string }).message,
        );
      await load();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "備份未完成，請稍後重試",
      );
    } finally {
      setBusy(false);
    }
  };
  const labels = {
    pending: "處理中",
    success: "成功",
    failed: "失敗",
    expiring: "清理中",
  };
  return (
    <section className="settings-page backup-page" aria-label="備份設定">
      <header className="settings-header">
        <Button
          className="settings-back"
          variant="subtle"
          color="gray"
          leftSection={<IconArrowLeft size={16} />}
          disabled={busy || interrupted}
          onClick={close}
        >
          返回編輯
        </Button>
        <Title order={1}>備份設定</Title>
        <Text c="dimmed" size="sm" mt={8}>
          管理雲端備份、匯出內容，或將工作區還原至先前版本。
        </Text>
      </header>
      <section className="settings-section" aria-labelledby="backup-schedule-title">
        <div className="settings-info-row">
          <IconShieldCheck size={20} stroke={1.6} aria-hidden="true" />
          <div>
            <Title id="backup-schedule-title" order={2} size="sm">
              每日自動備份，保留 90 天
            </Title>
            <Text size="sm" c="dimmed" mt={6} lh={1.7}>
              每日台北 03:00 備份，成功後保留 90
              天。備份只包含已送達雲端的內容。ZIP 會包含頁面、日記與原始圖片。
            </Text>
          </div>
        </div>
      </section>
      {interrupted && (
        <Alert color="orange" role="status" mb="lg" title="還原需要繼續">
          還原尚未完成，請重試相同備份；完成前暫停頁面存取。
        </Alert>
      )}
      {error && (
        <Alert color="red" role="alert" mb="lg">
          {error}
        </Alert>
      )}
      <section className="settings-section backup-history" aria-labelledby="backup-history-title">
        <Group className="settings-section-heading" justify="space-between">
          <Group gap={8}>
            <Title id="backup-history-title" order={2} size="sm">備份紀錄</Title>
            {!loading && <Text size="xs" c="dimmed">{backups.length} 份</Text>}
          </Group>
          <Button
            disabled={busy || interrupted || loading}
            loading={busy && !operation}
            leftSection={<IconCloud size={16} />}
            onClick={() => {
              void create();
            }}
          >
            建立備份
          </Button>
        </Group>
      {loading ? (
        <Group className="settings-loading" gap="sm" role="status">
          <Loader size="sm" />
          <Text c="dimmed" size="sm">載入備份中…</Text>
        </Group>
      ) : !backups.length ? (
        <div className="backup-empty">
          <IconHistory size={24} stroke={1.5} aria-hidden="true" />
          <Text fw={600} size="sm" mt="sm">
            還沒有備份
          </Text>
          <Text c="dimmed" size="sm" mt={4}>
            建立第一份備份，或等待下次自動備份。
          </Text>
        </div>
      ) : (
        <div className="settings-list">
          {backups.map((backup) => (
            <Paper
              className="backup-card"
              aria-current={selected === backup.id ? "true" : undefined}
              key={backup.id}
            >
              <div className="backup-row">
                <div className="backup-row-details">
                  <Group gap={8} wrap="nowrap">
                    <IconHistory size={17} className="settings-row-icon" aria-hidden="true" />
                    <Text fw={500} size="sm">
                      <time
                        dateTime={new Date(
                          backup.completed_at ?? backup.started_at,
                        ).toISOString()}
                      >
                        {new Date(
                          backup.completed_at ?? backup.started_at,
                        ).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}
                      </time>
                    </Text>
                  </Group>
                  <Badge
                    className="backup-status"
                    variant="light"
                    color={
                      backup.status === "success"
                        ? "gray"
                        : backup.status === "failed"
                          ? "red"
                          : "gray"
                    }
                  >
                    {labels[backup.status]}
                  </Badge>
                </div>
                {backup.status === "success" && (
                  <Group className="backup-row-actions" gap={6}>
                    <Button
                      component="a"
                      variant="default"
                      href={"/api/backups/" + backup.id + "/export"}
                      download={"p-note-" + backup.id + ".zip"}
                      leftSection={<IconDownload size={16} />}
                    >
                      下載 ZIP
                    </Button>
                    <Button
                      variant="default"
                      disabled={busy || (interrupted && selected !== backup.id)}
                      onClick={() => {
                        setSelected(backup.id);
                        setAcknowledged(false);
                        if (operation?.backup !== backup.id)
                          setOperation(undefined);
                      }}
                    >
                      選擇還原
                    </Button>
                  </Group>
                )}
              </div>
              {backup.error && (
                <Text size="sm" c="red.8" mt="sm">
                  {backup.error}
                </Text>
              )}
            </Paper>
          ))}
        </div>
      )}
      </section>
      {selected && (
        <Paper
          ref={confirmation}
          component="section"
          aria-label="覆蓋還原確認"
          className="restore-confirmation"
        >
          <Stack gap="md">
            <div>
              <Title order={2} size="sm">
                還原這份備份
              </Title>
              <Text c="dimmed" size="sm" mt="sm" lh={1.8}>
                還原會覆蓋目前所有頁面、日記與階層。開始前會備份目前的雲端內容；其他分頁尚未上傳的修改會另外保留。
              </Text>
            </div>
            <Checkbox
              label="我知道將以備份覆蓋目前頁面"
              checked={acknowledged}
              disabled={busy}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <Group justify="flex-end">
              <Button
                variant="default"
                disabled={busy || interrupted}
                onClick={() => {
                  setSelected("");
                  setAcknowledged(false);
                }}
              >
                取消還原
              </Button>
              <Button
                color="red.8"
                disabled={busy || !acknowledged}
                loading={busy}
                onClick={() => {
                  void restore();
                }}
              >
                {busy ? "還原處理中" : "覆蓋還原"}
              </Button>
            </Group>
          </Stack>
        </Paper>
      )}
    </section>
  );
}
