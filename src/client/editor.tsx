import { registerPwa } from './pwa';
import {
  Alert,
  ActionIcon,
  Button,
  Group,
  Menu,
  Modal,
  Stack,
  Text,
  FileInput,
  Title,
  Tooltip,
  VisuallyHidden,
} from "@mantine/core";
import {
  IconArrowDown,
  IconArrowUp,
  IconBook2,
  IconCloudCheck,
  IconCloudOff,
  IconCloudUpload,
  IconCloudX,
  IconCode,
  IconFileText,
  IconPhoto,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconDots,
} from "@tabler/icons-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { zhTW } from "@blocknote/core/locales";
import { withCollaboration } from "@blocknote/core/yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import YProvider from "y-partyserver/provider";
import * as Y from "yjs";
import { toBase64 } from "lib0/buffer";
import { saveLocal, readLocal } from "./cache";
import { isCurrentReceipt } from "../shared/receipt";
import { roomName } from "../shared/room";
import { IMAGE_TYPES, IMAGE_RULE } from "../shared/image";
import { uploadImage } from "./assets";
import { registerDraft } from "./api";
import { NoteLinkSuggestions, followNoteLink, selectNoteLinkSuggestion } from "./note-links";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "./style.css";
import "./editor.css";

export type Session = {
  doc: Y.Doc;
  cache: IndexeddbPersistence;
  provider: YProvider;
  room: string;
  checkAccess?: () => Promise<boolean>;
};

const cloudStates = {
  saved: { icon: IconCloudCheck, color: "dimmed" },
  syncing: { icon: IconCloudUpload, color: "dimmed" },
  offline: { icon: IconCloudOff, color: "orange.9" },
  failed: { icon: IconCloudX, color: "red.8" },
  local: { icon: IconCloudOff, color: "dimmed" },
};

function cloudState(text: string, readOnly: boolean) {
  if (readOnly) return "local";
  if (text === "雲端已儲存") return "saved";
  if (text === "同步中") return "syncing";
  return text.startsWith("離線") ? "offline" : "failed";
}

function DocumentTitle({
  title,
  rename,
  focus,
  done,
}: {
  title: string;
  rename?: (title: string) => Promise<void>;
  focus: boolean;
  done: () => void;
}) {
  const [value, setValue] = useState(title);
  const [error, setError] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const cancelled = useRef(false);
  const saving = useRef<Promise<void> | undefined>(undefined);
  const current = useRef({ value, title, rename });
  current.current = { value, title, rename };
  useEffect(() => setValue(title), [title]);
  useEffect(() => {
    if (!focus) return;
    input.current?.focus();
    input.current?.select();
  }, [focus]);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = element.scrollHeight + "px";
  }, [value]);
  const commit = async (required = false) => {
    if (saving.current) {
      try { await saving.current; }
      catch (failure) { if (required) throw failure; return; }
    }
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const { value: latest, title: saved, rename: save } = current.current;
    const next = latest.trim();
    if (!save || next === saved) {
      setValue(saved);
      return;
    }
    if (!next || next.length > 200) {
      setValue(saved);
      setError(next ? "標題最多 200 個字元" : "標題不能空白");
      if (required) throw new Error(next ? "標題最多 200 個字元" : "標題不能空白");
      return;
    }
    setError("");
    try {
      saving.current = save(next);
      await saving.current;
      current.current.title = next;
      setValue(next);
    } catch (failure) {
      setValue(saved);
      setError(
        failure instanceof Error ? failure.message : "標題保存失敗，請重試",
      );
      if (required) throw failure;
    } finally {
      saving.current = undefined;
    }
  };
  useEffect(() => registerDraft(() => commit(true), () => !!saving.current || current.current.value.trim() !== current.current.title), []);
  return (
    <>
      <Title order={1} className="document-title">
        <textarea
          ref={input}
          className="title-input"
          aria-label="文件標題"
          rows={1}
          value={value}
          readOnly={!rename}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              done();
            }
            if (event.key === "Escape") {
              cancelled.current = true;
              setValue(title);
              setError("");
              event.currentTarget.blur();
            }
          }}
        />
      </Title>
      {error && (
        <Alert className="editor-error" color="red" role="alert" mt="xs">
          {error}
        </Alert>
      )}
    </>
  );
}

