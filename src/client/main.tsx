import { ApiKeySettings } from './api-key-settings';
import { registerPwa } from './pwa';
import { DatabasePage, NoteProperties } from './databases';
import {
  MantineProvider,
  Alert,
  Button,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  Skeleton,
} from "@mantine/core";
import "@mantine/core/styles.css";
import { theme, resolver, Brand } from "./ui";
import { Login } from "./login";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Editor, start, type Session } from "./editor";
import { Backlinks } from './note-links';
import type { PageInfo } from "../shared/pages";
import { api, navigate, saveDraft, signedOut } from "./api";
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
  const [apiSettings, setApiSettings] = useState(false);
  const [backupNavigationLocked, setBackupNavigationLocked] = useState(false);
  useEffect(() => {
    if (login) {
      setSettings(false);
      setApiSettings(false);
    }
  }, [login]);
  const [route, setRoute] = useState(() => ({
    serial: 0,
    fresh: new URLSearchParams(location.search).get("new") === "1",
    scrollY: undefined as number | undefined,
  }));
  useEffect(() => {
    history.scrollRestoration = "manual";
    const go = (fresh: boolean, scroll?: number) =>
      // 同步卸載舊編輯器，避免換頁途中仍顯示前一頁的狀態。
      flushSync(() => {
        setSession(undefined);
        setSettings(false);
        setApiSettings(false);
        setRoute((current) => ({
          serial: current.serial + 1,
          fresh,
          scrollY: scroll,
        }));
      });
    const pushed = (event: Event) => {
      go((event as CustomEvent<{ fresh: boolean }>).detail.fresh);
      scrollTo(0, 0);
    };
    const popped = (event: PopStateEvent) =>
      go(false, (event.state as { scrollY?: number } | null)?.scrollY ?? 0);
    const failed = (event: Event) =>
      setError((event as CustomEvent<string>).detail);
    addEventListener("p-note:navigate", pushed);
    addEventListener("popstate", popped);
    addEventListener("p-note:error", failed);
    return () => {
      removeEventListener("p-note:navigate", pushed);
      removeEventListener("popstate", popped);
      removeEventListener("p-note:error", failed);
    };
  }, []);
  const [draftDismissed, setDraftDismissed] = useState(false);
  useEffect(() => {
    document.title = page ? page.title + " · p-note" : "p-note";
    if (page)
      setDraftDismissed(
        sessionStorage.getItem("p-note-draft-dismissed") === page.id,
      );
  }, [page?.id, page?.title]);
  useEffect(() => {
    if (confirm) return;
    let disposed = false;
    let opened: Session | undefined;
    setIsolated(undefined);
    setRecovery(undefined);
    setViewDraft(false);
    setForking(false);
    setVersions([]);
    setDraftVersion("");
    setError("");
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
    const open = async (page: PageInfo, localOnly: boolean) => {
      if (page.database_config) {
        rememberPage(page);
        history.replaceState(history.state, "", `/?page=${page.id}`);
        sessionStorage.setItem("p-note-return-url", location.pathname + location.search);
        setPage(page);
        setSession(undefined);
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
        setError("這頁已在其他地方更新，你的本機修改已另外保留");
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
      history.replaceState(history.state, "", `/?page=${page.id}`);
      sessionStorage.setItem(
        "p-note-return-url",
        location.pathname + location.search,
      );
      sessionStorage.setItem("p-note-scope", JSON.stringify(page));
      setPage(page);
      // 停止同步前先寫入本機，保存失敗也不卸載 doc，畫面上的字仍可另存。
      const keep = async (message: string) => {
        opened?.provider.disconnect();
        try {
          if (opened) await saveLocal(opened.cache);
          setError(message);
        } catch {
          setError("本機儲存失敗，草稿仍在畫面上，請先不要關閉頁面");
        }
      };
      const checkAccess = async () => {
        const current = await api(`/api/pages/${page.id}`);
        if (disposed) return false;
        if (current.status === 401) {
          await keep("登入已到期，請重新登入；本機草稿仍保留");
          if (!disposed) setLogin(true);
          return false;
        }
        if (current.status >= 500) throw new Error("頁面服務暫時不可用");
        if (!current.ok) {
          const failure = (await current.json().catch(() => ({}))) as {
            message?: string;
            page?: PageInfo;
          };
          await keep(
            failure.message ?? "這頁目前無法存取，你的本機修改已另外保留",
          );
          if (disposed) return false;
          setIsolated({ page });
          if (failure.page) setRecovery(failure.page);
          return false;
        }
        const info = (await current.json()) as PageInfo;
        if (disposed) return false;
        if (
          info.owner_id !== page.owner_id ||
          info.sync_generation !== page.sync_generation
        ) {
          await keep("這頁已在其他地方更新或無法存取，你的本機修改已另外保留");
          if (disposed) return false;
          setIsolated({
            page,
            current: info.owner_id === page.owner_id ? info : undefined,
          });
          return false;
        }
        try {
          rememberPage(info);
        } catch {
          /* 頁面資訊仍以伺服器回應更新畫面。 */
        }
        setPage(info);
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
    };
    void (async () => {
      const params = new URLSearchParams(location.search);
      const id = params.get("page");
      // 已下載頁面先以本機內容開啟，登入、權限與版本交給 Editor 連線前背景驗證。
      if (
        !params.get("draft") &&
        !sessionStorage.getItem("p-note-load-current") &&
        !signedOut()
      ) {
        let local: PageInfo | undefined;
        try {
          local = cachedPage(id ?? undefined);
        } catch {
          /* 沒有可用索引時走雲端載入。 */
        }
        if (local && !local.database_config) {
          try {
            await open(local, true);
            return;
          } catch {
            if (disposed) return;
          }
        }
      }
      let response: Response | undefined;
      let localOnly = false;
      try {
        response = await api(
          id ? `/api/pages/${encodeURIComponent(id)}` : "/api/today",
        );
      } catch {
        localOnly = true;
      }
      if (disposed) return;
      if (response && response.status >= 500) {
        response = undefined;
        localOnly = true;
      }
      if (response?.status === 401) {
        setLogin(true);
        return;
      }
      if (!response && signedOut()) {
        setLogin(true);
        return;
      }
      if (response && !response.ok) {
        const failure = (await response.json()) as {
          message: string;
          page?: PageInfo;
        };
        if (disposed) return;
        setError(failure.message);
        if (failure.page) {
          setRecovery(failure.page);
          history.replaceState(history.state, "", "/?page=" + failure.page.id);
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
          if (old && !disposed) await isolate(old);
        }
        return;
      }
      const page = response
        ? ((await response.json()) as PageInfo)
        : cachedPage(id ?? undefined);
      if (disposed) return;
      const draft = params.get("draft");
      if (draft) {
        const version = cachedVersions(page).find(
          (item) => item.sync_generation === draft,
        );
        if (!version) throw new Error("本機草稿資訊不完整，請載入目前版本");
        await isolate(version, page);
        return;
      }
      await open(page, localOnly);
    })().catch((failure) => {
      if (disposed) return;
      setError(
        failure instanceof Error &&
          /尚未下載|本機啟動資源/.test(failure.message)
          ? failure.message
          : "載入失敗，請連線後再試",
      );
    });
    return () => {
      disposed = true;
      opened?.provider.destroy();
      void opened?.cache.destroy();
      opened?.doc.destroy();
    };
  }, [confirm, route.serial]);
  useEffect(() => {
    const target = route.scrollY;
    if (!session || target === undefined) return;
    let frame = 0;
    let tries = 0;
    // 正文由 Yjs 繪製後頁面才有足夠高度，需持續嘗試直到到位。
    const restore = () => {
      scrollTo(0, target);
      if (Math.abs(scrollY - target) > 2 && tries++ < 60)
        frame = requestAnimationFrame(restore);
    };
    frame = requestAnimationFrame(restore);
    return () => cancelAnimationFrame(frame);
  }, [session, route.scrollY]);
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
  const rename = async (title: string) => {
    if (!page) return;
    const response = await api(`/api/pages/${page.id}/title`, { title });
    const value = (await response.json().catch(() => ({}))) as PageInfo & {
      message?: string;
    };
    if (response.status === 401) setLogin(true);
    if (!response.ok) throw new Error(value.message ?? "標題保存失敗，請重試");
    setPage(value);
  };
  const content = (
    <>
      {login && (
        <div className="reauth-card">
          <Login embedded />
        </div>
      )}
      {error && (
        <Alert
          className="workspace-notice"
          color="red"
          role="alert"
          mb="lg"
          withCloseButton
          closeButtonLabel="關閉提示"
          onClose={() => setError("")}
        >
          {error}
        </Alert>
      )}
      {!isolated && page && versions.length > 0 && !draftDismissed && (
        <Paper
          className="workspace-notice recovery-panel"
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
              <Button
                variant="subtle"
                color="gray"
                onClick={() => {
                  sessionStorage.setItem("p-note-draft-dismissed", page.id);
                  setDraftDismissed(true);
                }}
              >
                稍後再說
              </Button>
            </Group>
          </Stack>
        </Paper>
      )}
      {isolated && (
        <Paper className="workspace-notice recovery-panel" withBorder p="lg" mb="lg">
          <Stack>
            <Text fw={600}>本機修改已另外保留</Text>
            <Text size="sm" c="dimmed">
              {isolated.current
                ? "目前版本：" + isolated.current.title + "。"
                : "原頁面目前無法編輯，可以還原或另存。"}
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
        <Paper className="workspace-notice recovery-panel" withBorder p="lg" mb="lg">
          <Stack gap="sm" align="flex-start">
            <Text fw={600}>這頁在垃圾桶中</Text>
            <Text size="sm" c="dimmed">
              還原「{recovery.title}」後即可繼續編輯。
            </Text>
            <Button
              onClick={() => {
                void api("/api/pages/" + recovery.id + "/restore", {})
                  .then(async (response) => {
                    if (!response.ok) {
                      setError(
                        ((await response.json()) as { message: string })
                          .message,
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
          </Stack>
        </Paper>
      )}
      {(session || page?.database_config) && page && (!isolated || viewDraft) ? (
        <>{page.database_config && !viewDraft ? <DatabasePage key={page.id + page.sync_generation} page={page} rename={rename} readOnly={login || !!isolated} /> : <>
        <Editor
          key={session!.room}
          session={session!}
          ownerId={page.owner_id}
          title={page.title}
          kind={page.kind}
          rename={rename}
          focusTitle={route.fresh}
          readOnly={login || !!isolated}
          properties={<NoteProperties key={page.id} page={page} readOnly={login || !!isolated} />}
        />
        </>}
        {!login && !isolated && <Backlinks key={page.id + page.sync_generation} id={page.id} />}</>
      ) : (
        !error && (
          <Stack className="loading-document" gap="lg" role="status" aria-label="正在載入文件">
            <Skeleton height={16} width={100} />
            <Skeleton height={42} width="60%" mb="lg" />
            <Skeleton height={14} width="90%" />
            <Skeleton height={14} width="100%" />
            <Skeleton height={14} width="72%" />
            <Text size="xs" c="dimmed">正在載入文件…</Text>
          </Stack>
        )
      )}
    </>
  );
  if (page || recovery)
    return (
      <Navigation
        page={(page ?? recovery)!}
        changed={setPage}
        error={setError}
        settingsView={apiSettings ? "api" : settings ? "backup" : undefined}
        databaseView={!!page?.database_config}
        navigationLocked={backupNavigationLocked}
        settings={() => { if (backupNavigationLocked) return; void saveDraft().then(() => { setSettings(false); setApiSettings(true); }).catch(() => setError("本機儲存失敗，請重試")); }}
        backups={() => {
          if (backupNavigationLocked) return;
          void saveDraft()
            .then(() => { setApiSettings(false); setSettings(true); })
            .catch((failure) =>
              setError(
                failure instanceof Error ? failure.message : "本機儲存失敗",
              ),
            );
        }}
      >
        <div hidden={settings || apiSettings}>{content}</div>
        {settings && <BackupSettings onNavigationLockChange={setBackupNavigationLocked} close={() => setSettings(false)} unauthorized={() => { setSettings(false); setLogin(true); }} />}
        {apiSettings && <ApiKeySettings close={() => setApiSettings(false)} unauthorized={() => { setApiSettings(false); setLogin(true); }} />}
      </Navigation>
    );
  return (
    <div className="app-loading">
      <Brand />
      {content}
    </div>
  );
}

if ('serviceWorker' in navigator && window.isSecureContext) {
  void registerPwa().catch(() => {
    // 首次下載失敗仍允許登入；編輯器會重試並顯示離線資源錯誤。
  });
}
const root = createRoot(document.getElementById("root")!);
const render = (node: React.ReactNode) =>
  root.render(
    <MantineProvider
      theme={theme}
      cssVariablesResolver={resolver}
      forceColorScheme="light"
    >
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
