import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { PwaControls } from "./pwa-controls";
import { PageMenu, type PageAction } from "./page-menu";
import {
  Alert, Anchor, Breadcrumbs, Button, Drawer, Group, Menu, Modal, NativeSelect,
  Stack, Text, TextInput,
} from "@mantine/core";
import {
  IconArrowRight, IconCalendar, IconCalendarEvent, IconChevronDown,
  IconChevronRight, IconChevronsLeft, IconChevronsRight, IconCloud,
  IconDatabase, IconFileText, IconLogout, IconMenu2, IconPlus,
  IconSearch, IconSettings, IconTrash, IconPhoto,
} from "@tabler/icons-react";
import type { PageInfo, PageRow } from "../shared/pages";
import { today } from "../shared/pages";
import { api, navigate, saveDraft } from "./api";
import { Brand } from "./ui";
import "./navigation.css";

export function Navigation({ page, changed, error, backups, settings, images, imagesClose, pageHistory, settingsView, databaseView, navigationLocked = false, children }: {
  page: PageInfo;
  changed: (page: PageInfo) => void;
  error: (message: string) => void;
  backups: () => void;
  settings: () => void;
  images: () => void;
  imagesClose: () => void;
  pageHistory?: () => void;
  settingsView?: "backup" | "api" | "images";
  databaseView?: boolean;
  navigationLocked?: boolean;
  children: ReactNode;
}) {
  const [pages, setPages] = useState<PageRow[]>([]);
  const [trash, setTrash] = useState<PageRow[]>([]);
  const [journals, setJournals] = useState<PageRow[]>([]);
  const [results, setResults] = useState<PageInfo[]>([]);
  const [panel, setPanel] = useState("");
  const [actionPage, setActionPage] = useState<PageRow>(page);
  const [navOpen, setNavOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [pwaHelpOpen, setPwaHelpOpen] = useState(false);
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem("p-note-sidebar-collapsed") === "true"; }
    catch { return false; }
  });
  const [date, setDate] = useState(page.journal_date ?? today(Date.now()));
  const [month, setMonth] = useState((page.journal_date ?? today(Date.now())).slice(0, 7));
  const [title, setTitle] = useState(page.title);
  const [parent, setParent] = useState(page.parent_id ?? "");
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    const ancestors = new Set(page.ancestors?.map((item) => item.id));
    try {
      const stored = JSON.parse(localStorage.getItem("p-note-collapsed") ?? "[]") as string[];
      return stored.filter((id) => !ancestors.has(id));
    } catch { return []; }
  });
  const trigger = useRef<HTMLElement | null>(null);
  // 快捷鍵的長效監聽器也必須讀取最新還原鎖定狀態。
  const navigationLockedRef = useRef(navigationLocked);
  navigationLockedRef.current = navigationLocked;
  useEffect(() => {
    if (navigationLocked) { setPanel(""); setCreateOpen(false); }
  }, [navigationLocked]);
  const setSidebar = (closed: boolean) => {
    setSidebarCollapsed(closed);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(
      closed ? 'button[aria-label="展開側邊欄"]' : '.workspace-sidebar button[aria-label="收合側邊欄"]',
    )?.focus());
    try { localStorage.setItem("p-note-sidebar-collapsed", String(closed)); }
    catch { /* 儲存偏好失敗不影響導覽。 */ }
  };
  const toggle = (id: string) => setCollapsed((items) => {
    const next = items.includes(id) ? items.filter((item) => item !== id) : [...items, id];
    try { localStorage.setItem("p-note-collapsed", JSON.stringify(next)); }
    catch { /* 儲存偏好失敗不影響頁面樹。 */ }
    return next;
  });
  const loadTrash = async () => {
    const response = await api("/api/trash");
    if (!response.ok) throw new Error("無法載入垃圾桶，請重試");
    setTrash((await response.json()) as PageRow[]);
  };
  const loadMonth = async (value: string) => {
    const response = await api("/api/journals?month=" + encodeURIComponent(value));
    if (!response.ok) throw new Error("無效月份");
    setJournals((await response.json()) as PageRow[]);
  };
  const refresh = async () => {
    const response = await api("/api/pages");
    if (!response.ok) throw new Error("無法載入頁面列表");
    setPages((await response.json()) as PageRow[]);
  };
  useEffect(() => {
    void refresh().catch(() => error("無法載入頁面列表，請重新整理"));
    const ancestors = new Set(page.ancestors?.map((item) => item.id));
    setCollapsed((items) => items.filter((id) => !ancestors.has(id)));
    setPanel("");
    setCreateOpen(false);
    setNavOpen(false);
    setPageMenuOpen(false);
    setDate(page.journal_date ?? today(Date.now()));
    setMonth((page.journal_date ?? today(Date.now())).slice(0, 7));
  }, [page.id]);
  useEffect(() => {
    setPages((items) => items.map((item) => item.id === page.id
      ? { ...item, title: page.title, parent_id: page.parent_id } : item));
  }, [page.title, page.parent_id]);
  useEffect(() => {
    const search = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      // 捕獲階段攔截，避免編輯器把 Mod+K 當成插入連結。
      event.preventDefault();
      event.stopPropagation();
      open("search");
    };
    window.addEventListener("keydown", search, true);
    return () => window.removeEventListener("keydown", search, true);
  }, []);
  const run = async (work: () => Promise<void>) => {
    if (navigationLockedRef.current) return;
    setBusy(true);
    setFailure("");
    error("");
    try { await work(); }
    catch (e) {
      const message = e instanceof Error ? e.message : "操作失敗，請稍後重試";
      setFailure(message);
      if (!panel) error(message);
    } finally { setBusy(false); }
  };
  const request = async (path: string, data?: object) => {
    const response = await api(path, data);
    const value = (await response.json()) as PageInfo & { message?: string; page?: PageInfo };
    if (!response.ok) {
      if (response.status === 409 && value.page) { await navigate(value.page.id); return; }
      throw new Error(value.message ?? "操作失敗，請稍後重試");
    }
    return value;
  };
  const link = (event: MouseEvent<HTMLElement>, id: string) => {
    if (navigationLockedRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setNavOpen(false);
    void run(() => navigate(id));
  };
  const pageLink = (item: PageRow, label = item.title) => (
    <Anchor href={navigationLocked ? undefined : "/?page=" + item.id} role="link" aria-disabled={navigationLocked || undefined} tabIndex={navigationLocked ? -1 : undefined} onClick={(event) => link(event, item.id)}>{label}</Anchor>
  );
  const open = (name: string, target?: HTMLElement) => {
    if (navigationLockedRef.current) return;
    trigger.current = target ?? (document.activeElement as HTMLElement);
    trigger.current?.focus();
    setPanel(name);
    setNavOpen(false);
    setFailure("");
    setNotice("");
  };
  const pageAction = (action: PageAction, item: PageRow, target: HTMLButtonElement | null) => {
    if (navigationLockedRef.current || busy) return;
    setActionPage(item);
    setTitle(item.title);
    setParent(item.parent_id ?? "");
    if (action === "history") {
      setNavOpen(false);
      pageHistory?.();
    } else if (action === "child" || action === "database") {
      setNavOpen(false);
      void run(async () => {
        await saveDraft();
        const child = await request(action === "child" ? "/api/pages" : "/api/databases", {
          title: action === "child" ? "未命名" : "未命名資料庫", parent_id: item.id,
        });
        if (child) await navigate(child.id, action === "child");
      });
    } else open(action, target ?? undefined);
  };
  const updatePage = async (updated?: PageInfo) => {
    if (updated?.id === page.id) changed(updated);
    else if (page.ancestors?.some((item) => item.id === actionPage.id)) {
      const current = await request(`/api/pages/${page.id}`);
      if (current) changed(current);
    }
    await refresh();
    setPanel("");
  };
  const notesUnder = (parentId: string | null) => pages.filter((item) => item.kind === "note" && item.parent_id === parentId);
  const tree = (parentId: string | null, depth = 0): ReactNode => notesUnder(parentId).map((item) => {
    const nested = notesUnder(item.id).length > 0;
    const closed = collapsed.includes(item.id);
    return <div key={item.id} className="pn-tree-branch" style={{ paddingLeft: depth ? 14 : 0 }}>
      <PageMenu page={item} disabled={busy || navigationLocked} active={!settingsView && item.id === page.id} history={!!pageHistory && item.id === page.id} onAction={pageAction} onOpenChange={setPageMenuOpen}>
        {nested ? <button type="button" className="pn-tree-toggle"
          aria-label={(closed ? "展開 " : "收合 ") + item.title} aria-expanded={!closed} onClick={() => toggle(item.id)}>
          {closed ? <IconChevronRight size={14} /> : <IconChevronDown size={14} />}
        </button> : <span className="pn-tree-spacer" />}
        <a href={navigationLocked ? undefined : "/?page=" + item.id} role="link" aria-disabled={navigationLocked || undefined} tabIndex={navigationLocked ? -1 : undefined} className="pn-note-link note-link"
          aria-current={!settingsView && item.id === page.id ? "page" : undefined}
          onClick={(event) => link(event, item.id)} title={item.title}>
          {item.database_config ? <IconDatabase size={17} /> : <IconFileText size={17} />}
          <span>{item.title}</span>
        </a>
      </PageMenu>
      {!closed && tree(item.id, depth + 1)}
    </div>;
  });
  const parents = (parentId: string | null, depth = 0): { value: string; label: string }[] => notesUnder(parentId)
    .filter((item) => item.id !== actionPage.id).flatMap((item) => [
      { value: item.id, label: "　".repeat(depth) + item.title }, ...parents(item.id, depth + 1),
    ]);
  const openJournals = (target: HTMLElement) => { open("journals", target); void run(() => loadMonth(month)); };
  const newNote = () => void run(async () => {
    const note = await request("/api/pages", { title: "未命名", parent_id: null });
    if (note) await navigate(note.id, true);
  });
  const sidebar = <div className="pn-sidebar-content">
    <div className="pn-workspace-switcher">
      <div className="pn-workspace-brand"><Brand /><span className="pn-workspace-name">私人工作區</span></div>
      <button className="pn-icon-button pn-desktop-only" aria-label="收合側邊欄" title="收合側邊欄" aria-expanded="true" aria-controls="workspace-sidebar"
        onClick={() => setSidebar(true)}><IconChevronsLeft size={18} /></button>
    </div>
    <nav className="pn-quick-navigation" aria-label="工作區">
      <button className="pn-nav-item pn-sidebar-search" disabled={navigationLocked} aria-label="搜尋筆記" onClick={(event) => open("search", event.currentTarget)}>
        <IconSearch size={18} /><span>搜尋</span><kbd aria-hidden="true">⌘ K</kbd>
      </button>
      <button className="pn-nav-item" disabled={navigationLocked} data-active={!settingsView && page.kind === "journal" && page.journal_date === today(Date.now()) || undefined}
        onClick={() => { setNavOpen(false); void run(() => navigate()); }}><IconCalendarEvent size={18} /><span>今天</span></button>
      <button className="pn-nav-item" disabled={navigationLocked} onClick={(event) => openJournals(event.currentTarget)}>
        <IconCalendar size={18} /><span>日記</span>
      </button>
    </nav>
    <div className="pn-section-label"><span>私人頁面</span><span className="pn-note-count">{pages.filter((item) => item.kind === "note").length}</span></div>
    <div className="pn-notes-scroll">
      <nav aria-label="筆記頁面">
        {pages.some((item) => item.kind === "note") ? tree(null) : <div className="pn-sidebar-empty">還沒有筆記</div>}
      </nav>
    </div>
    <nav className="pn-sidebar-footer" aria-label="工作區管理">
      <PwaControls disabled={navigationLocked} onHelpOpenChange={setPwaHelpOpen} />
      <button className="pn-nav-item" disabled={navigationLocked} data-active={settingsView === "images" || undefined} aria-current={settingsView === "images" ? "page" : undefined} onClick={() => { if (navigationLockedRef.current) return; setNavOpen(false); images(); }}>
        <IconPhoto size={17} /><span>我的圖片</span>
      </button>
      <button className="pn-nav-item" disabled={navigationLocked} data-active={settingsView === "api" || undefined} onClick={() => { if (navigationLockedRef.current) return; setNavOpen(false); settings(); }}>
        <IconSettings size={17} /><span>設定</span>
      </button>
      <button className="pn-nav-item" disabled={navigationLocked} aria-label="備份設定" data-active={settingsView === "backup" || undefined} onClick={() => { if (navigationLockedRef.current) return; setNavOpen(false); backups(); }}>
        <IconCloud size={17} /><span>備份設定</span>
      </button>
      <button className="pn-nav-item" disabled={navigationLocked} onClick={(event) => { open("trash", event.currentTarget); void run(loadTrash); }}>
        <IconTrash size={17} /><span>垃圾桶</span>
      </button>
      <button className="pn-nav-item" disabled={navigationLocked} onClick={() => void run(async () => {
        await saveDraft();
        const response = await api("/api/logout", {});
        if (!response.ok) throw new Error("登出失敗，請重試");
        location.assign("/");
      })}><IconLogout size={17} /><span>登出</span></button>
    </nav>
  </div>;
  const panelTitle = ({ search: "搜尋筆記", journals: "日記回顧", trash: "垃圾桶", rename: "重新命名頁面", move: "移動頁面", delete: "移到垃圾桶？" } as Record<string, string>)[panel] ?? "";
  return <div className="pn-workspace app-shell" data-sidebar-collapsed={sidebarCollapsed} data-navigation-locked={navigationLocked || undefined}>
    <aside id="workspace-sidebar" className="pn-sidebar workspace-sidebar" aria-label="側邊欄">{sidebar}</aside>
    <Drawer opened={navOpen} onClose={() => setNavOpen(false)} title="導覽" size={300}
      trapFocus={!pwaHelpOpen && !pageMenuOpen} closeOnEscape={!pwaHelpOpen && !pageMenuOpen}
      closeButtonProps={{ "aria-label": "關閉導覽" }} className="pn-navigation-drawer navigation-drawer" padding={0}>
      {sidebar}
    </Drawer>
    <main className="pn-main">
      <header className="pn-topbar">
        <button className="pn-icon-button pn-mobile-only" aria-label="導覽" aria-haspopup="dialog" aria-expanded={navOpen}
          onClick={() => setNavOpen(true)}><IconMenu2 size={20} /></button>
        {sidebarCollapsed && <button className="pn-icon-button pn-desktop-only" aria-label="展開側邊欄" title="展開側邊欄" aria-expanded="false" aria-controls="workspace-sidebar"
          onClick={() => setSidebar(false)}><IconChevronsRight size={18} /></button>}
        <nav aria-label="頁面路徑" className="pn-breadcrumbs">
          <Breadcrumbs separator={<span className="pn-path-separator">/</span>}>
            <Anchor component="button" disabled={navigationLocked} aria-disabled={navigationLocked || undefined} aria-label={settingsView ? "返回目前文件" : page.kind === "journal" ? "日記回顧" : "筆記列表"}
              onClick={(event: MouseEvent<HTMLButtonElement>) => {
                if (navigationLockedRef.current) { event.preventDefault(); return; }
                if (settingsView === "images") imagesClose();
                else if (settingsView) void run(() => navigate(page.id));
                else if (page.kind === "journal") openJournals(event.currentTarget);
                else if (matchMedia("(max-width: 47.99em)").matches) setNavOpen(true);
                else {
                  setSidebar(false);
                  requestAnimationFrame(() => document.querySelector<HTMLElement>('.workspace-sidebar [aria-current="page"]')?.focus());
                }
              }}>{settingsView === "images" ? "工作區" : settingsView ? "設定" : page.kind === "journal" ? "日記" : "筆記"}</Anchor>
            {!settingsView && page.ancestors?.map((item, index) => <span key={item.id} className="pn-ancestor"
              data-direct-parent={index === (page.ancestors?.length ?? 0) - 1 || undefined}>{pageLink(item)}</span>)}
            <span className="pn-current-page" title={settingsView ? undefined : page.title}>
              {settingsView === "images" ? <IconPhoto size={15} /> : settingsView ? <IconSettings size={15} /> : page.database_config ? <IconDatabase size={15} /> : <IconFileText size={15} />}
              <span>{settingsView === "images" ? "我的圖片" : settingsView ? settingsView === "backup" ? "備份設定" : "API 與整合" : page.title}</span>
            </span>
          </Breadcrumbs>
        </nav>
        <div className="pn-topbar-actions">
          <Menu opened={createOpen} onChange={(opened) => setCreateOpen(opened && !busy && !navigationLockedRef.current)}
            position="bottom-end" width={192} withinPortal withInitialFocusPlaceholder={false}>
            <Menu.Target>
              <button disabled={busy || navigationLocked} className="pn-icon-button pn-create-button" aria-label="新增" title="新增">
                <IconPlus size={18} /><span>新增</span>
              </button>
            </Menu.Target>
            <Menu.Dropdown className="pn-create-menu" aria-label="新增">
              <Menu.Item disabled={busy || navigationLocked} leftSection={<IconFileText size={17} />} onClick={newNote}>新增筆記</Menu.Item>
              <Menu.Item disabled={busy || navigationLocked} leftSection={<IconDatabase size={17} />} onClick={() => void run(async () => {
                const database = await request("/api/databases", { title: "未命名資料庫" });
                if (database) await navigate(database.id);
              })}>新增資料庫</Menu.Item>
            </Menu.Dropdown>
          </Menu>
          <button disabled={navigationLocked} className={"pn-icon-button " + (sidebarCollapsed ? "" : "pn-mobile-only")} aria-label="搜尋筆記" title="搜尋筆記"
            onClick={(event) => open("search", event.currentTarget)}><IconSearch size={18} /></button>
          <button disabled={navigationLocked} className={"pn-icon-button " + (sidebarCollapsed ? "" : "pn-mobile-only")} aria-label="備份設定" title="備份設定"
            onClick={() => { if (!navigationLockedRef.current) backups(); }}><IconCloud size={18} /></button>
          {!settingsView && <PageMenu key={page.id} page={page} disabled={busy || navigationLocked} history={!!pageHistory} onAction={pageAction} onOpenChange={setPageMenuOpen} />}
        </div>
      </header>
      <div className={"pn-document-shell document-shell" + (settingsView ? " pn-settings-shell" : databaseView ? " pn-database-shell" : "")}>{children}</div>
    </main>
    <Modal returnFocus={false} onExitTransitionEnd={() => {
      // 換頁後若新頁已取得焦點，不搶回原頁的觸發點。
      const settled = document.activeElement && document.activeElement !== document.body;
      if (!panel && !settled) (trigger.current?.isConnected ? trigger.current : document.querySelector<HTMLButtonElement>('button[aria-label="導覽"]'))?.focus();
    }} opened={!!panel} onClose={() => setPanel("")} title={panelTitle}
      size={panel === "search" ? 600 : panel === "delete" ? 420 : 460}
      centered={panel === "delete"}
      className={"pn-dialog pn-dialog-" + panel} padding={20} radius={8}
      closeButtonProps={{ "aria-label": "關閉" + panelTitle }}>
      <Stack gap={16}>
        {failure && <Alert color="red" role="alert">{failure}</Alert>}
        {panel === "search" && <>
          <form onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const response = await api("/api/search?q=" + encodeURIComponent(query));
              if (!response.ok) throw new Error("搜尋失敗，請重試");
              setResults((await response.json()) as PageInfo[]);
              setSearched(true);
            });
          }}>
            <div className="pn-inline-form">
              <TextInput data-autofocus type="search" label="搜尋文字" placeholder="搜尋標題或內容…" value={query} required
                onChange={(event) => { setQuery(event.target.value); setSearched(false); }} leftSection={<IconSearch size={18} />} />
              <Button type="submit" loading={busy} disabled={navigationLocked}>搜尋</Button>
            </div>
          </form>
          {searched ? <section aria-label="搜尋結果" className="pn-result-list">
            <div className="pn-list-caption">{results.length} 個搜尋結果</div>
            {!results.length ? <div className="pn-empty-state"><IconSearch size={28} stroke={1.4} /><Text>沒有符合的頁面</Text><Text size="sm" c="dimmed">試試其他關鍵字。</Text></div>
              : results.map((item) => <a key={item.id} className="pn-result-row" href={navigationLocked ? undefined : "/?page=" + item.id} role="link" aria-disabled={navigationLocked || undefined} tabIndex={navigationLocked ? -1 : undefined} aria-label={item.title} onClick={(event) => link(event, item.id)}>
                {item.kind === "journal" ? <IconCalendar size={19} /> : item.database_config ? <IconDatabase size={19} /> : <IconFileText size={19} />}
                <div><span className="pn-result-title">{item.title}</span><span className="pn-result-summary">{item.summary || "開啟頁面"}</span></div>
                <IconArrowRight size={16} className="pn-result-arrow" />
              </a>)}
          </section> : <div className="pn-search-help"><IconSearch size={26} stroke={1.4} /><Text size="sm">搜尋你的筆記與日記</Text><Text size="xs" c="dimmed">可搜尋標題及已同步的內容</Text></div>}
          <div className="pn-dialog-footer"><span><kbd>Esc</kbd> 關閉</span><span><kbd>Enter</kbd> 搜尋</span></div>
        </>}
        {panel === "journals" && <>
          <form onSubmit={(event) => {
            event.preventDefault();
            void run(async () => { const journal = await request("/api/journal", { date }); if (journal) await navigate(journal.id); });
          }}>
            <div className="pn-inline-form">
              <TextInput type="date" label="日記日期" required value={date} onChange={(event) => setDate(event.target.value)} />
              <Button type="submit" loading={busy} disabled={navigationLocked}>開啟日期日記</Button>
            </div>
          </form>
          <div className="pn-panel-section">
            <form onSubmit={(event) => { event.preventDefault(); void run(() => loadMonth(month)); }}>
              <div className="pn-inline-form">
                <TextInput type="month" label="日記月份" required value={month} onChange={(event) => setMonth(event.target.value)} />
                <Button variant="default" type="submit" loading={busy} disabled={navigationLocked}>查看月份</Button>
              </div>
            </form>
          </div>
          <section aria-label="月份日記" className="pn-result-list">
            <div className="pn-list-caption">{month.replace("-", " 年 ")} 月 · {journals.length} 篇日記</div>
            {journals.length ? journals.map((item) => <a key={item.id} className="pn-journal-row" href={navigationLocked ? undefined : "/?page=" + item.id} role="link" aria-disabled={navigationLocked || undefined} tabIndex={navigationLocked ? -1 : undefined}
              onClick={(event) => link(event, item.id)}>
              <span className="pn-journal-day" aria-hidden="true">{item.journal_date?.slice(8)}</span>
              <span className="pn-journal-title">{item.title === item.journal_date ? item.title : item.journal_date + " " + item.title}</span>
              <IconChevronRight size={15} />
            </a>) : <div className="pn-empty-state"><IconCalendar size={28} stroke={1.4} /><Text size="sm">這個月還沒有日記</Text><Text size="xs" c="dimmed">選擇日期，開始記錄。</Text></div>}
          </section>
        </>}
        {panel === "trash" && <section aria-label="垃圾桶內容">
          <Text size="sm" c="dimmed" mb={16}>已刪除的頁面會保留在這裡，隨時可以還原。</Text>
          {notice && <Alert color="gray" role="status" mb={12}>{notice}</Alert>}
          {!trash.length && <div className="pn-empty-state"><IconTrash size={30} stroke={1.4} /><Text fw={500}>垃圾桶是空的</Text></div>}
          <div className="pn-trash-list">{trash.map((item) => <div className="pn-trash-row" key={item.id}>
            <IconFileText size={18} /><Text lineClamp={2} className="trash-title">{item.title}</Text>
            <Button variant="default" disabled={busy || navigationLocked} aria-label={"還原 " + item.title} onClick={() => {
              setNotice("");
              void run(async () => {
                await request(`/api/pages/${item.id}/restore`, {});
                setNotice(`已還原「${item.title}」`);
                await refresh();
                await loadTrash();
              });
            }}>還原</Button>
          </div>)}</div>
        </section>}
        {panel === "rename" && <>
          <form onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await saveDraft();
              const updated = await request(`/api/pages/${actionPage.id}/title`, { title });
              await updatePage(updated);
            });
          }}>
            <Stack gap={10}>
              <TextInput data-autofocus label="頁面標題" maxLength={200} required value={title} onChange={(event) => setTitle(event.target.value)} />
              <Group justify="end"><Button type="submit" loading={busy} disabled={navigationLocked}>儲存標題</Button></Group>
            </Stack>
          </form>
        </>}
        {panel === "move" && <>
            <Text size="sm" truncate title={actionPage.title}>{actionPage.title}</Text>
            <form onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await saveDraft();
                const moved = await request(`/api/pages/${actionPage.id}/move`, { parent_id: parent || null });
                await updatePage(moved);
              });
            }}>
              <div className="pn-inline-form">
                <NativeSelect label="移動至上層" value={parent} onChange={(event) => setParent(event.target.value)}
                  data={[{ value: "", label: "最上層" }, ...parents(null)]} />
                <Button variant="default" type="submit" loading={busy} disabled={navigationLocked}>移動頁面</Button>
              </div>
            </form>
        </>}
        {panel === "delete" && <>
          <div className="pn-delete-copy"><IconTrash size={24} stroke={1.5} /><Text size="sm">
            「{actionPage.title}」會移到垃圾桶，之後可以還原。{actionPage.kind === "note" && "子頁面也會一起隱藏。"}
          </Text></div>
          <Group justify="end" gap={8} mt={8}>
            <Button variant="default" onClick={() => setPanel("")}>取消</Button>
            <Button color="red" loading={busy} disabled={navigationLocked} onClick={() => void run(async () => {
              await saveDraft();
              await request(`/api/pages/${actionPage.id}/delete`, {});
              if (actionPage.id === page.id || page.ancestors?.some((item) => item.id === actionPage.id)) await navigate();
              else { await refresh(); setPanel(""); }
            })}>確認移到垃圾桶</Button>
          </Group>
        </>}
      </Stack>
    </Modal>
  </div>;
}
