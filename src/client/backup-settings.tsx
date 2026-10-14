import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconArrowLeft,
  IconCloud,
  IconDownload,
  IconHistory,
  IconShieldCheck,
} from "@tabler/icons-react";
import { Brand } from "./ui";
import { useEffect, useState } from "react";
import { api } from "./api";
import type { BackupCatalog } from "../shared/backup";

export function BackupSettings({
  close,
  unauthorized,
}: {
  close: () => void;
  unauthorized: () => void;
}) {
  const [backups, setBackups] = useState<BackupCatalog[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [operation, setOperation] = useState<{ backup: string; id: string }>();
  const [interrupted, setInterrupted] = useState(false);
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
    <main className="backup-page">
      <Group justify="space-between">
        <Brand />
        <Button
          variant="default"
          leftSection={<IconArrowLeft size={17} />}
          disabled={busy || interrupted}
          onClick={close}
        >
          返回編輯
        </Button>
      </Group>
      <div className="backup-heading">
        <Badge variant="light" color="teal">
          DATA & BACKUP
        </Badge>
        <Group justify="space-between" align="end" mt="md">
          <div>
            <Title order={1}>備份設定</Title>
            <Text c="dimmed" mt="xs">
              給你的想法，多一份安心。
            </Text>
          </div>
          <Button
            disabled={busy || interrupted || loading}
            loading={busy && !operation}
            leftSection={<IconCloud size={18} />}
            onClick={() => {
              void create();
            }}
          >
            建立備份
          </Button>
        </Group>
      </div>
      <Paper withBorder p="lg" mb="xl" radius="lg">
        <Group align="start" wrap="nowrap">
          <ThemeIcon variant="light" size={40} radius="md">
            <IconShieldCheck size={22} />
          </ThemeIcon>
          <div>
            <Text fw={600}>每日自動備份，保留 90 天</Text>
            <Text size="sm" c="dimmed" mt={5} lh={1.8}>
              每日台北 03:00 備份，成功後保留 90
              天。備份只包含已送達雲端的內容。ZIP 會包含頁面、日記與原始圖片。
            </Text>
          </div>
        </Group>
      </Paper>
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
      {loading ? (
        <Group justify="center" py="xl">
          <Loader size="sm" />
          <Text c="dimmed">載入備份中…</Text>
        </Group>
      ) : !backups.length ? (
        <div className="backup-empty">
          <IconHistory size={42} color="#718a74" stroke={1.3} />
          <Title order={2} size="xl" mt="md">
            還沒有備份
          </Title>
          <Text c="dimmed" size="sm" mt="sm">
            建立第一份備份，或等待下次自動備份。
          </Text>
        </div>
      ) : (
        <Stack gap="md">
          {backups.map((backup) => (
            <Paper
              withBorder
              p="lg"
              radius="lg"
              className="backup-card"
              key={backup.id}
            >
              <Group justify="space-between" align="start">
                <div>
                  <Group gap="sm">
                    <IconHistory size={19} color="#68856c" />
                    <Text fw={600}>
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
                    mt="sm"
                    variant="light"
                    color={
                      backup.status === "success"
                        ? "teal"
                        : backup.status === "failed"
                          ? "red"
                          : "gray"
                    }
                  >
                    {labels[backup.status]}
                  </Badge>
                </div>
                {backup.status === "success" && (
                  <Group gap="xs">
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
                      variant="light"
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
              </Group>
              {backup.error && (
                <Text size="sm" c="red" mt="sm">
                  {backup.error}
                </Text>
              )}
            </Paper>
          ))}
        </Stack>
      )}
      {selected && (
        <Paper
          component="section"
          aria-label="覆蓋還原確認"
          withBorder
          p="xl"
          mt="xl"
          radius="lg"
          style={{ borderColor: "#e8cbb8", background: "#fffcf8" }}
        >
          <Stack gap="lg">
            <div>
              <Title order={2} size="xl">
                還原這份備份
              </Title>
              <Text c="dimmed" size="sm" mt="sm" lh={1.8}>
                還原會覆蓋目前所有頁面、日記與階層。開始前會備份目前的雲端內容；其他分頁的本機草稿會保留並隔離。
              </Text>
            </div>
            <Divider />
            <Checkbox
              label="我知道將以備份覆蓋目前頁面"
              checked={acknowledged}
              disabled={busy}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <Button
              color="orange.9"
              disabled={busy || !acknowledged}
              loading={busy}
              onClick={() => {
                void restore();
              }}
            >
              {busy ? "還原處理中" : "覆蓋還原"}
            </Button>
          </Stack>
        </Paper>
      )}
    </main>
  );
}
