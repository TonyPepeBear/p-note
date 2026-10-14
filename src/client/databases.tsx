import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Anchor,
  Button,
  Checkbox,
  Group,
  Modal,
  MultiSelect,
  NativeSelect,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconArrowDown,
  IconArrowUp,
  IconArrowsSort,
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconDatabase,
  IconExternalLink,
  IconFileText,
  IconFilter,
  IconHash,
  IconLayoutList,
  IconLink,
  IconListDetails,
  IconPlus,
  IconSearch,
  IconSettings,
  IconTable,
  IconTrash,
  IconTypography,
  IconX,
} from "@tabler/icons-react";
import "./databases.css";
import { api, navigate, registerDraft, hasMetadataDrafts } from "./api";
import type { PageInfo, PageRow } from "../shared/pages";
import {
  BUILTIN,
  PROPERTY_TYPES,
  OPERATOR_NAMES,
  displayValue,
  initialView,
  operators,
  readConfig,
  readValues,
  selectRows,
  type DatabaseConfig,
  type DatabaseData,
  type DatabaseView,
  type Property,
  type PropertyValue,
} from "../shared/databases";


function PropertyIcon({ type, size = 15 }: { type: string; size?: number }) {
  const Icon = type === "number" ? IconHash
    : type === "date" ? IconCalendar
    : type === "checkbox" ? IconCheck
    : type === "url" ? IconLink
    : type === "select" || type === "multiSelect" ? IconListDetails
    : IconTypography;
  return <Icon size={size} stroke={1.6} aria-hidden="true" />;
}

async function request(path: string, body?: object) {
  const response = await api(path, body);
  const value = await response.json();
  if (!response.ok) throw new Error(value.message ?? "資料庫操作失敗，請重試");
  return value;
}
function useOnline() {
  const [online, set] = useState(navigator.onLine);
  useEffect(() => {
    const changed = () => set(navigator.onLine);
    addEventListener("online", changed);
    addEventListener("offline", changed);
    return () => {
      removeEventListener("online", changed);
      removeEventListener("offline", changed);
    };
  }, []);
  return online;
}
function useDatabase(id?: string) {
  const [data, setData] = useState<DatabaseData>();
  const [error, setError] = useState("");
  const refresh = async () => {
    if (!id || !navigator.onLine) return;
    const value: DatabaseData = await request("/api/databases/" + id);
    setData((previous) =>
      JSON.stringify(previous) === JSON.stringify(value) ? previous : value,
    );
    setError("");
  };
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!id || !navigator.onLine) return;
      try {
        const v: DatabaseData = await request("/api/databases/" + id);
        if (active && !hasMetadataDrafts()) {
          setData((p) => (JSON.stringify(p) === JSON.stringify(v) ? p : v));
          setError("");
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    setData(undefined);
    setError("");
    void load();
    const timer = setInterval(() => void load(), 3000);
    addEventListener("focus", load);
    addEventListener("online", load);
    return () => {
      active = false;
      clearInterval(timer);
      removeEventListener("focus", load);
      removeEventListener("online", load);
    };
  }, [id]);
  return { data, error, refresh };
}
function FieldInput({
  row,
  property,
  status,
  disabled = false,
}: {
  row: PageRow;
  property: Property;
  status: (text: string) => void;
  disabled?: boolean;
}) {
  const value =
    property.id === "title"
      ? row.title
      : (readValues(row.property_values)[property.id] ?? null);
  const [draft, setDraft] = useState<PropertyValue>(value);
  const dirty = useRef(false);
  const editGeneration = useRef(row.sync_generation);
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const online = useOnline();
  const pending = useRef<Promise<void> | undefined>(undefined);
  useEffect(() => {
    if (!dirty.current) setDraft(value);
  }, [JSON.stringify(value)]);
  const save = async (next = draft) => {
    if (pending.current) await pending.current;
    if (!dirty.current) return;
    if (!navigator.onLine || disabled) throw new Error("欄位修改需要連線");
    setBusy(true);
    status("儲存中");
    setFailure("");
    const work = request("/api/pages/" + row.id + "/properties", {
      property: property.id,
      value: next,
      generation: editGeneration.current,
    })
      .then(() => {
        dirty.current = false;
        status("已儲存");
      })
      .catch((e: Error) => {
        setFailure(e.message);
        status(e.message);
        throw e;
      })
      .finally(() => {
        setBusy(false);
        pending.current = undefined;
      });
    pending.current = work;
    await work;
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(
    () =>
      registerDraft(
        () => saveRef.current(),
        () => dirty.current,
      ),
    [],
  );
  const change = (v: PropertyValue, immediately = false) => {
    setDraft(v);
    if (!dirty.current) editGeneration.current = row.sync_generation;
    dirty.current = true;
    status("尚未儲存");
    if (immediately) void save(v).catch(() => {});
  };
  const input = {
    "aria-label": property.name,
    disabled: disabled || !online || busy,
  };
  return (
    <div className="property-input">
      {property.type === "checkbox" ? (
        <Checkbox
          {...input}
          checked={draft === true}
          onChange={(e) => change(e.currentTarget.checked, true)}
        />
      ) : property.type === "select" ? (
        <NativeSelect
          {...input}
          value={typeof draft === "string" ? draft : ""}
          data={[
            { value: "", label: "未設定" },
            ...property.options.map((o) => ({ value: o.id, label: o.name })),
          ]}
          onChange={(e) => change(e.target.value, true)}
        />
      ) : property.type === "multiSelect" ? (
        <MultiSelect
          {...input}
          value={Array.isArray(draft) ? draft : []}
          data={property.options.map((o) => ({ value: o.id, label: o.name }))}
          onChange={(v) => change(v, true)}
          searchable
          clearable
        />
      ) : (
        <TextInput
          {...input}
          type={
            property.type === "date"
              ? "date"
              : property.type === "number"
                ? "number"
                : property.type === "url"
                  ? "url"
                  : "text"
          }
          value={
            typeof draft === "string" || typeof draft === "number" ? draft : ""
          }
          onChange={(e) =>
            change(
              property.type === "number"
                ? e.target.value === ""
                  ? null
                  : Number(e.target.value)
                : e.target.value,
            )
          }
          onBlur={() => void save().catch(() => {})}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save().catch(() => {});
            }
          }}
        />
      )}
      {failure && (
        <Button
          size="compact-xs"
          color="red"
          variant="subtle"
          onClick={() => void save().catch(() => {})}
          disabled={!online || busy}
        >
          重試保存
        </Button>
      )}
      {failure && (
        <Button
          size="compact-xs"
          variant="subtle"
          disabled={busy}
          onClick={() => {
            dirty.current = false;
            setDraft(value);
            setFailure("");
            status("已放棄欄位修改");
          }}
        >
          放棄欄位修改
        </Button>
      )}
    </div>
  );
}

