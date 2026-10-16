import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Menu,
  Modal,
  NativeSelect,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconArrowsSort,
  IconDots,
  IconFileText,
  IconFilter,
  IconLayoutList,
  IconListDetails,
  IconPlus,
  IconSearch,
  IconSettings,
  IconTable,
} from "@tabler/icons-react";
import "./databases.css";
import { navigate, saveDraft } from "./api";
import { PageIconPicker, publishPageMetadata } from "./page-icon";
import type { PageInfo, PageRow } from "../shared/pages";
import {
  BUILTIN,
  OPERATOR_NAMES,
  initialView,
  readConfig,
  selectRows,
  type DatabaseView,
  type PropertyOption,
} from "../shared/databases";
import { useLiveConfig } from "./databases/live-config";
import { ViewControls } from "./databases/view-controls";
import { DatabaseRows } from "./databases/database-rows";
import { PropertyManager } from "./databases/property-manager";
import { ViewSettings, type ViewSession } from "./databases/view-settings";
import { useDatabase } from "./databases/use-database";
import {
  request,
  useOnline,
  type ConfigSession,
  type SaveConfig,
} from "./databases/utils";
export { NoteProperties } from "./databases/fields";

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
  const [filterOpened, setFilterOpened] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(page.title);
  const [propertySession, setPropertySession] = useState<ConfigSession>();
  const [focusedRow, setFocusedRow] = useState("");
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [rowAction, setRowAction] = useState<{
    action: "delete" | "move";
    rows: PageRow[];
  }>();
  const [destinations, setDestinations] = useState<PageRow[]>([]);
  const [destination, setDestination] = useState("");
  const [viewSession, setViewSession] = useState<ViewSession>();
  useEffect(() => setTitle(page.title), [page.title]);
  useEffect(() => {
    const next = data?.page;
    if (
      !next ||
      next.id !== page.id ||
      next.owner_id !== page.owner_id ||
      next.sync_generation !== page.sync_generation ||
      next.metadata_revision <= page.metadata_revision
    )
      return;
    // 資料庫沒有正文同步連線，沿用資料庫輪詢更新目前頁面的 metadata。
    publishPageMetadata({
      ...page,
      ...next,
      room: page.room,
      ancestors: page.ancestors,
      summary: page.summary,
    });
  }, [data?.page, page]);
  const fallback = useMemo(
    () => readConfig(page.database_config!),
    [page.database_config],
  );
  const source = data?.config ?? fallback;
  const live = useLiveConfig(
    page.id,
    source,
    data?.page.sync_generation ?? page.sync_generation,
  );
  const config = live.config;
  const view = config.views.find((v) => v.id === selected) ?? config.views[0];
  const rows = selectRows(data?.rows ?? [], view, query);
  const visibleRows =
    focusedRow && !rows.some((row) => row.id === focusedRow)
      ? [...rows, ...(data?.rows.filter((row) => row.id === focusedRow) ?? [])]
      : rows;
  const updateView = (patch: Partial<DatabaseView>) => {
    const id = view.id;
    live.edit((config) => ({
      ...config,
      views: config.views.map((v) => (v.id === id ? { ...v, ...patch } : v)),
    }));
  };
  useEffect(() => {
    setFocusedRow("");
    setSelectedRows([]);
  }, [selected, query]);
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
  const saveConfig: SaveConfig = async (next, previous, generation) => {
    const saved: PageRow = await request(
      "/api/databases/" + page.id + "/config",
      {
        previous,
        generation,
        config: next,
      },
    );
    const merged = readConfig(saved.database_config!);
    await refresh();
    return merged;
  };
  const session = (): ConfigSession => ({
    config,
    previous: JSON.stringify(config),
    generation: data?.page.sync_generation ?? page.sync_generation,
  });
  const editProperties = (field?: string) => {
    const next = { ...session(), field };
    void live
      .flush()
      .then(() => setPropertySession(next))
      .catch((error: Error) => setFailure(error.message));
    setFailure("");
  };
  const editView = (view: DatabaseView, section = "") => {
    const next = { ...session(), view, section };
    void live
      .flush()
      .then(() => setViewSession(next))
      .catch((error: Error) => setFailure(error.message));
    setFailure("");
  };
  const disabled = !online || readOnly || busy;
  const createRow = () =>
    void run(async () => {
      await saveDraft();
      const row: PageRow = await request("/api/pages", {
        title: "未命名",
        parent_id: page.id,
      });
      setFocusedRow(row.id);
      await refresh();
    });
  const createOption = async (
    property: string,
    name: string,
  ): Promise<PropertyOption> => {
    const existing = live.config.properties
      .find((p) => p.id === property)
      ?.options.find((option) => option.name === name);
    if (existing) {
      await live.flush();
      return existing;
    }
    const option: PropertyOption = {
      id: crypto.randomUUID(),
      name,
      color: "blue",
    };
    live.edit((config) => ({
      ...config,
      properties: config.properties.map((p) =>
        p.id === property ? { ...p, options: [...p.options, option] } : p,
      ),
    }));
    await live.flush();
    return option;
  };
  const performRows = async (
    action: "duplicate" | "delete" | "move",
    records: PageRow[],
  ) => {
    await saveDraft();
    for (const row of records) {
      await request(
        "/api/pages/" + row.id + "/" + action,
        action === "move"
          ? { parent_id: destination || null }
          : { generation: row.sync_generation },
      );
      setSelectedRows((ids) => ids.filter((id) => id !== row.id));
      setRowAction(
        (current) =>
          current && {
            ...current,
            rows: current.rows.filter((record) => record.id !== row.id),
          },
      );
      await refresh();
    }
    setRowAction(undefined);
  };
  const openRowAction = (
    action: "duplicate" | "delete" | "move",
    records: PageRow[],
  ) => {
    if (action === "duplicate") {
      void run(() => performRows(action, records));
      return;
    }
    setDestination("");
    setRowAction({ action, rows: records });
    if (action === "move")
      void run(async () => {
        const pages = await request("/api/pages");
        setDestinations(
          pages.filter(
            (p: PageRow) =>
              p.kind === "note" &&
              p.id !== page.id &&
              !records.some((row) => row.id === p.id),
          ),
        );
      });
  };
  return (
    <section
      className="database-page"
      data-testid={data ? "database-ready" : "database-loading"}
    >
      <header className="database-heading">
        <PageIconPicker
          page={data?.page ?? page}
          className="database-page-icon"
          size="large"
          disabled={disabled}
        />
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
          <div
            className="database-view-tabs"
            role="tablist"
            aria-label="資料庫檢視"
          >
            {config.views.map((item) => (
              <div key={item.id} className="database-view-tab-group">
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
                    if (
                      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                        event.key,
                      )
                    )
                      return;
                    event.preventDefault();
                    const index = config.views.findIndex(
                      (v) => v.id === item.id,
                    );
                    const next =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? config.views.length - 1
                          : (index +
                              (event.key === "ArrowRight" ? 1 : -1) +
                              config.views.length) %
                            config.views.length;
                    setSelected(config.views[next].id);
                    event.currentTarget
                      .closest("[role=tablist]")
                      ?.querySelectorAll<HTMLButtonElement>("[role=tab]")
                      [next]?.focus();
                  }}
                >
                  {item.layout === "table" ? (
                    <IconTable size={15} aria-hidden="true" />
                  ) : (
                    <IconLayoutList size={15} aria-hidden="true" />
                  )}
                  <span>{item.name}</span>
                </button>
                <Menu withinPortal position="bottom-start">
                  <Menu.Target>
                    <button
                      type="button"
                      className="database-tab-menu"
                      aria-label={"檢視選單 " + item.name}
                      disabled={disabled}
                    >
                      <IconDots size={14} />
                    </button>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item onClick={() => editView(item)}>
                      重新命名檢視
                    </Menu.Item>
                    <Menu.Item
                      disabled={config.views.length >= 20}
                      onClick={() => {
                        const id = crypto.randomUUID();
                        live.edit((config) => ({
                          ...config,
                          views: [
                            ...config.views,
                            {
                              ...structuredClone(item),
                              id,
                              name: (item.name + " 副本").slice(0, 100),
                            },
                          ],
                        }));
                        setSelected(id);
                      }}
                    >
                      複製檢視
                    </Menu.Item>
                    <Menu.Item
                      color="red"
                      disabled={config.views.length === 1}
                      onClick={() =>
                        live.edit((config) => ({
                          ...config,
                          views: config.views.filter((v) => v.id !== item.id),
                        }))
                      }
                    >
                      刪除檢視
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </div>
            ))}
          </div>
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
        <div
          className="database-toolbar-actions"
          role="toolbar"
          aria-label="資料庫工具列"
        >
          <ViewControls
            opened={filterOpened}
            onOpenedChange={setFilterOpened}
            section="filter"
            config={config}
            view={view}
            update={updateView}
            disabled={disabled}
          >
            <Button
              variant="subtle"
              className={
                "database-compact-action" +
                (view.filters.length ? " database-active-tool" : "")
              }
              aria-label={
                view.filters.length ? `篩選 · ${view.filters.length}` : "篩選"
              }
              title="篩選"
              onClick={() => setFilterOpened(!filterOpened)}
              leftSection={<IconFilter size={15} aria-hidden="true" />}
              disabled={disabled}
            >
              篩選{view.filters.length ? ` · ${view.filters.length}` : ""}
            </Button>
          </ViewControls>
          <ViewControls
            section="sort"
            config={config}
            view={view}
            update={updateView}
            disabled={disabled}
          >
            <Button
              variant="subtle"
              className={
                "database-compact-action" +
                (view.sorts.length ? " database-active-tool" : "")
              }
              aria-label={
                view.sorts.length ? `排序 · ${view.sorts.length}` : "排序"
              }
              title="排序"
              leftSection={<IconArrowsSort size={15} aria-hidden="true" />}
              disabled={disabled}
            >
              排序{view.sorts.length ? ` · ${view.sorts.length}` : ""}
            </Button>
          </ViewControls>
          <Button
            variant="subtle"
            className="database-icon-button"
            aria-label="管理欄位"
            title="管理欄位"
            onClick={() => editProperties()}
            disabled={disabled}
          >
            <IconListDetails size={17} aria-hidden="true" />
          </Button>
          <ViewControls
            section="display"
            config={config}
            view={view}
            update={updateView}
            disabled={disabled}
          >
            <Button
              variant="subtle"
              className="database-icon-button"
              aria-label="檢視設定"
              title="檢視設定"
              disabled={disabled}
            >
              <IconSettings size={16} aria-hidden="true" />
            </Button>
          </ViewControls>
          <TextInput
            aria-label="搜尋資料庫筆記"
            placeholder="搜尋…"
            className="database-search"
            leftSection={<IconSearch size={15} aria-hidden="true" />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Text
            size="xs"
            c={live.failure ? "red" : "dimmed"}
            role="status"
            aria-label="檢視儲存狀態"
          >
            {live.failure
              ? "檢視未儲存"
              : live.saving
                ? "儲存檢視中…"
                : "檢視已儲存"}
          </Text>
          <Button
            leftSection={<IconPlus size={15} aria-hidden="true" />}
            className="database-compact-action"
            aria-label="新增筆記"
            title="新增筆記"
            disabled={disabled}
            onClick={createRow}
          >
            新增筆記
          </Button>
        </div>
      </div>
      <div className="database-filter-chips" aria-label="目前篩選條件">
        {view.filters.map((filter, index) => {
          const field = [...BUILTIN, ...config.properties].find(
            (p) => p.id === filter.property,
          );
          const value =
            config.properties
              .find((p) => p.id === filter.property)
              ?.options.find((o) => o.id === filter.value)?.name ??
            filter.value;
          return (
            <span className="database-filter-chip" key={index}>
              {index > 0 ? (view.filterMode === "and" ? "且 " : "或 ") : ""}
              {field?.name} {OPERATOR_NAMES[filter.operator]} {value}
              <button
                type="button"
                aria-label={"移除條件 " + (index + 1)}
                disabled={disabled}
                onClick={() =>
                  updateView({
                    filters: view.filters.filter((_, i) => i !== index),
                  })
                }
              >
                ×
              </button>
            </span>
          );
        })}
      </div>
      {live.failure && (
        <Alert color="red" role="alert">
          {live.failure}
          <Button
            variant="subtle"
            onClick={() => void live.flush().catch(() => {})}
          >
            重試檢視設定
          </Button>
          <Button
            variant="subtle"
            disabled={live.saving}
            onClick={() => {
              live.discard();
              void run(refresh);
            }}
          >
            放棄檢視修改
          </Button>
        </Alert>
      )}
      {selectedRows.length > 0 && (
        <Group className="database-batch-actions" gap="xs">
          <Text size="sm">已選取 {selectedRows.length} 篇</Text>
          <Button
            variant="subtle"
            disabled={disabled}
            onClick={() =>
              openRowAction(
                "duplicate",
                data?.rows.filter((r) => selectedRows.includes(r.id)) ?? [],
              )
            }
          >
            複製所選筆記
          </Button>
          <Button
            variant="subtle"
            disabled={disabled}
            onClick={() =>
              openRowAction(
                "move",
                data?.rows.filter((r) => selectedRows.includes(r.id)) ?? [],
              )
            }
          >
            移動所選筆記
          </Button>
          <Button
            variant="subtle"
            color="red"
            disabled={disabled}
            onClick={() =>
              openRowAction(
                "delete",
                data?.rows.filter((r) => selectedRows.includes(r.id)) ?? [],
              )
            }
          >
            刪除所選筆記
          </Button>
          <Button variant="subtle" onClick={() => setSelectedRows([])}>
            取消選取
          </Button>
        </Group>
      )}
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
      <DatabaseRows
        config={config}
        view={view}
        rows={visibleRows}
        focusedRow={focusedRow}
        onCreate={createRow}
        onCreateOption={createOption}
        onViewChange={updateView}
        onEditProperty={editProperties}
        onFilterColumn={(id) => {
          updateView({
            filters: [
              ...view.filters,
              { property: id, operator: "eq", value: "" },
            ],
          });
          setFilterOpened(true);
        }}
        selectedRows={selectedRows}
        onSelection={setSelectedRows}
        onRowAction={openRowAction}
        readOnly={readOnly}
        iconDisabled={disabled}
        onStatus={setStatus}
        onOpen={(id) => void run(() => navigate(id))}
      />
      {!rows.length && (
        <div className="database-empty">
          <IconFileText size={26} stroke={1.3} aria-hidden="true" />
          <Text size="sm">
            {!data
              ? "正在載入筆記…"
              : data.rows.length
                ? "沒有符合的筆記"
                : "從第一篇筆記開始"}
          </Text>
          <Text size="xs" c="dimmed">
            {!data
              ? ""
              : data.rows.length
                ? "試著調整搜尋或篩選條件。"
                : "點選「新增筆記」，或將既有筆記移入這個資料庫。"}
          </Text>
        </div>
      )}
      <div className="database-footer">
        <Text size="xs" c="dimmed">
          {rows.length} 篇筆記
        </Text>
        <Text size="xs" c="dimmed" role="status" data-testid="property-status">
          {status}
        </Text>
      </div>
      <Modal
        opened={!!rowAction}
        onClose={() => !busy && setRowAction(undefined)}
        title={rowAction?.action === "delete" ? "刪除筆記" : "移動筆記"}
      >
        <Text size="sm">
          {rowAction?.action === "delete"
            ? `將 ${rowAction.rows.length} 篇筆記移到垃圾桶？`
            : `移動 ${rowAction?.rows.length ?? 0} 篇筆記到：`}
        </Text>
        {rowAction?.action === "move" && (
          <NativeSelect
            label="移動目的地"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            data={[
              { value: "", label: "根目錄" },
              ...destinations.map((p) => ({ value: p.id, label: p.title })),
            ]}
          />
        )}
        {failure && (
          <Alert color="red" role="alert">
            {failure}
          </Alert>
        )}
        <Group mt="md">
          <Button
            variant="default"
            disabled={busy}
            onClick={() => setRowAction(undefined)}
          >
            取消
          </Button>
          <Button
            color={rowAction?.action === "delete" ? "red" : undefined}
            disabled={disabled || !rowAction?.rows.length}
            onClick={() =>
              rowAction &&
              void run(() => performRows(rowAction.action, rowAction.rows))
            }
          >
            {rowAction?.action === "delete" ? "確認刪除筆記" : "確認移動筆記"}
          </Button>
        </Group>
      </Modal>
      <PropertyManager
        session={propertySession}
        disabled={disabled}
        onClose={() => setPropertySession(undefined)}
        onSave={saveConfig}
      />
      <ViewSettings
        session={viewSession}
        disabled={disabled}
        onClose={() => setViewSession(undefined)}
        onSave={saveConfig}
        onSelected={setSelected}
      />
    </section>
  );
}
