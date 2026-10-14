import {
  MantineProvider,
  Alert,
  Button,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  Loader,
} from "@mantine/core";
import "@mantine/core/styles.css";
import { theme, Brand } from "./ui";
import { Login } from "./login";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Editor, start, type Session } from "./editor";
import type { PageInfo } from "../shared/pages";
import { api, navigate, saveDraft } from "./api";
import { BackupSettings } from "./backup-settings";
import { Navigation } from "./navigation";
import { rememberPage, cachedPage, cachedVersions } from "./page-cache";
import { readLocal, saveLocal } from "./cache";

function App() {
  const [session, setSession] = useState<Session>();
  const [page, setPage] = useState<PageInfo>();
  const [recovery, setRecovery] = useState<PageInfo>();
  const [isolated, setIsolated] = useState<{
    page: PageInfo;
    current?: PageInfo;
  }>();
  const [viewDraft, setViewDraft] = useState(false);
  const [forking, setForking] = useState(false);
  const [versions, setVersions] = useState<PageInfo[]>([]);
  const [draftVersion, setDraftVersion] = useState("");
  const [login, setLogin] = useState(false);
  const [error, setError] = useState("");
  const confirm = location.pathname === "/login/confirm";
  const [settings, setSettings] = useState(false);
  useEffect(() => {
    if (confirm) return;
    let disposed = false;
    let opened: Session | undefined;
    const localPage = (id: string, owner: string) => {
      try {
        const cached = cachedPage(id);
        return cached.owner_id === owner ? cached : undefined;
      } catch {
        return undefined;
      }
    };
    const isolate = async (old: PageInfo, current?: PageInfo) => {
      setIsolated({ page: old, current });
      setPage(old);
      opened = await start(
        [old.owner_id, old.id, old.sync_generation],
        async () => false,
        true,
        true,
      );
      if (disposed) {
        opened.provider.destroy();
        await opened.cache.destroy();
        opened.doc.destroy();
        return;
      }
      setSession(opened);
    };
    void (async () => {
      const id = new URLSearchParams(location.search).get("page");
      let response: Response | undefined;
      let localOnly = false;
      try {
        response = await api(
          id ? `/api/pages/${encodeURIComponent(id)}` : "/api/today",
        );
      } catch {
        localOnly = true;
      }
      if (response && response.status >= 500) {
        response = undefined;
        localOnly = true;
      }
      if (response?.status === 401) {
        setLogin(true);
        return;
      }
      if (response && !response.ok) {
        const failure = (await response.json()) as {
          message: string;
          page?: PageInfo;
        };
        setError(failure.message);
        if (failure.page) {
          setRecovery(failure.page);
          history.replaceState(null, "", "/?page=" + failure.page.id);
        }
        if (id) {
          const owner =
            failure.page?.owner_id ??
            (
              (await (await api("/api/session")).json()) as {
                user?: { id: string };
              }
            ).user?.id;
          const old = owner && localPage(id, owner);
          if (old) await isolate(old);
        }
        return;
      }
      const page = response
        ? ((await response.json()) as PageInfo)
        : cachedPage(id ?? undefined);
      const draft = new URLSearchParams(location.search).get("draft");
      if (draft) {
        const version = cachedVersions(page).find(
          (item) => item.sync_generation === draft,
        );
        if (!version) throw new Error("本機草稿資訊不完整，請載入目前版本");
        await isolate(version, page);
        return;
      }
      const old = localPage(page.id, page.owner_id);
      const accepted = sessionStorage.getItem("p-note-load-current");
      if (
        old &&
        old.sync_generation !== page.sync_generation &&
        accepted !== page.id &&
        accepted !== "restored"
      ) {
        setError("頁面世代已變更，本機內容已隔離");
        await isolate(old, page);
        return;
      }
      sessionStorage.removeItem("p-note-load-current");
      try {
        rememberPage(page);
        const previousVersions = cachedVersions(page);
        setVersions(previousVersions);
        setDraftVersion(previousVersions[0]?.sync_generation ?? "");
      } catch {
        setError("頁面資訊本機儲存失敗，離線開啟可能不可用；正文仍可儲存");
      }
      history.replaceState(null, "", `/?page=${page.id}`);
      sessionStorage.setItem(
        "p-note-return-url",
        location.pathname + location.search,
      );
      sessionStorage.setItem("p-note-scope", JSON.stringify(page));
      setPage(page);
      const checkAccess = async () => {
        const current = await api(`/api/pages/${page.id}`);
        if (disposed) return false;
        if (current.status === 401) {
          opened?.provider.disconnect();
          setLogin(true);
          setError("登入已到期，請重新登入；本機草稿仍保留");
          return false;
        }
        if (current.status >= 500) throw new Error("頁面服務暫時不可用");
        if (!current.ok) {
          opened?.provider.disconnect();
          setError("頁面無法存取，本機內容已隔離");
          setIsolated({ page });
          const failure = (await current.json()) as { page?: PageInfo };
          if (failure.page) setRecovery(failure.page);
          return false;
        }
        const info = (await current.json()) as PageInfo;
        if (
          info.owner_id !== page.owner_id ||
          info.sync_generation !== page.sync_generation
        ) {
          opened?.provider.disconnect();
          setError("頁面世代或權限已變更，本機內容已隔離");
          if (info.owner_id === page.owner_id)
            setIsolated({ page, current: info });
          return false;
        }
        return true;
      };
      opened = await start(
        [page.owner_id, page.id, page.sync_generation],
        checkAccess,
        localOnly,
      );
      if (disposed) {
        opened.provider.destroy();
        await opened.cache.destroy();
        opened.doc.destroy();
        return;
      }
      setSession(opened);
    })().catch((failure) =>
      setError(
        failure instanceof Error &&
          /尚未下載|本機啟動資源/.test(failure.message)
          ? failure.message
          : "載入失敗，請連線後再試",
      ),
    );
    return () => {
      disposed = true;
      opened?.provider.destroy();
      void opened?.cache.destroy();
      opened?.doc.destroy();
    };
  }, [confirm]);
  if (confirm) return <Login confirm />;
  const fork = async () => {
    if (!isolated || !session || forking) return;
    setForking(true);
    try {
      await saveLocal(session.cache);
      const response = await fetch(`/api/pages/${isolated.page.id}/fork`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: (await readLocal(session.cache)).slice(),
      });
      if (response.status === 401) setLogin(true);
      if (!response.ok)
        throw new Error(
          ((await response.json()) as { message: string }).message,
        );
      const copy = (await response.json()) as PageInfo;
      await navigate(copy.id);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "另存失敗，草稿仍保留，請重試",
      );
    } finally {
      setForking(false);
    }
  };
  if (login && !session) return <Login />;
  const content = (
    <>
      {login && (
        <div className="reauth-card">
          <Login embedded />
        </div>
      )}
      {error && (
        <Alert color="red" role="alert" mb="lg">
          {error}
        </Alert>
      )}
      {!isolated && page && versions.length > 0 && (
        <Paper
          component="section"
          aria-label="保留的本機草稿"
          withBorder
          p="md"
          mb="lg"
        >
          <Stack gap="sm">
            <Text fw={600}>有一份較早的本機草稿</Text>
            <Text size="sm" c="dimmed">
              雲端已更新，裝置上的舊內容仍保留供你比較與另存。
            </Text>
            <Group align="end">
              <Select
                label="本機舊版本"
                value={draftVersion}
                onChange={(value) => setDraftVersion(value ?? "")}
                data={versions.map((version, index) => ({
                  value: version.sync_generation,
                  label: "本機草稿 " + (index + 1) + "：" + version.title,
                }))}
              />
              <Button
                variant="light"
                onClick={() => {
                  void saveDraft()
                    .then(() =>
                      location.assign(
                        "/?page=" +
                          encodeURIComponent(page.id) +
                          "&draft=" +
                          encodeURIComponent(draftVersion),
                      ),
                    )
                    .catch(() => setError("本機儲存失敗，草稿仍保留"));
                }}
              >
                檢視舊版本
              </Button>
            </Group>
          </Stack>
        </Paper>
      )}
      {isolated && (
        <Paper withBorder p="lg" mb="lg">
          <Stack>
            <Text fw={600}>本機草稿已隔離</Text>
            <Text size="sm" c="dimmed">
              {isolated.current
                ? "目前版本：" + isolated.current.title
                : "原頁面無法編輯，請還原或另存。"}
              你的草稿還在，請選擇下一步。
            </Text>
            <Group>
              <Button variant="light" onClick={() => setViewDraft(true)}>
                檢視本機草稿
              </Button>
              <Button
                disabled={forking || !session}
                loading={forking}
                onClick={() => {
                  void fork();
                }}
              >
                另存為筆記
              </Button>
              {isolated.current && (
                <Button
                  variant="default"
                  onClick={() => {
                    sessionStorage.setItem(
                      "p-note-load-current",
                      isolated.page.id,
                    );
                    void navigate(isolated.page.id).catch(() =>
                      setError("本機儲存失敗，草稿仍保留"),
                    );
                  }}
                >
                  載入目前版本
                </Button>
              )}
            </Group>
          </Stack>
        </Paper>
      )}
      {recovery && (
        <Button
          mb="lg"
          onClick={() => {
            void api("/api/pages/" + recovery.id + "/restore", {})
              .then(async (response) => {
                if (!response.ok) {
                  setError(
                    ((await response.json()) as { message: string }).message,
                  );
                  return;
                }
                await navigate(recovery.id);
              })
              .catch(() => setError("還原失敗，請重試"));
          }}
        >
          還原此頁
        </Button>
      )}
      {session && page && (!isolated || viewDraft) ? (
        <Editor
          session={session}
          title={(page.kind === "journal" ? "日記 " : "筆記 ") + page.title}
          readOnly={login || !!isolated}
        />
      ) : (
        !error && (
          <Stack align="center" py={80}>
            <Loader size="sm" />
            <Text c="dimmed">正在準備你的寫作空間…</Text>
          </Stack>
        )
      )}
    </>
  );
  if (settings)
    return (
      <BackupSettings
        close={() => setSettings(false)}
        unauthorized={() => {
          setSettings(false);
          setLogin(true);
        }}
      />
    );
  if (page || recovery)
    return (
      <Navigation
        page={(page ?? recovery)!}
        changed={setPage}
        error={setError}
        backups={() => {
          void saveDraft()
            .then(() => setSettings(true))
            .catch((failure) =>
              setError(
                failure instanceof Error ? failure.message : "本機儲存失敗",
              ),
            );
        }}
      >
        {content}
      </Navigation>
    );
  return (
    <div className="app-loading">
      <Brand />
      {content}
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
const render = (node: React.ReactNode) =>
  root.render(
    <MantineProvider theme={theme} forceColorScheme="light">
      {node}
    </MantineProvider>,
  );
if (location.pathname === "/probe") {
  render(
    <main>
      <h1>p-note 技術驗證</h1>
      <p>載入中</p>
    </main>,
  );
  void start()
    .then((session) =>
      render(
        <div className="prototype-page">
          <Editor session={session} />
        </div>,
      ),
    )
    .catch((error) => {
      render(
        <main>
          <h1>p-note 技術驗證</h1>
          <p role="alert">
            {error instanceof Error ? error.message : "載入失敗"}
          </p>
        </main>,
      );
    });
} else render(<App />);
