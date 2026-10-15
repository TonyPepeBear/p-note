import { Alert, Badge, Button, Group, Loader, Modal, Paper, Stack, Text, Title } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconHistory, IconPlus, IconRefresh } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { createReactBlockSpec, useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { zhTW } from "@blocknote/core/locales";
import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { syncedBlockConfig } from "../shared/block-schema";
import type { PageInfo } from "../shared/pages";
import type { PageVersion, PageHistory as VersionList, PageVersionPreview as Preview } from "../shared/history";
import type { Session } from "./editor";
import { api, saveDraft } from "./api";
import { saveLocal } from "./cache";
import "./page-history.css";

type Restore = { request_id: string; version_id: string };
export type PendingHistoryRestore = { restore: Restore & { page_id: string }; page: PageInfo | null };
type Operation = "load" | "preview" | "create" | "restore";

const reasons = {
  auto: "自動保存",
  manual: "手動建立",
  before_restore: "還原前保存",
  restore: "還原版本",
};

const date = (value: number) => new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
}).format(value);

// 歷史版本只保存引用節點，使用獨立的靜態呈現器，避免預覽載入目前同步內容或開啟同步連線。
const versionPreviewSchema = BlockNoteSchema.create({ blockSpecs: {
  ...defaultBlockSpecs,
  syncedBlock: createReactBlockSpec(syncedBlockConfig, {
    render: ({ block }) => <Paper withBorder p="sm" radius="sm" my={6} contentEditable={false}
      data-testid="history-synced-block" data-synced-block-id={block.props.syncedBlockId}
      aria-label="歷史同步區塊引用" style={{ borderColor: "var(--mantine-color-blue-4)", width: "100%" }}>
      <Text size="sm" fw={600}>同步區塊引用</Text>
      <Text size="xs" c="dimmed" style={{ overflowWrap: "anywhere" }}>ID：{block.props.syncedBlockId}</Text>
      <Text size="xs" c="dimmed" mt={4}>此版本只保存引用，不包含同步內容的歷史快照。預覽不會載入即時內容。</Text>
    </Paper>,
  })(),
} });

function VersionPreview({ preview }: { preview: Preview }) {
  const editor = useCreateBlockNote({
    schema: versionPreviewSchema,
    dictionary: zhTW,
    initialContent: preview.blocks.length ? preview.blocks as typeof versionPreviewSchema.PartialBlock[] : [{ type: "paragraph" }],
  });
  return <section className="page-history-preview" aria-label="版本預覽">
    <div className="page-history-preview-heading">
      <Group gap="xs"><Badge variant="light" color="gray">{reasons[preview.version.reason]}</Badge><Text size="xs" c="dimmed">{date(preview.version.created_at)}</Text></Group>
      <Title order={2}>{preview.version.title}</Title>
      <Text size="xs" c="dimmed">此預覽僅供檢視</Text>
    </div>
    <div className="page-history-preview-body" onClickCapture={(event) => {
      // 預覽中的連結不切換文件，避免還原確認期間離開目前頁面。
      if ((event.target as Element).closest("a")) event.preventDefault();
    }}>
      <BlockNoteView editor={editor} theme="light" editable={false} formattingToolbar={false} sideMenu={false} slashMenu={false} />
    </div>
  </section>;
}

export function HistoryRestoreRecovery({ pending, restored, unauthorized }: {
  pending: PendingHistoryRestore;
  restored: (pageId: string) => void;
  unauthorized: () => void;
}) {
  const [online, setOnline] = useState(navigator.onLine);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const working = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    const connection = () => setOnline(navigator.onLine);
    const leaving = (event: BeforeUnloadEvent) => {
      if (working.current) { event.preventDefault(); event.returnValue = ""; }
    };
    addEventListener("online", connection);
    addEventListener("offline", connection);
    addEventListener("beforeunload", leaving);
    return () => {
      active.current = false;
      removeEventListener("online", connection);
      removeEventListener("offline", connection);
      removeEventListener("beforeunload", leaving);
    };
  }, []);
  const resume = async () => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      if (!navigator.onLine) throw new Error("繼續版本還原需要連線，請連線後重試");
      // 伺服器已保護還原前版本；此處只保存舊世代的本機正文，不向被鎖住的頁面寫入 metadata。
      if (window.probe) await saveLocal(window.probe.cache);
      const operation = pending.restore;
      const response = await api(`/api/pages/${encodeURIComponent(operation.page_id)}/history/${encodeURIComponent(operation.version_id)}/restore`, { request_id: operation.request_id });
      const value = await response.json().catch(() => ({})) as { message?: string };
      if (!active.current) return;
      if (response.status === 401) { unauthorized(); return; }
      if (!response.ok) throw new Error(value.message ?? "還原尚未完成，請重試原版本");
      sessionStorage.setItem("p-note-load-current", operation.page_id);
      restored(operation.page_id);
    } catch (failure) {
      if (active.current) setError(failure instanceof Error ? failure.message : "還原尚未完成，請重試原版本");
    } finally {
      working.current = false;
      if (active.current) setBusy(false);
    }
  };
  return <Paper component="section" aria-label="繼續版本還原" className="workspace-notice recovery-panel" withBorder p="lg" mb="lg">
    <Stack gap="sm" align="flex-start">
      <Text fw={600}>有一項尚未完成的版本還原</Text>
      <Text size="sm" c="dimmed">{pending.page ? `「${pending.page.title}」的版本還原` : "版本還原"}因連線中斷而尚未完成。請繼續原操作，完成後會重新開啟頁面。裝置上的舊草稿仍會另外保留。</Text>
      {!online && <Alert color="orange" role="status">繼續版本還原需要連線，請連線後重試。</Alert>}
      {error && <Alert color="red" role="alert">{error}</Alert>}
      <Button disabled={!online || busy} loading={busy} onClick={() => void resume()}>繼續還原</Button>
    </Stack>
  </Paper>;
}

