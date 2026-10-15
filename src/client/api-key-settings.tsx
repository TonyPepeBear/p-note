import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Code,
  Group,
  Loader,
  Modal,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconArrowLeft, IconKey, IconPlus } from "@tabler/icons-react";
import { api } from "./api";
import { McpConnections } from './mcp-connections';
import { LocalCacheSettings } from "./local-cache-settings";
import "./settings.css";

type KeyInfo = {
  id: string;
  name: string;
  prefix: string;
  created_at: number;
  last_used_at: number | null;
};

export function ApiKeySettings({
  close,
  unauthorized,
}: {
  close: () => void;
  unauthorized: () => void;
}) {
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [name, setName] = useState("");
  const [shown, setShown] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<KeyInfo | null>(null);

  async function request(path: string, data?: object) {
    const response = await api(path, data);
    if (response.status === 401) {
      setShown({});
      unauthorized();
      throw new Error("請重新登入");
    }
    if (!response.ok) {
      const value = (await response.json().catch(() => ({}))) as {
        message?: string;
      };
      throw new Error(value.message ?? "操作失敗，請稍後重試");
    }
    return response;
  }

  async function load() {
    setKeys((await (await request("/api/keys")).json()) as KeyInfo[]);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "操作失敗，請重試");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load()
      .catch(() => setError("無法載入 API key，請重試"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="settings-page api-key-page" aria-label="API key 設定">
      <header className="settings-header">
        <Button
          className="settings-back"
          variant="subtle"
          color="gray"
          leftSection={<IconArrowLeft size={16} />}
          onClick={close}
        >
          返回筆記
        </Button>
        <Title order={1}>API key 設定</Title>
        <Text c="dimmed" size="sm" mt={8}>
          管理自己的 API key，讓程式連接你的筆記與日記。
        </Text>
      </header>

      {error && (
        <Alert color="red" role="alert" title="操作未完成" mb="lg">
          {error}
          <Button variant="subtle" disabled={busy} onClick={() => void run(load)}>
            重新載入
          </Button>
        </Alert>
      )}
      {notice && (
        <Alert color="blue" role="status" mb="lg">
          {notice}
        </Alert>
      )}

      <section className="settings-section" aria-labelledby="api-key-create-title">
        <Title id="api-key-create-title" order={2} size="sm">
          建立新的 API key
        </Title>
        <Text size="sm" c="dimmed" mt={6} lh={1.7}>
          可讀取、搜尋、建立及修改自己的筆記與日記。不能刪除、操作備份或管理其他 key。
          Key 沒有到期日，可隨時撤銷。
        </Text>
        <form
          className="api-key-create-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const item = (await (
                await request("/api/keys", { name: name.trim() })
              ).json()) as KeyInfo;
              setKeys((current) => [item, ...current]);
              setName("");
              setNotice("API key 已建立，點選「顯示」即可查看。");
            });
          }}
        >
          <TextInput
            label="API key 名稱"
            placeholder="例如：我的自動化"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            maxLength={80}
            required
            disabled={busy}
          />
          <Button
            type="submit"
            disabled={busy || !name.trim() || loading}
            loading={busy}
            leftSection={<IconPlus size={16} />}
          >
            建立 API key
          </Button>
        </form>
      </section>

      <section className="settings-section" aria-labelledby="api-key-list-title">
        <Group className="settings-section-heading" gap={8}>
          <Title id="api-key-list-title" order={2} size="sm">你的 API key</Title>
          {!loading && <Text size="xs" c="dimmed">{keys.length} 把</Text>}
        </Group>
        {loading ? (
          <Group className="settings-loading" gap="sm" role="status">
            <Loader size="sm" aria-label="載入 API key" />
            <Text size="sm" c="dimmed">載入 API key 中…</Text>
          </Group>
        ) : !keys.length ? (
          <div className="settings-empty">
            <IconKey size={24} stroke={1.5} aria-hidden="true" />
            <Text size="sm" mt="sm">尚未建立 API key。</Text>
            <Text size="sm" c="dimmed" mt={4}>為需要存取筆記的程式建立專屬 key。</Text>
          </div>
        ) : (
          <div className="settings-list">
            {keys.map((item) => (
              <Paper key={item.id} data-testid="api-key-card" className="api-key-card">
                <div className="api-key-row-heading">
                  <IconKey size={17} className="settings-row-icon" aria-hidden="true" />
                  <div>
                    <Text fw={500} size="sm">{item.name}</Text>
                    <Text size="xs" c="dimmed" mt={3}>
                      建立於 {new Date(item.created_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}
                      {" · "}
                      {item.last_used_at
                        ? "最近使用 " + new Date(item.last_used_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })
                        : "尚未使用"}
                    </Text>
                  </div>
                </div>
                <div className="api-key-row-controls">
                  {shown[item.id] ? (
                    <TextInput
                      className="api-key-value"
                      label="完整 API key"
                      value={shown[item.id]}
                      readOnly
                      autoComplete="off"
                      spellCheck={false}
                    />
                  ) : (
                    <Code className="api-key-prefix">{item.prefix}••••••••</Code>
                  )}
                  <Group className="api-key-actions" gap={6}>
                    <Button
                      variant="default"
                      disabled={busy}
                      onClick={() => {
                        if (shown[item.id]) {
                          setShown((current) => {
                            const next = { ...current };
                            delete next[item.id];
                            return next;
                          });
                        } else {
                          void run(async () => {
                            const result = (await (
                              await request(`/api/keys/${item.id}/reveal`, {})
                            ).json()) as { key: string };
                            setShown((current) => ({ ...current, [item.id]: result.key }));
                          });
                        }
                      }}
                    >
                      {shown[item.id] ? "隱藏" : "顯示"}
                    </Button>
                    {shown[item.id] && (
                      <Button
                        variant="default"
                        disabled={busy}
                        onClick={() => void run(async () => {
                          try {
                            await navigator.clipboard.writeText(shown[item.id]);
                            setNotice("已複製 API key。");
                          } catch {
                            throw new Error("無法存取剪貼簿，請選取上方 key 手動複製");
                          }
                        })}
                      >
                        複製
                      </Button>
                    )}
                    <Button
                      color="red.8"
                      variant="subtle"
                      disabled={busy}
                      onClick={() => setSelected(item)}
                    >
                      撤銷
                    </Button>
                  </Group>
                </div>
              </Paper>
            ))}
          </div>
        )}
      </section>

      <section className="settings-section api-key-guide" aria-labelledby="api-key-guide-title">
        <Title id="api-key-guide-title" order={2} size="sm">如何使用</Title>
        <Stack gap={10} mt="sm">
          <Text size="sm">API 網址：<Code>{location.origin}/api/v1</Code></Text>
          <Text size="sm">
            在請求標頭帶上 <Code>Authorization: Bearer YOUR_API_KEY</Code>。
            例如 <Code>GET /api/v1/pages</Code> 列出筆記與日記。
          </Text>
          <Text size="sm">
            讀取正文：<Code>GET /api/v1/pages/:id/content</Code>。
            更新時以 <Code>PUT</Code> 傳送 <Code>{'{"blocks":[{"type":"paragraph","content":"你好"}]}'}</Code>，
            並把讀取回應的 ETag 放在 <Code>If-Match</Code> 標頭。
          </Text>
          <Text size="sm" c="dimmed">
            Key 之後仍可再次顯示。請只交給你信任的程式；離開此頁後會重新隱藏。
          </Text>
        </Stack>
      </section>
      <McpConnections unauthorized={unauthorized} />
      <LocalCacheSettings />

      <Modal
        opened={!!selected}
        onClose={() => !busy && setSelected(null)}
        title="撤銷 API key？"
        centered
        closeOnClickOutside={!busy}
        closeOnEscape={!busy}
        classNames={{ content: "api-key-revoke-dialog" }}
      >
        <Stack gap="md">
          <Text size="sm">
            「{selected?.name}」撤銷後，使用這把 key 的程式將無法繼續存取。
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" disabled={busy} onClick={() => setSelected(null)}>取消</Button>
            <Button
              color="red.8"
              loading={busy}
              onClick={() => {
                if (selected) {
                  void run(async () => {
                    await request(`/api/keys/${selected.id}/revoke`, {});
                    setKeys((current) => current.filter((key) => key.id !== selected.id));
                    setShown((current) => {
                      const next = { ...current };
                      delete next[selected.id];
                      return next;
                    });
                    setSelected(null);
                    setNotice("API key 已撤銷。");
                  });
                }
              }}
            >
              確認撤銷
            </Button>
          </Group>
        </Stack>
      </Modal>
    </section>
  );
}
