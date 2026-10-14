import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  MultiSelect,
  NativeSelect,
  Paper,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconDatabase, IconPlus } from "@tabler/icons-react";
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
    <Paper className="note-properties" p="md" withBorder>
      <Group justify="space-between">
        <Anchor
          href={"/?page=" + parent.id}
          onClick={(e) => {
            e.preventDefault();
            void navigate(parent.id).catch((e) => setStatus(e.message));
          }}
        >
          返回 {parent.title}
        </Anchor>
        <Text size="xs" c="dimmed" data-testid="property-status">
          {status || "欄位以連線保存"}
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
          <div key={p.id}>
            <Text size="sm" c="dimmed" mb={4}>
              {p.name}
            </Text>
            <FieldInput
              row={row}
              property={p}
              status={setStatus}
              disabled={readOnly}
            />
          </div>
        ))}
      </div>
    </Paper>
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
  const editView = (v: DatabaseView) => {
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
      <Group gap="sm">
        <IconDatabase size={24} />
        <Badge variant="light">資料庫</Badge>
      </Group>
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
      <Group justify="space-between" align="end" mb="md">
        <Group>
          <NativeSelect
            label="目前檢視"
            value={view.id}
            data={config.views.map((v) => ({ value: v.id, label: v.name }))}
            onChange={(e) => setSelected(e.target.value)}
          />
          <Button
            variant="subtle"
            onClick={() => editView(view)}
            disabled={disabled}
          >
            檢視設定
          </Button>
          <Button
            variant="subtle"
            onClick={() => editView(initialView(crypto.randomUUID(), "新檢視"))}
            disabled={disabled}
          >
            新增檢視
          </Button>
        </Group>
        <Group>
          <Button variant="light" onClick={editProperties} disabled={disabled}>
            管理欄位
          </Button>
          <Button
            leftSection={<IconPlus size={16} />}
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
        </Group>
      </Group>
      <TextInput
        aria-label="搜尋資料庫筆記"
        placeholder="搜尋筆記名稱…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        mb="md"
      />
      <Text size="xs" c="dimmed" data-testid="property-status" mb="sm">
        {status || "欄位以連線保存"}
      </Text>
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
      <div className="database-scroll" data-testid="database-rows">
        {view.layout === "table" ? (
          <Table withTableBorder withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                {view.columns.map((id) => (
                  <Table.Th key={id}>
                    {fields.find((p) => p.id === id)?.name}
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
                        <>
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
                            href={"/?page=" + row.id}
                            onClick={(e) => {
                              e.preventDefault();
                              void run(() => navigate(row.id));
                            }}
                          >
                            開啟 {row.title}
                          </Anchor>
                        </>
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
          <Stack gap="xs">
            {rows.map((row) => (
              <Paper key={row.id} p="sm" withBorder data-testid="database-row">
                <Anchor
                  href={"/?page=" + row.id}
                  onClick={(e) => {
                    e.preventDefault();
                    void run(() => navigate(row.id));
                  }}
                >
                  {row.title}
                </Anchor>
                {view.columns
                  .filter((id) => id !== "title")
                  .map((id) => (
                    <Text key={id} size="sm" c="dimmed">
                      {fields.find((p) => p.id === id)?.name}：
                      {id === "created_at" || id === "updated_at"
                        ? new Date(row[id]).toLocaleString("zh-TW")
                        : displayValue(
                            readValues(row.property_values)[id] ?? null,
                            config.properties.find((p) => p.id === id),
                          )}
                    </Text>
                  ))}
              </Paper>
            ))}
          </Stack>
        )}
      </div>
      {!rows.length && (
        <Text c="dimmed" py="xl" ta="center">
          {data?.rows.length
            ? "沒有符合的筆記"
            : "新增第一篇筆記，或從頁面操作將既有筆記移入。"}
        </Text>
      )}
      <Modal
        opened={manager}
        onClose={() => setManager(false)}
        title="管理欄位"
        size="lg"
        closeButtonProps={{ "aria-label": "關閉欄位管理" }}
      >
        <Stack>
          {failure && <Alert color="red">{failure}</Alert>}
          <Text size="sm" c="dimmed">
            名稱沿用筆記標題。已有值的欄位若要更換類型，請新增欄位；刪除與移出後，原值仍保留但不顯示。
          </Text>
          {properties.map((p, index) => (
            <Paper withBorder p="sm" key={p.id}>
              <Stack gap="xs">
                <TextInput
                  label={"欄位名稱 " + (index + 1)}
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
                  label={"欄位類型 " + (index + 1)}
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
                {["select", "multiSelect"].includes(p.type) && (
                  <Stack gap="xs">
                    {p.options.map((o, i) => (
                      <Group key={o.id} align="end">
                        <TextInput
                          label={"選項 " + p.name + " " + (i + 1)}
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
                          移除選項 {o.name}
                        </Button>
                      </Group>
                    ))}
                    <TextInput
                      label={"新增選項 " + p.name}
                      placeholder="輸入名稱後按 Enter"
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
                  </Stack>
                )}
                <Group>
                  <Button
                    variant="subtle"
                    size="xs"
                    aria-label={"上移 " + p.name}
                    onClick={() => setProperties(move(properties, index, -1))}
                  >
                    上移
                  </Button>
                  <Button
                    variant="subtle"
                    size="xs"
                    aria-label={"下移 " + p.name}
                    onClick={() => setProperties(move(properties, index, 1))}
                  >
                    下移
                  </Button>
                  <Button
                    color="red"
                    variant="subtle"
                    size="xs"
                    onClick={() => setRemove(p.id)}
                  >
                    刪除 {p.name}
                  </Button>
                </Group>
              </Stack>
            </Paper>
          ))}
          <form
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
            <Stack>
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
              <Button type="submit" disabled={disabled}>
                新增欄位
              </Button>
            </Stack>
          </form>
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
        </Stack>
      </Modal>
      <Modal
        opened={!!remove}
        onClose={() => setRemove(undefined)}
        title="刪除欄位"
      >
        <Stack>
          <Text>
            刪除「{properties.find((p) => p.id === remove)?.name}
            」？原值保留於備份及筆記資料，不再顯示。
          </Text>
          <Group>
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
      >
        {editingView && (
          <Stack>
            {failure && <Alert color="red">{failure}</Alert>}
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
            <Text fw={500}>顯示欄位與順序</Text>
            {editingView.columns.map((id, i) => (
              <Group key={id}>
                <Text size="sm">{fields.find((p) => p.id === id)?.name}</Text>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  aria-label={"上移檢視欄位 " + id}
                  onClick={() =>
                    updateView({ columns: move(editingView.columns, i, -1) })
                  }
                >
                  上移
                </Button>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  aria-label={"下移檢視欄位 " + id}
                  onClick={() =>
                    updateView({ columns: move(editingView.columns, i, 1) })
                  }
                >
                  下移
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
            <NativeSelect
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
              <Paper key={i} withBorder p="sm">
                <Stack gap="xs">
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
                </Stack>
              </Paper>
            ))}
            <Button
              variant="light"
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
            {editingView.sorts.map((s, i) => (
              <Group key={i} align="end">
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
            <Button
              variant="light"
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
            <Group>
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