export function PageHistory({ page, session, close, restored }: {
  page: PageInfo;
  session: Session;
  close: () => void;
  restored: () => void;
}) {
  const mobile = useMediaQuery("(max-width: 47.99em)");
  const [online, setOnline] = useState(navigator.onLine);
  const [versions, setVersions] = useState<PageVersion[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview>();
  const [selected, setSelected] = useState("");
  const [pending, setPending] = useState<Operation | null>("load");
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [interrupted, setInterrupted] = useState<Restore | null>(null);
  const [retry, setRetry] = useState<(() => Promise<void>) | null>(null);
  const active = useRef(true);
  const working = useRef(false);
  const restoring = useRef<Restore | null>(null);
  const controller = useRef(new AbortController());
  const base = `/api/pages/${encodeURIComponent(page.id)}/history`;

  useEffect(() => {
    const connection = () => setOnline(navigator.onLine);
    const leaving = (event: BeforeUnloadEvent) => {
      if (working.current) { event.preventDefault(); event.returnValue = ""; }
    };
    addEventListener("online", connection);
    addEventListener("offline", connection);
    addEventListener("beforeunload", leaving);
    return () => {
      active.current = false;
      controller.current.abort();
      removeEventListener("online", connection);
      removeEventListener("offline", connection);
      removeEventListener("beforeunload", leaving);
    };
  }, []);

  const request = async <T,>(path: string, body?: object): Promise<T> => {
    if (!navigator.onLine) throw new Error("版本歷史需要連線，請連線後重試");
    const response = await api(path, body, controller.current.signal);
    const value = await response.json().catch(() => ({})) as T & { message?: string };
    if (!response.ok) throw new Error(value.message ?? "版本歷史暫時無法使用，請重試");
    return value;
  };
  const persist = async () => {
    await saveDraft();
    if (!navigator.onLine) throw new Error("版本歷史需要連線，請連線後重試");
    const probe = window.probe;
    if (!probe || probe.doc !== session.doc) throw new Error("文件尚未就緒，請稍後重試");
    await probe.saveCloud();
    if (active.current) setSaveError("");
  };
  const loadPreview = async (id: string) => {
    const value = await request<Preview>(`${base}/${encodeURIComponent(id)}`);
    if (!active.current) return;
    setSelected(id);
    setPreview(value);
  };
  const load = async (next?: string | null, preferred?: string) => {
    const value = await request<VersionList>(base + (next ? `?cursor=${encodeURIComponent(next)}` : ""));
    if (!active.current) return;
    setVersions((items) => next ? [...items, ...value.versions.filter((version) => !items.some((item) => item.id === version.id))] : value.versions);
    setCursor(value.next_cursor);
    setInterrupted(value.restore);
    if (value.restore) restoring.current = value.restore;
    const id = value.restore?.version_id ?? preferred ?? (!next ? value.versions[0]?.id : undefined);
    if (id) await loadPreview(id);
  };
  const run = async (operation: Operation, work: () => Promise<void>) => {
    if (working.current || !active.current) return;
    working.current = true;
    setPending(operation);
    setError("");
    setRetry(null);
    try { await work(); }
    catch (failure) {
      if (!active.current) return;
      setError(failure instanceof Error ? failure.message : "版本歷史操作失敗，請重試");
      setRetry(() => () => run(operation, work));
    } finally {
      working.current = false;
      if (active.current) setPending(null);
    }
  };
  const initialize = async () => {
    try { await persist(); }
    catch (failure) {
      if (active.current) setSaveError(failure instanceof Error ? failure.message : "目前內容尚未確認存入雲端，請重試儲存");
    }
    await load();
  };
  useEffect(() => { void run("load", initialize); }, []);

  const create = async () => {
    await persist();
    const version = await request<PageVersion>(base, {});
    if (!active.current) return;
    setNotice("已建立版本");
    await load(undefined, version.id);
  };
  const restore = async () => {
    if (!preview) return;
    // 相同請求識別可在網路中斷後重試，不重複覆寫已完成還原的頁面。
    const operation = restoring.current ?? { request_id: crypto.randomUUID(), version_id: preview.version.id };
    if (!restoring.current) await persist();
    restoring.current = operation;
    setInterrupted(operation);
    await request(`${base}/${encodeURIComponent(operation.version_id)}/restore`, { request_id: operation.request_id });
    if (!active.current) return;
    sessionStorage.setItem("p-note-load-current", page.id);
    restored();
  };
  const locked = !!pending;
  return <Modal opened onClose={() => { if (!working.current) close(); }} title="版本歷史"
    fullScreen={mobile} size="min(1100px, calc(100vw - 32px))" padding={mobile ? "md" : "lg"}
    classNames={{ content: "page-history-dialog", body: "page-history-dialog-body" }}
    closeOnClickOutside={!locked} closeOnEscape={!locked}
    closeButtonProps={{ "aria-label": "關閉版本歷史", disabled: locked }}>
    <Stack gap="md" className="page-history-content">
      <Group justify="space-between" align="flex-start" gap="sm">
        <div><Text fw={600} lineClamp={2}>{page.title}</Text><Text size="xs" c="dimmed">版本包含標題與正文，可預覽或還原。</Text></div>
        <Button leftSection={<IconPlus size={16} />} variant="light" disabled={locked || !online || !!interrupted}
          loading={pending === "create"} onClick={() => { setConfirm(false); void run("create", create); }}>建立版本</Button>
      </Group>
      {!online && <Alert color="orange" role="status">版本歷史需要連線。請連線後重新載入，裝置上的草稿仍保留。</Alert>}
      {saveError && !interrupted && <Alert color="orange" role="alert">
        <Text size="sm">{saveError}</Text>
        <Button variant="subtle" size="compact-sm" mt="xs" disabled={locked || !online} onClick={() => void run("load", initialize)}>重試儲存與載入</Button>
      </Alert>}
      {interrupted && <Alert color="orange" role="status">有一項尚未完成的還原，請繼續還原以完成同步。還原前的內容已由伺服器保護。</Alert>}
      {error && <Alert color="red" role="alert"><Text size="sm">{error}</Text>
        {retry && <Button variant="subtle" size="compact-sm" mt="xs" disabled={locked || !online} leftSection={<IconRefresh size={14} />}
          onClick={() => void retry()}>{confirm || interrupted ? "重試還原" : "重試載入"}</Button>}
      </Alert>}
      {notice && <Text size="sm" c="dimmed" role="status">{notice}</Text>}
      {pending === "load" && !versions.length && <Group role="status" gap="xs"><Loader size="sm" /><Text size="sm">正在儲存目前內容並載入版本…</Text></Group>}
      <div className="page-history-layout" aria-busy={locked}>
        <section className="page-history-list" aria-label="歷史版本">
          <Text size="xs" c="dimmed" mb="sm">由新到舊排列・時間為臺北時間</Text>
          {!versions.length && !locked && !error && <div className="page-history-empty"><IconHistory size={28} /><Text size="sm">尚無歷史版本</Text><Text size="xs" c="dimmed">建立版本，保留目前內容。</Text></div>}
          {versions.map((version) => <button key={version.id} type="button" className="page-history-version"
            data-version-id={version.id}
            aria-pressed={selected === version.id} disabled={locked || !online || !!interrupted}
            onClick={() => { setConfirm(false); setNotice(""); void run("preview", () => loadPreview(version.id)); }}>
            <span className="page-history-version-title">{version.title}</span>
            <span className="page-history-version-date">{date(version.created_at)}</span>
            <span className="page-history-version-reason">{reasons[version.reason]}</span>
          </button>)}
          {cursor && <Button fullWidth mt="sm" variant="subtle" disabled={locked || !online || !!interrupted} onClick={() => void run("load", () => load(cursor))}>載入更多</Button>}
        </section>
        <div className="page-history-preview-shell">
          {preview ? <VersionPreview key={preview.version.id} preview={preview} /> : <div className="page-history-empty"><Text size="sm">選擇版本以預覽標題與正文</Text></div>}
        </div>
      </div>
      {confirm && preview && <Paper withBorder p="md" role="region" aria-label="還原版本確認" className="page-history-confirm">
        <Stack gap="sm"><Text fw={600}>還原「{preview.version.title}」？</Text>
          <Text size="sm">還原前會先保存目前標題與正文為「還原前保存」版本，再將頁面替換為所選版本。其他裝置的本機草稿仍會另外保留。</Text>
          <Group justify="flex-end"><Button variant="default" disabled={locked} onClick={() => setConfirm(false)}>取消</Button>
            <Button disabled={locked || !online} loading={pending === "restore"} onClick={() => void run("restore", restore)}>確認還原版本</Button></Group>
        </Stack>
      </Paper>}
      <Group justify="space-between" className="page-history-actions">
        <Button variant="default" disabled={locked} onClick={close}>關閉</Button>
        {interrupted ? <Button disabled={locked || !online || !preview} loading={pending === "restore"} onClick={() => void run("restore", restore)}>繼續還原</Button>
          : <Button disabled={locked || !online || !preview} onClick={() => { setConfirm(true); setError(""); }}>還原此版本</Button>}
      </Group>
    </Stack>
  </Modal>;
}