export function Editor({
  session,
  title,
  kind = "note",
  rename,
  focusTitle = false,
  readOnly = false,
  properties,
  ownerId,
}: {
  session: Session;
  title?: string;
  kind?: "note" | "journal";
  rename?: (title: string) => Promise<void>;
  focusTitle?: boolean;
  readOnly?: boolean;
  properties?: ReactNode;
  ownerId?: string;
}) {
  const { doc, cache, provider, room } = session;
  const [image, setImage] = useState<{ file: File; blockId?: string }>();
  const [uploading, setUploading] = useState(false);
  const [imageError, setImageError] = useState("");
  const [copyError, setCopyError] = useState("");
  const [linkError, setLinkError] = useState("");
  const [imageOpen, setImageOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [activeBlock, setActiveBlock] = useState<{
    id: string;
    code: boolean;
  }>();
  const editor = useCreateBlockNote(
    withCollaboration({
      dictionary: zhTW,
      collaboration: {
        fragment: doc.getXmlFragment("body"),
        provider,
        user: { name: title ? "我" : "本機測試", color: "#2383e2" },
      },
      ...(title
        ? {
            uploadFile: async (file: File, blockId?: string) => {
              setImage({ file, blockId });
              setImageOpen(true);
              setUploading(true);
              setImageError("");
              try {
                const url = await uploadImage(file);
                setImage(undefined);
                setImageOpen(false);
                return url;
              } catch (failure) {
                setImageError(
                  failure instanceof Error
                    ? failure.message
                    : "圖片上傳失敗，請重試",
                );
                throw failure;
              } finally {
                setUploading(false);
              }
            },
          }
        : {}),
    }),
  );
  const [local, setLocal] = useState("本機儲存中");
  const [cloud, setCloud] = useState("同步中");
  const [ready, setReady] = useState(false);
  const reconnect = useRef(() => {});
  useEffect(() => {
    let revision = 0;
    let latestId: string | undefined;
    let disposed = false;
    let blocked = false;
    let connecting = false;
    let retryDelay = 1000;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const cloudWaiters = new Set<{ resolve: () => void; reject: (reason: Error) => void }>();
    const failCloud = (message: string) => {
      for (const waiter of cloudWaiters) waiter.reject(new Error(message));
      cloudWaiters.clear();
    };
    const flush = async () => {
      const current = ++revision;
      latestId = undefined;
      setLocal("本機儲存中");
      setCloud(
        !navigator.onLine
          ? "離線，待同步"
          : blocked
            ? "登入或頁面權限已失效"
            : session.checkAccess && !provider.shouldConnect && !connecting
              ? "連線失敗，可重試"
              : "同步中",
      );
      try {
        await saveLocal(cache);
        if (disposed || current !== revision) return;
        setLocal("本機已儲存");
        if (!readOnly && provider.wsconnected && provider.synced) {
          latestId = crypto.randomUUID();
          provider.sendMessage(
            JSON.stringify({
              type: "commit",
              id: latestId,
              update: toBase64(Y.encodeStateAsUpdate(doc)),
            }),
          );
        }
      } catch {
        if (!disposed && current === revision) setLocal("本機儲存失敗");
        failCloud("本機儲存失敗，請重試儲存後再操作版本歷史");
      }
    };
    const update = (_bytes: Uint8Array, origin: unknown) => {
      if (origin !== cache) void flush();
    };
    const synced = (value: boolean) => {
      if (value) {
        retryDelay = 1000;
        void flush();
      }
    };
    const receipt = (message: string) => {
      try {
        const value: unknown = JSON.parse(message);
        if (isCurrentReceipt(latestId, value)) {
          setCloud("雲端已儲存");
          for (const waiter of cloudWaiters) waiter.resolve();
          cloudWaiters.clear();
        }
        else if (
          value &&
          typeof value === "object" &&
          "type" in value &&
          value.type === "error"
        ) {
          setCloud("雲端儲存失敗，可重試");
          failCloud("雲端儲存失敗，請重試儲存後再操作版本歷史");
        }
      } catch {
        setCloud("雲端回應異常，可重試");
        failCloud("雲端回應異常，請重試儲存後再操作版本歷史");
      }
    };
    const offline = () => {
      clearTimeout(retryTimer);
      retryTimer = undefined;
      latestId = undefined;
      provider.disconnect();
      setCloud("離線，待同步");
      failCloud("版本歷史需要連線，請連線後重試");
    };
    const retryLater = () => {
      if (disposed || blocked || !navigator.onLine || retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        online();
      }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30000);
    };
    const online = () => {
      if (readOnly || disposed || connecting || !navigator.onLine) return;
      clearTimeout(retryTimer);
      retryTimer = undefined;
      connecting = true;
      setCloud("同步中");
      void (async () => {
        if (session.checkAccess && !(await session.checkAccess())) {
          blocked = true;
          setCloud("登入或頁面權限已失效");
          failCloud("登入或頁面權限已失效，請重新登入或載入目前頁面");
          return;
        }
        if (disposed) return;
        blocked = false;
        const stale = provider.ws;
        if (stale && stale.readyState >= WebSocket.CLOSING) {
          // 斷網時 close 握手無法完成，舊連線卡在 CLOSING 而 provider 仍視為已連線，connect() 會直接略過。
          // 攔下它遲到的 close，避免 provider 清掉新連線。
          stale.addEventListener(
            "close",
            (event) => event.stopImmediatePropagation(),
            { capture: true },
          );
          provider.ws = null;
          provider.wsconnected = false;
          provider.synced = false;
        }
        await provider.connect();
      })()
        .catch(() => {
          if (!disposed) {
            setCloud("連線失敗，可重試");
            failCloud("同步連線失敗，請重試儲存後再操作版本歷史");
            retryLater();
          }
        })
        .finally(() => {
          connecting = false;
        });
    };
    const closed = (event: CloseEvent) => {
      if (session.checkAccess) {
        failCloud("同步連線中斷，請重試儲存後再操作版本歷史");
        latestId = undefined;
        provider.disconnect();
        setCloud(navigator.onLine ? "連線失敗，可重試" : "離線，待同步");
        if (event.code === 4001 || event.code === 4002) online();
        else retryLater();
      }
    };
    const foreground = () => {
      if (
        document.visibilityState === "visible" &&
        navigator.onLine &&
        session.checkAccess
      )
        online();
    };
    const resized = () =>
      requestAnimationFrame(() => {
        if (!disposed && editor.prosemirrorView.hasFocus())
          editor.prosemirrorView.dispatch(
            editor.prosemirrorView.state.tr.scrollIntoView(),
          );
      });
    doc.on("update", update);
    provider.on("sync", synced);
    provider.on("custom-message", receipt);
    provider.on("connection-close", closed);
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    window.addEventListener("focus", foreground);
    window.addEventListener("resize", resized);
    window.visualViewport?.addEventListener("resize", resized);
    document.addEventListener("visibilitychange", foreground);
    window.probe = {
      editor,
      doc,
      provider,
      cache,
      flush,
      saveCloud: () => {
        if (readOnly) return Promise.reject(new Error("目前頁面僅供檢視，無法儲存版本"));
        if (!navigator.onLine) return Promise.reject(new Error("版本歷史需要連線，請連線後重試"));
        return new Promise<void>((resolve, reject) => {
          const waiter = {
            resolve: () => { clearTimeout(timer); cloudWaiters.delete(waiter); resolve(); },
            reject: (reason: Error) => { clearTimeout(timer); cloudWaiters.delete(waiter); reject(reason); },
          };
          const timer = setTimeout(() => waiter.reject(new Error("雲端尚未確認儲存，請重試儲存後再操作版本歷史")), 15000);
          cloudWaiters.add(waiter);
          if (!provider.wsconnected || !provider.synced) online();
          void flush();
        });
      },
      localState: () => readLocal(cache),
      room,
    };
    reconnect.current = online;
    setReady(true);
    if (navigator.onLine && session.checkAccess && !provider.shouldConnect)
      online();
    void flush();
    return () => {
      disposed = true;
      failCloud("頁面已切換，請在目前頁面重新開啟版本歷史");
      clearTimeout(retryTimer);
      reconnect.current = () => {};
      doc.off("update", update);
      provider.off("sync", synced);
      provider.off("custom-message", receipt);
      provider.off("connection-close", closed);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
      window.removeEventListener("focus", foreground);
      window.removeEventListener("resize", resized);
      window.visualViewport?.removeEventListener("resize", resized);
      document.removeEventListener("visibilitychange", foreground);
      delete window.probe;
    };
  }, [doc, cache, provider, editor, room, readOnly]);

  const currentBlock = () => editor.getTextCursorPosition().block;
  const state = cloudState(cloud, readOnly);
  const CloudIcon = cloudStates[state].icon;
  const retry =
    !readOnly &&
    (state === "failed" || state === "offline" || local.includes("失敗"));
  const [announced, setAnnounced] = useState("");
  useEffect(() => {
    if (local.includes("失敗")) setAnnounced(local);
    else if (state !== "syncing")
      setAnnounced(readOnly ? "僅保留在本機" : cloud);
  }, [cloud, local, state, readOnly]);
  const insert = (type: "paragraph" | "image") => {
    const [block] = editor.insertBlocks(
      [
        type === "image"
          ? {
              type,
              props: {
                url: "/fixtures/pixel.png",
                name: "測試圖片",
                showPreview: true,
              },
            }
          : { type },
      ],
      currentBlock(),
      "after",
    );
    editor.setTextCursorPosition(block, "start");
    editor.focus();
  };
  const upload = async () => {
    if (!image || uploading) return;
    try {
      const anchor = currentBlock();
      const url = await editor.uploadFile!(image.file, image.blockId);
      if (typeof url !== "string") return;
      const block = image.blockId && editor.getBlock(image.blockId);
      if (block)
        editor.updateBlock(block, {
          type: "image",
          props: { url, name: image.file.name, showPreview: true },
        });
      else
        editor.insertBlocks(
          [
            {
              type: "image",
              props: { url, name: image.file.name, showPreview: true },
            },
          ],
          editor.getBlock(anchor.id) ?? editor.document[0],
          "after",
        );
    } catch (failure) {
      setImageOpen(true);
      setImage(image);
      setImageError(
        failure instanceof Error ? failure.message : "圖片插入失敗，請重試",
      );
    }
  };
  const copy = async () => {
    setCopyError("");
    const block = currentBlock();
    if (block.type !== "codeBlock") {
      setCopyError("請先將游標放在程式碼區塊內");
      return;
    }
    const code = block.content
      .map((item) => (item.type === "text" ? item.text : ""))
      .join("");
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      setCopyError("複製失敗，請手動選取程式碼複製");
    }
  };
  return (
    <section className="editor-document">
      <div className="document-heading">
        <div className="document-kind">
          {kind === "journal" ? <IconBook2 size={18} /> : <IconFileText size={18} />}
          <span>{kind === "journal" ? "日記" : "筆記"}</span>
        </div>
        {title === undefined ? (
          <Title order={1} className="document-title">p-note 技術驗證</Title>
        ) : (
          <DocumentTitle
            title={title}
            rename={readOnly ? undefined : rename}
            focus={focusTitle}
            done={() => {
              editor.setTextCursorPosition(editor.document[0], "start");
              editor.focus();
            }}
          />
        )}
      </div>
      {properties && <div className="document-properties">{properties}</div>}
      {!title && (
        <Text size="sm" c="dimmed" className="editor-prototype-note">
          本機原型：圖片為固定 fixture，正式資產服務尚未接入。
        </Text>
      )}
      <div className="editor-utilities">
        <Group className="save-status" gap={10} wrap="wrap">
          <VisuallyHidden data-testid="save-announcer" aria-live="polite">
            {announced}
          </VisuallyHidden>
          <span className="editor-ready" data-testid="ready" data-readonly={readOnly}>
            {ready ? (readOnly ? "僅供檢視" : "可編輯") : "載入中"}
          </span>
          <Text size="xs" c="dimmed" data-testid="local-status" className="editor-local-status">
            {local}
          </Text>
          <Group
            gap={5}
            className="cloud-indicator"
            data-state={state}
            c={cloudStates[state].color}
            wrap="nowrap"
          >
            <CloudIcon size={15} aria-hidden="true" />
            <Text size="xs" data-testid="cloud-status">
              {readOnly ? "僅保留在本機" : cloud}
            </Text>
          </Group>
          {retry && (
            <Button
              variant="subtle"
              color="gray"
              size="compact-sm"
              className="editor-retry"
              leftSection={<IconRefresh size={14} />}
              onClick={() => {
                if (!provider.wsconnected && navigator.onLine)
                  reconnect.current();
                void window.probe?.flush();
              }}
            >
              重試儲存
            </Button>
          )}
        </Group>
        {!readOnly && (
          <Group className="editor-toolbar" gap={2} wrap="nowrap" aria-label="編輯工具">
            <Text size="xs" c="dimmed" className="editor-shortcut">
              輸入 / 新增區塊
            </Text>
            {title && (
              <Tooltip label="插入圖片" withArrow={false}>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  className="editor-tool"
                  aria-label="插入圖片"
                  aria-haspopup="dialog"
                  aria-expanded={imageOpen}
                  onClick={() => setImageOpen(true)}
                >
                  <IconPhoto size={18} />
                </ActionIcon>
              </Tooltip>
            )}
            {!title && (
              <Tooltip label="插入測試圖片" withArrow={false}>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  className="editor-tool"
                  aria-label="插入測試圖片"
                  onClick={() => insert("image")}
                >
                  <IconPhoto size={18} />
                </ActionIcon>
              </Tooltip>
            )}
            <Menu
              opened={toolsOpen}
              onChange={(opened) => {
                if (opened) {
                  const block = currentBlock();
                  setActiveBlock({
                    id: block.id,
                    code: block.type === "codeBlock",
                  });
                }
                setToolsOpen(opened);
              }}
              onExitTransitionEnd={() => editor.focus()}
              returnFocus={false}
              position="bottom-end"
              width={224}
              // 手機鍵盤彈出時可視高度很小，選單需翻轉並限高捲動，否則項目會落在畫面外。
              middlewares={{ flip: true, shift: true, size: true }}
            >
              <Menu.Target>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  className="editor-tool"
                  aria-label="區塊操作"
                  title="區塊操作"
                >
                  <IconDots size={19} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown className="editor-block-menu block-menu" aria-label="區塊操作">
                <Menu.Label>目前區塊</Menu.Label>
                <Menu.Item
                  leftSection={<IconPlus size={16} />}
                  onClick={() => insert("paragraph")}
                >
                  插入段落
                </Menu.Item>
                <Menu.Item
                  closeMenuOnClick={false}
                  leftSection={<IconArrowUp size={16} />}
                  onClick={() => editor.moveBlocksUp()}
                >
                  上移區塊
                </Menu.Item>
                <Menu.Item
                  closeMenuOnClick={false}
                  leftSection={<IconArrowDown size={16} />}
                  onClick={() => editor.moveBlocksDown()}
                >
                  下移區塊
                </Menu.Item>
                {title !== undefined && (
                  <>
                    <Menu.Item
                      leftSection={<IconCode size={16} />}
                      disabled={!activeBlock?.code}
                      onClick={() => {
                        void copy();
                      }}
                    >
                      複製程式碼
                    </Menu.Item>
                    {!activeBlock?.code && (
                      <Text size="xs" c="dimmed" px="sm" pb={6}>
                        請先將游標放在程式碼區塊內
                      </Text>
                    )}
                  </>
                )}
                <Menu.Divider />
                <Menu.Item
                  color="red"
                  style={{ color: "var(--mantine-color-red-9)" }}
                  leftSection={<IconTrash size={16} />}
                  onClick={() => editor.removeBlocks([currentBlock()])}
                >
                  刪除區塊
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
            {!title && (
              <Tooltip label="複製程式碼" withArrow={false}>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  className="editor-tool"
                  aria-label="複製程式碼"
                  onClick={() => {
                    void copy();
                  }}
                >
                  <IconCode size={18} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
        )}
      </div>
      {copyError && (
        <Alert className="editor-error" color="red" role="alert" my="sm">
          {copyError}
        </Alert>
      )}
      {linkError && (
        <Alert className="editor-error" color="red" role="alert" my="sm">
          {linkError}
        </Alert>
      )}
      {toolsOpen && activeBlock && (
        <style>{`.editor-document .writing-surface .bn-block-outer[data-id="${CSS.escape(activeBlock.id)}"] > .bn-block > .bn-block-content { outline: 2px solid var(--mantine-color-blue-2); outline-offset: 2px; border-radius: 4px; }`}</style>
      )}
      <div
        className="writing-surface"
        data-active-block={toolsOpen ? activeBlock?.id : undefined}
        onClickCapture={(event) => followNoteLink(event, setLinkError)}
        onKeyDownCapture={(event) => selectNoteLinkSuggestion(event, editor)}
      >
        <BlockNoteView className="editor-blocknote" editor={editor} theme="light" editable={!readOnly}>
          {ownerId && !readOnly && <NoteLinkSuggestions editor={editor} owner={ownerId} />}
        </BlockNoteView>
      </div>
      {title && !readOnly && (
        <Modal
          classNames={{ content: "editor-image-dialog", header: "editor-image-header", body: "editor-image-body" }}
          opened={imageOpen}
          onClose={() => {
            if (!uploading) setImageOpen(false);
          }}
          title="圖片上傳"
          size="sm"
          centered
          closeButtonProps={{
            "aria-label": "關閉圖片上傳",
            disabled: uploading,
          }}
        >
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              選擇要加入筆記的照片或截圖。
            </Text>
            <FileInput
              id="image-file"
              label="圖片檔案"
              placeholder="選擇圖片檔案"
              value={image?.file ?? null}
              size="sm"
              leftSection={<IconPhoto size={17} />}
              fileInputProps={{ "aria-label": "圖片原檔" }}
              accept={IMAGE_TYPES.join(",")}
              disabled={uploading}
              onChange={(file) => {
                setImage(file ? { file } : undefined);
                setImageError("");
              }}
            />
            <Text size="xs" c="dimmed" lh={1.65}>
              {IMAGE_RULE}，保留原圖不壓縮。
            </Text>
            {imageError && (
              <Alert className="editor-error" color="red" role="alert" title="圖片尚未插入">
                {imageError}
              </Alert>
            )}
            <Group justify="flex-end" className="editor-image-actions">
              <Button
                variant="default"
                disabled={uploading}
                onClick={() => setImageOpen(false)}
              >
                取消
              </Button>
              <Button
                disabled={!image || uploading}
                loading={uploading}
                onClick={() => {
                  void upload();
                }}
              >
                {uploading ? "圖片上傳中" : imageError ? "重試上傳" : "上傳圖片"}
              </Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </section>
  );
}

let booting: Promise<void> | undefined;

function boot() {
  booting ??= (async () => {
    await registerPwa();
    if (navigator.onLine) {
      const registration = await navigator.serviceWorker.ready;
      const urls = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name);
      await new Promise<void>((resolve, reject) => {
        const channel = new MessageChannel();
        const timer = setTimeout(() => {
          channel.port1.close();
          reject(new Error("本機啟動資源下載失敗，請重試"));
        }, 10000);
        channel.port1.onmessage = (event) => {
          clearTimeout(timer);
          channel.port1.close();
          if (event.data?.ok) resolve();
          else reject(new Error("本機啟動資源下載失敗，請重試"));
        };
        registration.active!.postMessage({ type: "cache-resources", urls }, [
          channel.port2,
        ]);
      });
    }
  })().catch((failure) => {
    booting = undefined;
    throw failure;
  });
  return booting;
}

export async function start(
  scope?: string[],
  checkAccess?: Session["checkAccess"],
  localOnly = false,
  isolated = false,
): Promise<Session> {
  if (
    !checkAccess &&
    !["127.0.0.1", "localhost", "[::1]"].includes(location.hostname)
  )
    throw new Error("原型只限本機");
  await boot();
  const params = new URLSearchParams(location.search);
  scope ??= ["owner", "page", "generation"].map(
    (name, index) => params.get(name) ?? ["owner", "default", "g1"][index],
  );
  if (scope.some((value) => !/^[\w-]{1,80}$/.test(value)))
    throw new Error("無效頁面識別");
  const room = await roomName(scope[0], scope[1], scope[2]);
  const doc = new Y.Doc();
  const cache = new IndexeddbPersistence(`p-note:${room}`, doc);
  await cache._db;
  await cache.whenSynced;
  const downloaded = await cache.get("downloaded");
  // shortcut: y-indexeddb 9.0.12 不回報寫入完成／錯誤；升級前重驗此掛鉤與 saveLocal。
  doc.off("update", cache._storeUpdate);
  if ((!navigator.onLine || localOnly || isolated) && !downloaded)
    throw new Error("此頁尚未下載，請連線後再開啟");
  const provider = new YProvider(
    location.host,
    room,
    doc,
    {
      party: checkAccess ? "sync" : "rooms",
      connect: false,
      disableBc: true,
      protocol: location.protocol === "https:" ? "wss" : "ws",
      ...(checkAccess
        ? {
            params: { page: scope[1], generation: scope[2] },
          }
        : {}),
    },
  );
  // 已下載的正式頁面先以本機內容開啟，同步交給 Editor 在背景連線。
  if (navigator.onLine && !localOnly && !isolated && !(downloaded && checkAccess)) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        provider.disconnect();
        reject(new Error("同步服務未連線"));
      }, 10000);
      provider.on("sync", (value: boolean) => {
        if (value) {
          clearTimeout(timer);
          resolve();
        }
      });
      void provider.connect().catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
    }).catch((failure) => {
      if (!checkAccess || !downloaded) throw failure;
    });
  }
  return { doc, cache, provider, room, checkAccess };
}
