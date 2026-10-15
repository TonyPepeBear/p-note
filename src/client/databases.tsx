import { useEffect, useState } from "react";
import { Alert, Button, NativeSelect, Text, TextInput } from "@mantine/core";
import {
  IconArrowsSort,
  IconChevronDown,
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
import { navigate } from "./api";
import { PageIconPicker, publishPageMetadata } from "./page-icon";
import type { PageInfo, PageRow } from "../shared/pages";
import { initialView, readConfig, selectRows, type DatabaseView } from "../shared/databases";
import { DatabaseRows } from "./databases/database-rows";
import { PropertyManager } from "./databases/property-manager";
import { ViewSettings, type ViewSession } from "./databases/view-settings";
import { useDatabase } from "./databases/use-database";
import { request, useOnline, type ConfigSession, type SaveConfig } from "./databases/utils";
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
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(page.title);
  const [propertySession, setPropertySession] = useState<ConfigSession>();
  const [viewSession, setViewSession] = useState<ViewSession>();
  useEffect(() => setTitle(page.title), [page.title]);
  useEffect(() => {
    const next = data?.page;
    if (!next || next.id !== page.id || next.owner_id !== page.owner_id
      || next.sync_generation !== page.sync_generation || next.metadata_revision <= page.metadata_revision) return;
    // 資料庫沒有正文同步連線，沿用資料庫輪詢更新目前頁面的 metadata。
    publishPageMetadata({ ...page, ...next, room: page.room, ancestors: page.ancestors, summary: page.summary });
  }, [data?.page, page]);
  const config = data?.config ?? readConfig(page.database_config!);
  const view = config.views.find((v) => v.id === selected) ?? config.views[0];
  const rows = selectRows(data?.rows ?? [], view, query);
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
    const saved: PageRow = await request("/api/databases/" + page.id + "/config", {
      previous,
      generation,
      config: next,
    });
    const merged = readConfig(saved.database_config!);
    await refresh();
    return merged;
  };
  const session = (): ConfigSession => ({
    config,
    previous: data?.page.database_config ?? page.database_config!,
    generation: data?.page.sync_generation ?? page.sync_generation,
  });
  const editProperties = () => {
    setPropertySession(session());
    setFailure("");
  };
  const editView = (view: DatabaseView, section = "") => {
    setViewSession({ ...session(), view, section });
    setFailure("");
  };
  const disabled = !online || readOnly || busy;
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
            className={"database-compact-action" + (view.filters.length ? " database-active-tool" : "")}
            aria-label={view.filters.length ? `篩選 · ${view.filters.length}` : "篩選"}
            title="篩選"
            leftSection={<IconFilter size={15} aria-hidden="true" />}
            onClick={() => editView(view, "database-filter-settings")}
            disabled={disabled}
          >
            篩選{view.filters.length ? ` · ${view.filters.length}` : ""}
          </Button>
          <Button
            variant="subtle"
            className={"database-compact-action" + (view.sorts.length ? " database-active-tool" : "")}
            aria-label={view.sorts.length ? `排序 · ${view.sorts.length}` : "排序"}
            title="排序"
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
            className="database-compact-action"
            aria-label="新增筆記"
            title="新增筆記"
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
      <DatabaseRows
        config={config}
        view={view}
        rows={rows}
        readOnly={readOnly}
        iconDisabled={disabled}
        onStatus={setStatus}
        onOpen={(id) => void run(() => navigate(id))}
      />
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