export function NoteProperties({
  page,
  readOnly = false,
}: {
  page: PageInfo;
  readOnly?: boolean;
}) {
  const parent = page.ancestors?.at(-1);
  const { data, error } = useDatabase(
    parent?.database_config ? parent.id : undefined,
  );
  const online = useOnline();
  const [status, setStatus] = useState("");
  if (!parent?.database_config) return null;
  const config = data?.config ?? readConfig(parent.database_config);
  const row = data?.rows.find((r) => r.id === page.id) ?? page;
  return (
    <section className="note-properties" aria-label="筆記屬性">
      <Group className="note-properties-header" justify="space-between">
        <Anchor
          href={"/?page=" + parent.id}
          onClick={(e) => {
            e.preventDefault();
            void navigate(parent.id).catch((e) => setStatus(e.message));
          }}
        >
          <IconDatabase size={14} aria-hidden="true" />
          返回 {parent.title}
        </Anchor>
        <Text size="xs" c="dimmed" role="status" data-testid="property-status">
          {status}
        </Text>
      </Group>
      {!online && (
        <Text size="sm" c="orange">
          欄位修改需要連線
        </Text>
      )}
      {error && (
        <Text size="sm" c="red">
          {error}
        </Text>
      )}
      <div className="properties-grid">
        {config.properties.map((p) => (
          <div className="note-property-row" key={p.id}>
            <div className="note-property-label">
              <PropertyIcon type={p.type} />
              <span>{p.name}</span>
            </div>
            <FieldInput
              row={row}
              property={p}
              status={setStatus}
              disabled={readOnly}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

export function DatabasePage({
  page,
  rename,
  readOnly = false,
}: {
  page: PageInfo;
  rename: (title: string) => Promise<void>;
  readOnly?: boolean;
}) {
  const { data, error, refresh } = useDatabase(page.id);
  const online = useOnline();
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(page.title);
  const [manager, setManager] = useState(false);
  const [properties, setProperties] = useState<Property[]>([]);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<Property["type"]>("text");
  const [remove, setRemove] = useState<string>();
  const [editingView, setEditingView] = useState<DatabaseView>();
  const viewSection = useRef("");
  const base = useRef<string>("");
  useEffect(() => setTitle(page.title), [page.title]);
  const config = data?.config ?? readConfig(page.database_config!);
  const view = config.views.find((v) => v.id === selected) ?? config.views[0];
  const rows = selectRows(data?.rows ?? [], view, query);
  const fields = [...BUILTIN, ...config.properties];
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setFailure("");
    try {
      await action();
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const saveConfig = async (next: DatabaseConfig) => {
    await request("/api/databases/" + page.id + "/config", {
      previous: base.current,
      generation: page.sync_generation,
      config: next,
    });
    await refresh();
    base.current = JSON.stringify(next);
  };
  const editProperties = () => {
    base.current = data?.page.database_config ?? page.database_config!;
    setProperties(structuredClone(config.properties));
    setManager(true);
    setFailure("");
  };
  const editView = (v: DatabaseView, section = "") => {
    viewSection.current = section;
    base.current = data?.page.database_config ?? page.database_config!;
    setEditingView(structuredClone(v));
    setFailure("");
  };
  const updateView = (value: Partial<DatabaseView>) =>
    setEditingView((v) => v && { ...v, ...value });
  const move = <T,>(list: T[], index: number, delta: number): T[] => {
    const next = [...list];
    const target = index + delta;
    if (target >= 0 && target < list.length)
      [next[index], next[target]] = [next[target], next[index]];
    return next;
  };
  const disabled = !online || readOnly || busy;
  return (
    <section
      className="database-page"
      data-testid={data ? "database-ready" : "database-loading"}
    >
      <header className="database-heading">
        <IconDatabase className="database-page-icon" size={38} stroke={1.4} aria-hidden="true" />
        <TextInput
          aria-label="資料庫標題"
          className="database-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (title.trim() && title !== page.title)
              void run(() => rename(title));
          }}
          disabled={disabled}
        />
      </header>
      <div className="database-toolbar">
        <div className="database-view-navigation">
          <div className="database-view-tabs" role="tablist" aria-label="資料庫檢視">
            {config.views.map((item) => (
              <button
                key={item.id}
                type="button"
                className="database-view-tab"
                role="tab"
                id={"database-view-" + item.id}
                aria-selected={view.id === item.id}
                aria-controls="database-view-panel"
                tabIndex={view.id === item.id ? 0 : -1}
                onClick={() => setSelected(item.id)}
                onKeyDown={(event) => {
                  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const index = config.views.findIndex((v) => v.id === item.id);
                  const next = event.key === "Home" ? 0
                    : event.key === "End" ? config.views.length - 1
                    : (index + (event.key === "ArrowRight" ? 1 : -1) + config.views.length) % config.views.length;
                  setSelected(config.views[next].id);
                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
                }}
              >
                {item.layout === "table" ? <IconTable size={15} aria-hidden="true" /> : <IconLayoutList size={15} aria-hidden="true" />}
                <span>{item.name}</span>
              </button>
            ))}
          </div>
          <NativeSelect
            aria-label="目前檢視"
            title="切換檢視"
            className="database-view-picker"
            value={view.id}
            data={config.views.map((v) => ({ value: v.id, label: v.name }))}
            rightSection={<IconChevronDown size={14} aria-hidden="true" />}
            onChange={(e) => setSelected(e.target.value)}
          />
          <Button
            variant="subtle"
            className="database-icon-button"
            aria-label="新增檢視"
            title="新增檢視"
            onClick={() => editView(initialView(crypto.randomUUID(), "新檢視"))}
            disabled={disabled}
          >
            <IconPlus size={16} aria-hidden="true" />
          </Button>
        </div>
        <div className="database-toolbar-actions" role="toolbar" aria-label="資料庫工具列">
          <Button
            variant="subtle"
            className={view.filters.length ? "database-active-tool" : undefined}
            leftSection={<IconFilter size={15} aria-hidden="true" />}
            onClick={() => editView(view, "database-filter-settings")}
            disabled={disabled}
          >
            篩選{view.filters.length ? ` · ${view.filters.length}` : ""}
          </Button>
          <Button
            variant="subtle"
            className={view.sorts.length ? "database-active-tool" : undefined}
            leftSection={<IconArrowsSort size={15} aria-hidden="true" />}
            onClick={() => editView(view, "database-sort-settings")}
            disabled={disabled}
          >
            排序{view.sorts.length ? ` · ${view.sorts.length}` : ""}
          </Button>
          <Button
            variant="subtle"
            className="database-icon-button"
            aria-label="管理欄位"
            title="管理欄位"
            onClick={editProperties}
            disabled={disabled}
          >
            <IconListDetails size={17} aria-hidden="true" />
          </Button>
          <Button
            variant="subtle"
            className="database-icon-button"
            aria-label="檢視設定"
            title="檢視設定"
            onClick={() => editView(view)}
            disabled={disabled}
          >
            <IconSettings size={16} aria-hidden="true" />
          </Button>
          <TextInput
            aria-label="搜尋資料庫筆記"
            placeholder="搜尋…"
            className="database-search"
            leftSection={<IconSearch size={15} aria-hidden="true" />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button
            leftSection={<IconPlus size={15} aria-hidden="true" />}
            disabled={disabled}
            onClick={() =>
              void run(async () => {
                const row: PageRow = await request("/api/pages", {
                  title: "未命名",
                  parent_id: page.id,
                });
                await navigate(row.id, true);
              })
            }
          >
            新增筆記
          </Button>
        </div>
      </div>
      {!online && (
        <Alert color="orange" mb="sm">
          欄位修改需要連線
        </Alert>
      )}
      {(failure || error) && (
        <Alert color="red" role="alert" mb="sm">
          {failure || error}
          <Button variant="subtle" onClick={() => void run(refresh)}>
            重新載入
          </Button>
        </Alert>
      )}
      <div className="database-scroll" id="database-view-panel" role="tabpanel" aria-labelledby={"database-view-" + view.id} data-testid="database-rows">
        {view.layout === "table" ? (
          <Table className="database-table" withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                {view.columns.map((id) => (
                  <Table.Th key={id}>
                    <span className="database-column-heading">
                      <PropertyIcon type={fields.find((p) => p.id === id)?.type ?? "text"} />
                      {fields.find((p) => p.id === id)?.name}
                    </span>
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row) => (
                <Table.Tr key={row.id} data-testid="database-row">
                  {view.columns.map((id) => (
                    <Table.Td key={id}>
                      {id === "title" ? (
                        <div className="database-title-cell">
                          <IconFileText className="database-row-icon" size={16} stroke={1.6} aria-hidden="true" />
                          <FieldInput
                            row={row}
                            property={{
                              id: "title",
                              name: "名稱",
                              type: "text",
                              options: [],
                            }}
                            status={setStatus}
                            disabled={readOnly}
                          />
                          <Anchor
                            className="database-open-row"
                            aria-label={"開啟 " + row.title}
                            title={"開啟 " + row.title}
                            href={"/?page=" + row.id}
                            onClick={(e) => {
                              e.preventDefault();
                              void run(() => navigate(row.id));
                            }}
                          >
                            <IconExternalLink size={14} aria-hidden="true" />
                            <span className="database-visually-hidden">開啟 {row.title}</span>
                          </Anchor>
                        </div>
                      ) : id === "created_at" || id === "updated_at" ? (
                        <Text size="xs">
                          {new Date(row[id]).toLocaleString("zh-TW", {
                            timeZone: "Asia/Taipei",
                          })}
                        </Text>
                      ) : (
                        <FieldInput
                          row={row}
                          property={config.properties.find((p) => p.id === id)!}
                          status={setStatus}
                          disabled={readOnly}
                        />
                      )}
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        ) : (
          <div className="database-list">
            {rows.map((row) => (
              <div className="database-list-row" key={row.id} data-testid="database-row">
                <Anchor
                  className="database-list-title"
                  href={"/?page=" + row.id}
                  onClick={(e) => {
                    e.preventDefault();
                    void run(() => navigate(row.id));
                  }}
                >
                  <IconFileText size={17} stroke={1.6} aria-hidden="true" />
                  <span>{row.title}</span>
                </Anchor>
                <div className="database-list-values">
                {view.columns
                  .filter((id) => id !== "title")
                  .map((id) => (
                    <Text key={id} size="sm" c="dimmed" title={fields.find((p) => p.id === id)?.name}>
                      {id === "created_at" || id === "updated_at"
                        ? new Date(row[id]).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })
                        : displayValue(
                            readValues(row.property_values)[id] ?? null,
                            config.properties.find((p) => p.id === id),
                          )}
                    </Text>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {!rows.length && (
        <div className="database-empty">
          <IconFileText size={26} stroke={1.3} aria-hidden="true" />
          <Text size="sm">{!data ? "正在載入筆記…" : data.rows.length ? "沒有符合的筆記" : "從第一篇筆記開始"}</Text>
          <Text size="xs" c="dimmed">{!data ? "" : data.rows.length ? "試著調整搜尋或篩選條件。" : "點選「新增筆記」，或將既有筆記移入這個資料庫。"}</Text>
        </div>
      )}
      <div className="database-footer">
        <Text size="xs" c="dimmed">{rows.length} 篇筆記</Text>
        <Text size="xs" c="dimmed" role="status" data-testid="property-status">{status}</Text>
      </div>
      <Modal
        opened={manager}
        onClose={() => setManager(false)}
        title="管理欄位"
        size="lg"
        classNames={{ content: "database-dialog", header: "database-dialog-header", body: "database-dialog-body" }}
        closeButtonProps={{ "aria-label": "關閉欄位管理" }}
      >
        <Stack gap="md">
          {failure && <Alert color="red" role="alert">{failure}</Alert>}
          <Text size="sm" c="dimmed">
            自訂筆記的屬性與順序。已有內容的欄位如需變更類型，請新增另一個欄位。
          </Text>
          <div className="database-field-list">
          {!properties.length && <Text className="database-settings-empty" size="sm" c="dimmed">尚未新增屬性。新增日期、標籤或其他欄位，讓筆記更好整理。</Text>}
          {properties.map((p, index) => (
            <div className="database-field-editor" key={p.id}>
              <div className="database-field-editor-main">
                <PropertyIcon type={p.type} />
                <TextInput
                  aria-label={"欄位名稱 " + (index + 1)}
                  value={p.name}
                  onChange={(e) =>
                    setProperties((items) =>
                      items.map((x) =>
                        x.id === p.id ? { ...x, name: e.target.value } : x,
                      ),
                    )
                  }
                />
                <NativeSelect
                  aria-label={"欄位類型 " + (index + 1)}
                  value={p.type}
                  data={Object.entries(PROPERTY_TYPES).map(
                    ([value, label]) => ({ value, label }),
                  )}
                  onChange={(e) =>
                    setProperties((items) =>
                      items.map((x) =>
                        x.id === p.id
                          ? {
                              ...x,
                              type: e.target.value as Property["type"],
                              options: [],
                            }
                          : x,
                      ),
                    )
                  }
                />
                <div className="database-field-actions">
                  <Button variant="subtle" className="database-icon-button" aria-label={"上移 " + p.name} title="上移欄位" disabled={index === 0} onClick={() => setProperties(move(properties, index, -1))}>
                    <IconArrowUp size={14} aria-hidden="true" />
                  </Button>
                  <Button variant="subtle" className="database-icon-button" aria-label={"下移 " + p.name} title="下移欄位" disabled={index === properties.length - 1} onClick={() => setProperties(move(properties, index, 1))}>
                    <IconArrowDown size={14} aria-hidden="true" />
                  </Button>
                  <Button color="red" variant="subtle" className="database-icon-button" aria-label={"刪除 " + p.name} title={"刪除 " + p.name} onClick={() => setRemove(p.id)}>
                    <IconTrash size={14} aria-hidden="true" />
                  </Button>
                </div>
              </div>
                {["select", "multiSelect"].includes(p.type) && (
                  <div className="database-options-editor">
                    <Text size="xs" c="dimmed" className="database-section-caption">選項</Text>
                    {p.options.map((o, i) => (
                      <Group className="database-option-row" key={o.id} gap="xs">
                        <TextInput
                          aria-label={"選項 " + p.name + " " + (i + 1)}
                          value={o.name}
                          onChange={(e) =>
                            setProperties((items) =>
                              items.map((x) =>
                                x.id === p.id
                                  ? {
                                      ...x,
                                      options: x.options.map((option) =>
                                        option.id === o.id
                                          ? { ...option, name: e.target.value }
                                          : option,
                                      ),
                                    }
                                  : x,
                              ),
                            )
                          }
                        />
                        <Button
                          variant="subtle"
                          color="red"
                          className="database-icon-button"
                          aria-label={"移除選項 " + o.name}
                          title={"移除選項 " + o.name}
                          onClick={() =>
                            setProperties((items) =>
                              items.map((x) =>
                                x.id === p.id
                                  ? {
                                      ...x,
                                      options: x.options.filter(
                                        (option) => option.id !== o.id,
                                      ),
                                    }
                                  : x,
                              ),
                            )
                          }
                        >
                          <IconX size={14} aria-hidden="true" />
                        </Button>
                      </Group>
                    ))}
                    <TextInput
                      aria-label={"新增選項 " + p.name}
                      placeholder="＋ 新增選項，按 Enter 確認"
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" || !e.currentTarget.value.trim())
                          return;
                        e.preventDefault();
                        const name = e.currentTarget.value.trim();
                        setProperties((items) =>
                          items.map((x) =>
                            x.id === p.id
                              ? {
                                  ...x,
                                  options: [
                                    ...x.options,
                                    { id: crypto.randomUUID(), name },
                                  ],
                                }
                              : x,
                          ),
                        );
                        e.currentTarget.value = "";
                      }}
                    />
                  </div>
                )}
            </div>
          ))}
          </div>
          <form className="database-new-field"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const p: Property = {
                  id: crypto.randomUUID(),
                  name: newName.trim(),
                  type: newType,
                  options: [],
                };
                const next = [...properties, p];
                await saveConfig({
                  properties: next,
                  views: config.views.map((v) => ({
                    ...v,
                    columns: [...v.columns, p.id],
                  })),
                });
                setProperties(next);
                setNewName("");
              });
            }}
          >
            <div className="database-new-field-row">
              <TextInput
                label="新欄位名稱"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
                maxLength={100}
              />
              <NativeSelect
                label="新欄位類型"
                value={newType}
                data={Object.entries(PROPERTY_TYPES).map(([value, label]) => ({
                  value,
                  label,
                }))}
                onChange={(e) => setNewType(e.target.value as Property["type"])}
              />
              <Button type="submit" variant="default" leftSection={<IconPlus size={14} aria-hidden="true" />} disabled={disabled}>
                新增欄位
              </Button>
            </div>
          </form>
          <div className="database-dialog-footer">
          <Text size="xs" c="dimmed">刪除欄位後，原值仍保留於筆記與備份。</Text>
          <Button
            disabled={disabled}
            onClick={() =>
              void run(async () => {
                const order = properties.map((p) => p.id);
                const next = {
                  properties,
                  views: config.views.map((v) => ({
                    ...v,
                    columns: [
                      ...v.columns.filter((id) =>
                        BUILTIN.some((p) => p.id === id),
                      ),
                      ...order.filter((id) => v.columns.includes(id)),
                    ],
                  })),
                };
                await saveConfig(next);
                setManager(false);
              })
            }
          >
            儲存欄位
          </Button>
          </div>
        </Stack>
      </Modal>
      <Modal
        opened={!!remove}
        onClose={() => setRemove(undefined)}
        title="刪除欄位"
        classNames={{ content: "database-dialog", header: "database-dialog-header", body: "database-dialog-body" }}
      >
        <Stack>
          <Text>
            刪除「{properties.find((p) => p.id === remove)?.name}
            」？原值保留於備份及筆記資料，不再顯示。
          </Text>
          <Group className="database-dialog-footer">
            <Button variant="default" onClick={() => setRemove(undefined)}>
              取消刪除
            </Button>
            <Button
              color="red"
              disabled={disabled}
              onClick={() =>
                void run(async () => {
                  const next = properties.filter((p) => p.id !== remove);
                  await saveConfig({
                    properties: next,
                    views: config.views.map((v) => ({
                      ...v,
                      columns: v.columns.filter((id) => id !== remove),
                      filters: v.filters.filter((f) => f.property !== remove),
                      sorts: v.sorts.filter((s) => s.property !== remove),
                    })),
                  });
                  setProperties(next);
                  setRemove(undefined);
                })
              }
            >
              確認刪除欄位
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        opened={!!editingView}
        onClose={() => setEditingView(undefined)}
        title="檢視設定"
        size="lg"
        transitionProps={{ onEntered: () => {
          if (viewSection.current) document.getElementById(viewSection.current)?.scrollIntoView({ block: "start" });
        } }}
        classNames={{ content: "database-dialog", header: "database-dialog-header", body: "database-dialog-body" }}
      >
        {editingView && (
          <Stack gap="lg">
            {failure && <Alert color="red" role="alert">{failure}</Alert>}
            <section className="database-settings-section">
              <div className="database-view-details">
            <TextInput
              label="檢視名稱"
              value={editingView.name}
              onChange={(e) => updateView({ name: e.target.value })}
              maxLength={100}
            />
            <NativeSelect
              label="檢視形式"
              value={editingView.layout}
              data={[
                { value: "table", label: "表格" },
                { value: "list", label: "清單" },
              ]}
              onChange={(e) =>
                updateView({ layout: e.target.value as "table" | "list" })
              }
            />
              </div>
            </section>
            <section className="database-settings-section">
            <Text className="database-section-title" fw={500}>顯示欄位與順序</Text>
            {editingView.columns.map((id, i) => (
              <Group className="database-visible-field" key={id} gap="xs">
                <PropertyIcon type={fields.find((p) => p.id === id)?.type ?? "text"} size={14} />
                <Text className="database-visible-field-name" size="sm">{fields.find((p) => p.id === id)?.name}</Text>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  className="database-icon-button"
                  disabled={i === 0}
                  aria-label={"上移檢視欄位 " + id}
                  onClick={() =>
                    updateView({ columns: move(editingView.columns, i, -1) })
                  }
                >
                  <IconArrowUp size={14} aria-hidden="true" />
                </Button>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  className="database-icon-button"
                  disabled={i === editingView.columns.length - 1}
                  aria-label={"下移檢視欄位 " + id}
                  onClick={() =>
                    updateView({ columns: move(editingView.columns, i, 1) })
                  }
                >
                  <IconArrowDown size={14} aria-hidden="true" />
                </Button>
                {id !== "title" && (
                  <Button
                    variant="subtle"
                    size="compact-xs"
                    onClick={() =>
                      updateView({
                        columns: editingView.columns.filter((x) => x !== id),
                      })
                    }
                  >
                    隱藏 {fields.find((p) => p.id === id)?.name}
                  </Button>
                )}
              </Group>
            ))}
            {fields
              .filter((p) => !editingView.columns.includes(p.id))
              .map((p) => (
                <Button
                  variant="subtle"
                  key={p.id}
                  onClick={() =>
                    updateView({ columns: [...editingView.columns, p.id] })
                  }
                >
                  顯示 {p.name}
                </Button>
              ))}
            </section>
            <section className="database-settings-section" id="database-filter-settings">
            <Text className="database-section-title" fw={500}><IconFilter size={15} aria-hidden="true" /> 篩選</Text>
            <NativeSelect
              className="database-filter-mode"
              label="篩選組合"
              value={editingView.filterMode}
              data={[
                { value: "and", label: "符合全部條件" },
                { value: "or", label: "符合任一條件" },
              ]}
              onChange={(e) =>
                updateView({ filterMode: e.target.value as "and" | "or" })
              }
            />
            {editingView.filters.map((f, i) => (
              <div className="database-filter-row" key={i}>
                  <NativeSelect
                    label={"篩選欄位 " + (i + 1)}
                    value={f.property}
                    data={fields.map((p) => ({ value: p.id, label: p.name }))}
                    onChange={(e) =>
                      updateView({
                        filters: editingView.filters.map((x, n) =>
                          n === i
                            ? { ...x, property: e.target.value, operator: "eq" }
                            : x,
                        ),
                      })
                    }
                  />
                  <NativeSelect
                    label={"篩選條件 " + (i + 1)}
                    value={f.operator}
                    data={operators(
                      fields.find((p) => p.id === f.property)!.type,
                    ).map((value) => ({ value, label: OPERATOR_NAMES[value] }))}
                    onChange={(e) =>
                      updateView({
                        filters: editingView.filters.map((x, n) =>
                          n === i ? { ...x, operator: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  {["select", "multiSelect", "checkbox"].includes(
                    fields.find((p) => p.id === f.property)!.type,
                  ) ? (
                    <NativeSelect
                      label={"篩選值 " + (i + 1)}
                      value={f.value}
                      disabled={["empty", "notEmpty"].includes(f.operator)}
                      data={[
                        { value: "", label: "請選擇" },
                        ...(config.properties.find((p) => p.id === f.property)
                          ?.type === "checkbox"
                          ? [
                              { value: "true", label: "是" },
                              { value: "false", label: "否" },
                            ]
                          : (config.properties
                              .find((p) => p.id === f.property)
                              ?.options.map((o) => ({
                                value: o.id,
                                label: o.name,
                              })) ?? [])),
                      ]}
                      onChange={(e) =>
                        updateView({
                          filters: editingView.filters.map((x, n) =>
                            n === i ? { ...x, value: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  ) : (
                    <TextInput
                      label={"篩選值 " + (i + 1)}
                      value={f.value}
                      disabled={["empty", "notEmpty"].includes(f.operator)}
                      onChange={(e) =>
                        updateView({
                          filters: editingView.filters.map((x, n) =>
                            n === i ? { ...x, value: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  )}
                  <Button
                    variant="subtle"
                    onClick={() =>
                      updateView({
                        filters: editingView.filters.filter((_, n) => n !== i),
                      })
                    }
                  >
                    移除篩選 {i + 1}
                  </Button>
              </div>
            ))}
            {!editingView.filters.length && <Text className="database-settings-empty" size="sm" c="dimmed">顯示全部筆記。新增條件可縮小範圍。</Text>}
            <Button
              variant="subtle"
              leftSection={<IconPlus size={14} aria-hidden="true" />}
              onClick={() =>
                updateView({
                  filters: [
                    ...editingView.filters,
                    { property: "title", operator: "contains", value: "" },
                  ],
                })
              }
            >
              新增篩選
            </Button>
            </section>
            <section className="database-settings-section" id="database-sort-settings">
            <Text className="database-section-title" fw={500}><IconArrowsSort size={15} aria-hidden="true" /> 排序</Text>
            {editingView.sorts.map((s, i) => (
              <Group className="database-sort-row" key={i} align="end" gap="xs">
                <NativeSelect
                  label={"排序欄位 " + (i + 1)}
                  value={s.property}
                  data={fields.map((p) => ({ value: p.id, label: p.name }))}
                  onChange={(e) =>
                    updateView({
                      sorts: editingView.sorts.map((x, n) =>
                        n === i ? { ...x, property: e.target.value } : x,
                      ),
                    })
                  }
                />
                <NativeSelect
                  label={"排序方向 " + (i + 1)}
                  value={s.direction}
                  data={[
                    { value: "asc", label: "升序" },
                    { value: "desc", label: "降序" },
                  ]}
                  onChange={(e) =>
                    updateView({
                      sorts: editingView.sorts.map((x, n) =>
                        n === i
                          ? {
                              ...x,
                              direction: e.target.value as "asc" | "desc",
                            }
                          : x,
                      ),
                    })
                  }
                />
                <Button
                  variant="subtle"
                  onClick={() =>
                    updateView({
                      sorts: editingView.sorts.filter((_, n) => n !== i),
                    })
                  }
                >
                  移除排序 {i + 1}
                </Button>
              </Group>
            ))}
            {!editingView.sorts.length && <Text className="database-settings-empty" size="sm" c="dimmed">依預設順序顯示筆記。</Text>}
            <Button
              variant="subtle"
              leftSection={<IconPlus size={14} aria-hidden="true" />}
              onClick={() =>
                updateView({
                  sorts: [
                    ...editingView.sorts,
                    { property: "title", direction: "asc" },
                  ],
                })
              }
            >
              新增排序
            </Button>
            </section>
            <Group className="database-dialog-footer">
              <Button
                disabled={disabled}
                onClick={() =>
                  void run(async () => {
                    const next = config.views.some(
                      (v) => v.id === editingView.id,
                    )
                      ? config.views.map((v) =>
                          v.id === editingView.id ? editingView : v,
                        )
                      : [...config.views, editingView];
                    await saveConfig({ ...config, views: next });
                    setSelected(editingView.id);
                    setEditingView(undefined);
                  })
                }
              >
                儲存檢視
              </Button>
              {config.views.some((v) => v.id === editingView.id) && (
                <Button
                  variant="subtle"
                  color="red"
                  disabled={disabled || config.views.length === 1}
                  onClick={() =>
                    void run(async () => {
                      await saveConfig({
                        ...config,
                        views: config.views.filter(
                          (v) => v.id !== editingView.id,
                        ),
                      });
                      setEditingView(undefined);
                    })
                  }
                >
                  刪除檢視
                </Button>
              )}
            </Group>
          </Stack>
        )}
      </Modal>
    </section>
  );
}
