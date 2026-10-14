import {
  Alert,
  Badge,
  Button,
  Group,
  Menu,
  Modal,
  Paper,
  Stack,
  Text,
  FileInput,
  Title,
  VisuallyHidden,
} from "@mantine/core";
import {
  IconArrowDown,
  IconArrowUp,
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
  IconChevronDown,
} from "@tabler/icons-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "./style.css";

export type Session = {
  doc: Y.Doc;
  cache: IndexeddbPersistence;
  provider: YProvider;
  room: string;
  checkAccess?: () => Promise<boolean>;
};

const cloudStates = {
  saved: { icon: IconCloudCheck, color: "teal.8" },
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
  const commit = async () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const next = value.trim();
    if (!rename || next === title) {
      setValue(title);
      return;
    }
    if (!next || next.length > 200) {
      setValue(title);
      setError(next ? "標題最多 200 個字元" : "標題不能空白");
      return;
    }
    setError("");
    try {
      await rename(next);
    } catch (failure) {
      setValue(title);
      setError(
        failure instanceof Error ? failure.message : "標題保存失敗，請重試",
      );
    }
  };
  return (
    <>
      <Title order={1} mt="xs">
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
        <Alert color="red" role="alert" mt="xs">
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
}: {
  session: Session;
  title?: string;
  kind?: "note" | "journal";
  rename?: (title: string) => Promise<void>;
  focusTitle?: boolean;
  readOnly?: boolean;
}) {
  const { doc, cache, provider, room } = session;
  const [image, setImage] = useState<{ file: File; blockId?: string }>();
  const [uploading, setUploading] = useState(false);
  const [imageError, setImageError] = useState("");
  const [copyError, setCopyError] = useState("");
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
        user: { name: title ? "我" : "本機測試", color: "#0f766e" },
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
    const flush = async () => {
      const current = ++revision;
      latestId = undefined;
      setLocal("本機儲存中");
      setCloud(
        !navigator.onLine
          ? "離線，待同步"
          : blocked
            ? "登入或頁面權限已失效"
            : session.checkAccess && !provider.shouldConnect
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
        if (isCurrentReceipt(latestId, value)) setCloud("雲端已儲存");
        else if (
          value &&
          typeof value === "object" &&
          "type" in value &&
          value.type === "error"
        )
          setCloud("雲端儲存失敗，可重試");
      } catch {
        setCloud("雲端回應異常，可重試");
      }
    };
    const offline = () => {
      clearTimeout(retryTimer);
      retryTimer = undefined;
      latestId = undefined;
      provider.disconnect();
      setCloud("離線，待同步");
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
            retryLater();
          }
        })
        .finally(() => {
          connecting = false;
        });
    };
    const closed = (event: CloseEvent) => {
      if (session.checkAccess) {
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
      localState: () => readLocal(cache),
      room,
    };
    reconnect.current = online;
    setReady(true);
    void flush();
    if (navigator.onLine && session.checkAccess && !provider.shouldConnect)
      online();
    return () => {
      disposed = true;
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
        {title === undefined ? (
          <Title order={1}>p-note 技術驗證</Title>
        ) : (
          <>
            <Badge
              variant="light"
              color={kind === "journal" ? "teal" : "gray"}
              size="sm"
            >
              {kind === "journal" ? "日記" : "筆記"}
            </Badge>
            <DocumentTitle
              title={title}
              rename={readOnly ? undefined : rename}
              focus={focusTitle}
              done={() => {
                editor.setTextCursorPosition(editor.document[0], "start");
                editor.focus();
              }}
            />
          </>
        )}
      </div>
      {!title && (
        <Text size="sm">
          本機原型：圖片為固定 fixture，正式資產服務尚未接入。
        </Text>
      )}
      <Group className="save-status" gap="sm" wrap="wrap">
        <VisuallyHidden data-testid="save-announcer" aria-live="polite">
          {announced}
        </VisuallyHidden>
        <Badge color={readOnly ? "gray" : "teal"} variant="dot">
          <span data-testid="ready">
            {ready ? (readOnly ? "僅供檢視" : "可編輯") : "載入中"}
          </span>
        </Badge>
        <Text size="xs" c="dimmed" data-testid="local-status">
          {local}
        </Text>
        <Group
          gap={5}
          className="cloud-indicator"
          data-state={state}
          c={cloudStates[state].color}
        >
          <CloudIcon size={15} />
          <Text size="xs" data-testid="cloud-status">
            {readOnly ? "僅保留在本機" : cloud}
          </Text>
        </Group>
        {retry && (
          <Button
            variant="subtle"
            size="compact-sm"
            h={32}
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
        <Group className="editor-toolbar" justify="space-between" wrap="nowrap">
          <Group gap={6} wrap="nowrap">
            {title && (
              <Button
                variant="subtle"
                color="dark"
                leftSection={<IconPhoto size={18} />}
                aria-haspopup="dialog"
                aria-expanded={imageOpen}
                onClick={() => setImageOpen(true)}
              >
                插入圖片
              </Button>
            )}
            {!title && (
              <Button variant="subtle" onClick={() => insert("image")}>
                插入測試圖片
              </Button>
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
              position="bottom-start"
              width={240}
              // 手機鍵盤彈出時可視高度很小，選單需翻轉並限高捲動，否則項目會落在畫面外。
              middlewares={{ flip: true, shift: true, size: true }}
            >
              <Menu.Target>
                <Button
                  variant="subtle"
                  color="dark"
                  leftSection={<IconFileText size={17} />}
                  rightSection={<IconChevronDown size={14} />}
                >
                  區塊操作
                </Button>
              </Menu.Target>
              <Menu.Dropdown className="block-menu">
                <Menu.Item
                  leftSection={<IconPlus size={17} />}
                  onClick={() => insert("paragraph")}
                >
                  插入段落
                </Menu.Item>
                <Menu.Item
                  closeMenuOnClick={false}
                  leftSection={<IconArrowUp size={17} />}
                  onClick={() => editor.moveBlocksUp()}
                >
                  上移區塊
                </Menu.Item>
                <Menu.Item
                  closeMenuOnClick={false}
                  leftSection={<IconArrowDown size={17} />}
                  onClick={() => editor.moveBlocksDown()}
                >
                  下移區塊
                </Menu.Item>
                {title !== undefined && (
                  <>
                    <Menu.Item
                      leftSection={<IconCode size={17} />}
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
                  leftSection={<IconTrash size={17} />}
                  onClick={() => editor.removeBlocks([currentBlock()])}
                >
                  刪除區塊
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
            {!title && (
              <Button
                variant="subtle"
                onClick={() => {
                  void copy();
                }}
              >
                複製程式碼
              </Button>
            )}
          </Group>
          <Text size="xs" c="dimmed" className="editor-shortcut">
            輸入 / 新增區塊
          </Text>
        </Group>
      )}
      {copyError && (
        <Alert color="red" role="alert" my="md">
          {copyError}
        </Alert>
      )}
      {toolsOpen && activeBlock && (
        <style>{`.writing-surface .bn-block-outer[data-id="${CSS.escape(activeBlock.id)}"] > .bn-block > .bn-block-content { outline: 2px solid var(--mantine-color-teal-3); outline-offset: 2px; border-radius: 6px; }`}</style>
      )}
      <div
        className="writing-surface"
        data-active-block={toolsOpen ? activeBlock?.id : undefined}
      >
        <BlockNoteView editor={editor} theme="light" editable={!readOnly} />
      </div>
      {title && !readOnly && (
        <Modal
          opened={imageOpen}
          onClose={() => {
            if (!uploading) setImageOpen(false);
          }}
          title="圖片上傳"
          closeButtonProps={{
            "aria-label": "關閉圖片上傳",
            disabled: uploading,
          }}
        >
          <Stack gap="lg">
            <Text size="sm" c="dimmed">
              插入照片或截圖，讓筆記更完整。
            </Text>
            <FileInput
              id="image-file"
              label="圖片檔案"
              placeholder="選擇圖片檔案"
              value={image?.file ?? null}
              size="md"
              styles={{ input: { minHeight: 44 } }}
              leftSection={<IconPhoto size={18} />}
              fileInputProps={{ "aria-label": "圖片原檔" }}
              accept={IMAGE_TYPES.join(",")}
              disabled={uploading}
              onChange={(file) => {
                setImage(file ? { file } : undefined);
                setImageError("");
              }}
            />
            <Paper p="md" bg="gray.0" radius="md">
              <Text size="xs" c="dimmed" lh={1.8}>
                {IMAGE_RULE}，保留原圖不壓縮。
              </Text>
            </Paper>
            {imageError && (
              <Alert color="red" role="alert" title="圖片尚未插入">
                {imageError}
              </Alert>
            )}
            <Button
              disabled={!image || uploading}
              loading={uploading}
              leftSection={<IconPhoto size={18} />}
              onClick={() => {
                void upload();
              }}
            >
              {uploading ? "圖片上傳中" : imageError ? "重試上傳" : "上傳圖片"}
            </Button>
          </Stack>
        </Modal>
      )}
    </section>
  );
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
  await navigator.serviceWorker.register("/sw.js");
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
    checkAccess ? location.host : "127.0.0.1:8787",
    room,
    doc,
    {
      party: checkAccess ? "sync" : "rooms",
      connect: false,
      disableBc: true,
      ...(checkAccess
        ? {
            protocol: location.protocol === "https:" ? "wss" : "ws",
            params: { page: scope[1], generation: scope[2] },
          }
        : {}),
    },
  );
  if (navigator.onLine && !localOnly && !isolated) {
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
