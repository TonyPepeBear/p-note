import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  ActionIcon,
  Alert,
  Anchor,
  AppShell,
  Badge,
  Box,
  Breadcrumbs,
  Button,
  Divider,
  Drawer,
  Group,
  Modal,
  NativeSelect,
  NavLink,
  Paper,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  IconArrowRight,
  IconCalendar,
  IconCalendarEvent,
  IconChevronRight,
  IconDots,
  IconFileText,
  IconLogout,
  IconMenu2,
  IconPlus,
  IconSearch,
  IconShieldCheck,
  IconTrash,
  IconCloud,
} from "@tabler/icons-react";
import type { PageInfo, PageRow } from "../shared/pages";
import { today } from "../shared/pages";
import { api, navigate, saveDraft } from "./api";
import { Brand } from "./ui";

export function Navigation({
  page,
  changed,
  error,
  backups,
  children,
}: {
  page: PageInfo;
  changed: (page: PageInfo) => void;
  error: (message: string) => void;
  backups: () => void;
  children: ReactNode;
}) {
  const [pages, setPages] = useState<PageRow[]>([]);
  const [trash, setTrash] = useState<PageRow[]>([]);
  const [journals, setJournals] = useState<PageRow[]>([]);
  const [results, setResults] = useState<PageInfo[]>([]);
  const [panel, setPanel] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const [date, setDate] = useState(page.journal_date ?? today(Date.now()));
  const [month, setMonth] = useState(
    (page.journal_date ?? today(Date.now())).slice(0, 7),
  );
  const [title, setTitle] = useState(page.title);
  const [parent, setParent] = useState(page.parent_id ?? "");
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const trigger = useRef<HTMLElement | null>(null);
  const refresh = async () => {
    const response = await api("/api/pages");
    if (!response.ok) throw new Error("無法載入頁面列表");
    setPages((await response.json()) as PageRow[]);
  };
  useEffect(() => {
    void refresh().catch(() => error("無法載入頁面列表，請重新整理"));
  }, []);
  useEffect(() => {
    setTitle(page.title);
    setParent(page.parent_id ?? "");
  }, [page.title, page.parent_id]);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setFailure("");
    error("");
    try {
      await work();
    } catch (e) {
      const message = e instanceof Error ? e.message : "操作失敗，請稍後重試";
      setFailure(message);
      if (!panel) error(message);
    } finally {
      setBusy(false);
    }
  };
  const request = async (path: string, data?: object) => {
    const response = await api(path, data);
    const value = (await response.json()) as PageInfo & {
      message?: string;
      page?: PageInfo;
    };
    if (!response.ok) {
      if (response.status === 409 && value.page) {
        await navigate(value.page.id);
        return;
      }
      throw new Error(value.message ?? "操作失敗，請稍後重試");
    }
    return value;
  };
  const link = (event: MouseEvent<HTMLElement>, id: string) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    void run(() => navigate(id));
  };
  const pageLink = (item: PageRow, label = item.title) => (
    <Anchor
      href={"/?page=" + item.id}
      onClick={(event) => link(event, item.id)}
    >
      {label}
    </Anchor>
  );
  const open = (name: string, target?: HTMLElement) => {
    trigger.current = target ?? (document.activeElement as HTMLElement);
    trigger.current?.focus();
    setPanel(name);
    setNavOpen(false);
    setFailure("");
  };
  const tree = (parentId: string | null, depth = 0): ReactNode =>
    pages
      .filter((item) => item.kind === "note" && item.parent_id === parentId)
      .map((item) => (
        <Box key={item.id} pl={depth ? 16 : 0}>
          <NavLink
            component="a"
            href={"/?page=" + item.id}
            label={item.title}
            leftSection={<IconFileText size={18} />}
            active={item.id === page.id}
            aria-current={item.id === page.id ? "page" : undefined}
            onClick={(event) => link(event, item.id)}
            className="note-link"
          />
          {tree(item.id, depth + 1)}
        </Box>
      ));
  const sidebar = (
    <div className="sidebar-content">
      <div>
        <Text className="eyebrow" mb="sm" c="dimmed">
          我的空間
        </Text>
        <Stack gap={4}>
          <NavLink
            component="button"
            label="今天"
            leftSection={<IconCalendarEvent size={20} />}
            active={
              page.kind === "journal" && page.journal_date === today(Date.now())
            }
            onClick={() => {
              void run(() => navigate());
            }}
          />
          <NavLink
            component="button"
            label="日記"
            leftSection={<IconCalendar size={20} />}
            onClick={(event) => open("journals", event.currentTarget)}
          />
          <Button
            variant="light"
            fullWidth
            leftSection={<IconPlus size={18} />}
            mt="sm"
            disabled={busy}
            onClick={() => {
              void run(async () => {
                const note = await request("/api/pages", {
                  title: "新增筆記",
                  parent_id: null,
                });
                if (note) await navigate(note.id);
              });
            }}
          >
            新增筆記
          </Button>
        </Stack>
        <Divider my="xl" />
        <Group justify="space-between" mb="sm">
          <Text className="eyebrow" c="dimmed">
            筆記
          </Text>
          <Badge color="gray" variant="light" size="sm">
            {pages.filter((item) => item.kind === "note").length}
          </Badge>
        </Group>
      </div>
      <ScrollArea className="notes-scroll" scrollbarSize={4}>
        <nav aria-label="筆記頁面">
          {pages.some((item) => item.kind === "note") ? (
            tree(null)
          ) : (
            <Paper className="sidebar-empty" p="md" radius="md">
              <IconFileText size={24} stroke={1.4} />
              <Text size="sm" mt="xs">
                留一頁給新的想法
              </Text>
              <Text size="xs" c="dimmed" mt={4}>
                點選「新增筆記」開始。
              </Text>
            </Paper>
          )}
        </nav>
      </ScrollArea>
      <div className="sidebar-footer">
        <NavLink
          component="button"
          label="垃圾桶"
          leftSection={<IconTrash size={18} />}
          onClick={() => {
            open("trash");
            void run(async () => {
              const response = await api("/api/trash");
              if (!response.ok) throw new Error("無法載入垃圾桶");
              setTrash((await response.json()) as PageRow[]);
            });
          }}
        />
        <NavLink
          component="button"
          label="登出"
          leftSection={<IconLogout size={18} />}
          onClick={() => {
            void run(async () => {
              await saveDraft();
              const response = await api("/api/logout", {});
              if (!response.ok) throw new Error("登出失敗，請重試");
              location.assign("/");
            });
          }}
        />
        <Group gap={6} mt="md" c="dimmed">
          <IconShieldCheck size={15} />
          <Text size="xs">只有你能存取的私人工作區</Text>
        </Group>
      </div>
    </div>
  );
  const panelTitle =
    (
      {
        search: "搜尋筆記",
        journals: "日記回顧",
        trash: "垃圾桶",
        page: "頁面操作",
        delete: "移到垃圾桶？",
      } as Record<string, string>
    )[panel] ?? "";
  return (
    <AppShell
      header={{ height: 68 }}
      navbar={{ width: 264, breakpoint: "sm", collapsed: { mobile: true } }}
      className="app-shell"
    >
      <AppShell.Header>
        <Group
          h="100%"
          px={{ base: "md", sm: "xl" }}
          justify="space-between"
          wrap="nowrap"
        >
          <Group gap="sm" wrap="nowrap">
            <ActionIcon
              hiddenFrom="sm"
              aria-label="導覽"
              aria-haspopup="dialog"
              aria-expanded={navOpen}
              color="dark"
              onClick={() => setNavOpen(true)}
            >
              <IconMenu2 size={23} />
            </ActionIcon>
            <Brand />
            <Text className="header-caption" size="sm" c="dimmed">
              你的私人筆記空間
            </Text>
          </Group>
          <Group gap={8} wrap="nowrap">
            <Button
              variant="default"
              className="header-search"
              leftSection={<IconSearch size={18} />}
              aria-label="搜尋筆記"
              onClick={(event) => open("search", event.currentTarget)}
            >
              <span>搜尋筆記</span>
            </Button>
            <Button
              variant="subtle"
              color="dark"
              className="header-backup"
              aria-label="備份設定"
              leftSection={<IconCloud size={20} />}
              onClick={backups}
            >
              <span>備份設定</span>
            </Button>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar className="workspace-sidebar" p="lg" visibleFrom="sm">
        {sidebar}
      </AppShell.Navbar>
      <Drawer
        opened={navOpen}
        onClose={() => setNavOpen(false)}
        title="導覽"
        size={300}
        closeButtonProps={{ "aria-label": "關閉導覽" }}
        className="navigation-drawer"
      >
        {sidebar}
      </Drawer>
      <AppShell.Main>
        <div className="document-shell">
          <Group
            justify="space-between"
            className="document-path"
            wrap="nowrap"
          >
            <nav aria-label="頁面路徑">
              <Breadcrumbs separator={<IconChevronRight size={13} />}>
                {page.ancestors?.map((item) => (
                  <span key={item.id}>{pageLink(item)}</span>
                ))}
                <Text size="sm" c="dimmed">
                  {page.kind === "journal" ? "日記" : "筆記"}
                </Text>
                <Text size="sm" truncate maw={220}>
                  {page.title}
                </Text>
              </Breadcrumbs>
            </nav>
            <Button
              variant="subtle"
              color="gray"
              aria-label="頁面操作"
              aria-haspopup="dialog"
              aria-expanded={panel === "page"}
              leftSection={<IconDots size={20} />}
              onClick={(event) => open("page", event.currentTarget)}
            >
              頁面操作
            </Button>
          </Group>
          {children}
        </div>
      </AppShell.Main>
      <Modal
        returnFocus={false}
        onExitTransitionEnd={() => {
          if (!panel)
            (trigger.current?.isConnected
              ? trigger.current
              : document.querySelector<HTMLButtonElement>(
                  'button[aria-label="導覽"]',
                )
            )?.focus();
        }}
        opened={!!panel}
        onClose={() => setPanel("")}
        title={panelTitle}
        size={panel === "delete" ? "sm" : "md"}
        closeButtonProps={{ "aria-label": "關閉" + panelTitle }}
      >
        <Stack gap="lg">
          {failure && (
            <Alert color="red" role="alert">
              {failure}
            </Alert>
          )}
          {panel === "search" && (
            <>
              <Text size="sm" c="dimmed">
                從標題與已同步的內容，找回你的想法。
              </Text>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    const response = await api(
                      "/api/search?q=" + encodeURIComponent(query),
                    );
                    if (!response.ok) throw new Error("搜尋失敗，請重試");
                    setResults((await response.json()) as PageInfo[]);
                    setSearched(true);
                  });
                }}
              >
                <Stack gap="sm">
                  <TextInput
                    autoFocus
                    type="search"
                    label="搜尋文字"
                    placeholder="輸入關鍵字…"
                    value={query}
                    required
                    onChange={(event) => setQuery(event.target.value)}
                    leftSection={<IconSearch size={18} />}
                  />
                  <Button type="submit" loading={busy}>
                    搜尋
                  </Button>
                </Stack>
              </form>
              {searched && (
                <section aria-label="搜尋結果">
                  {!results.length ? (
                    <Text c="dimmed" ta="center" py="xl">
                      沒有符合的頁面
                    </Text>
                  ) : (
                    <Stack gap="xs">
                      {results.map((item) => (
                        <Paper key={item.id} p="md" withBorder>
                          <Group justify="space-between">
                            {pageLink(item)}
                            <IconArrowRight size={16} />
                          </Group>
                          <Text size="sm" c="dimmed" mt={6} lineClamp={2}>
                            {item.summary || "開啟頁面繼續閱讀"}
                          </Text>
                        </Paper>
                      ))}
                    </Stack>
                  )}
                </section>
              )}
            </>
          )}
          {panel === "journals" && (
            <>
              <Text c="dimmed" size="sm">
                回到某一天，或翻閱一整個月的生活。
              </Text>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    const journal = await request("/api/journal", { date });
                    if (journal) await navigate(journal.id);
                  });
                }}
              >
                <Stack gap="sm">
                  <TextInput
                    type="date"
                    label="日記日期"
                    required
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                  />
                  <Button
                    type="submit"
                    loading={busy}
                    leftSection={<IconCalendarEvent size={18} />}
                  >
                    開啟日期日記
                  </Button>
                </Stack>
              </form>
              <Divider label="月份回顧" />
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    const response = await api(
                      "/api/journals?month=" + encodeURIComponent(month),
                    );
                    if (!response.ok) throw new Error("無效月份");
                    setJournals((await response.json()) as PageRow[]);
                  });
                }}
              >
                <Group align="end">
                  <TextInput
                    type="month"
                    label="日記月份"
                    required
                    value={month}
                    onChange={(event) => setMonth(event.target.value)}
                    style={{ flex: 1 }}
                  />
                  <Button variant="light" type="submit" loading={busy}>
                    查看月份
                  </Button>
                </Group>
              </form>
              <section aria-label="月份日記">
                <Stack gap={8}>
                  {journals.map((item) => (
                    <Paper key={item.id} p="sm" withBorder>
                      {pageLink(item, item.journal_date + " " + item.title)}
                    </Paper>
                  ))}
                </Stack>
              </section>
            </>
          )}
          {panel === "trash" && (
            <section aria-label="垃圾桶內容">
              <Text size="sm" c="dimmed" mb="lg">
                移除的頁面仍保留在這裡，可以隨時還原。
              </Text>
              {!trash.length && (
                <Stack align="center" gap="xs" py="xl">
                  <IconTrash size={36} stroke={1.3} />
                  <Title order={3} size="lg">
                    垃圾桶是空的
                  </Title>
                  <Text c="dimmed" size="sm">
                    安心整理，留下需要的內容。
                  </Text>
                </Stack>
              )}
              <Stack>
                {trash.map((item) => (
                  <Paper withBorder p="md" key={item.id}>
                    <Group justify="space-between" wrap="nowrap">
                      <Text lineClamp={2}>{item.title}</Text>
                      <Button
                        variant="light"
                        disabled={busy}
                        onClick={() => {
                          void run(async () => {
                            await request(`/api/pages/${item.id}/restore`, {});
                            await refresh();
                            setTrash(
                              (await (
                                await api("/api/trash")
                              ).json()) as PageRow[],
                            );
                          });
                        }}
                      >
                        還原 {item.title}
                      </Button>
                    </Group>
                  </Paper>
                ))}
              </Stack>
            </section>
          )}
          {panel === "page" && (
            <>
              <Text size="sm" c="dimmed">
                整理這份{page.kind === "journal" ? "日記" : "筆記"}
                的標題與位置。
              </Text>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    const updated = await request(
                      `/api/pages/${page.id}/title`,
                      { title },
                    );
                    if (updated) changed(updated);
                    await refresh();
                    setPanel("");
                  });
                }}
              >
                <Stack gap="sm">
                  <TextInput
                    label="頁面標題"
                    maxLength={200}
                    required
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                  <Button type="submit" loading={busy}>
                    儲存標題
                  </Button>
                </Stack>
              </form>
              {page.kind === "note" && (
                <>
                  <Divider label="頁面階層" />
                  <Button
                    variant="light"
                    leftSection={<IconPlus size={18} />}
                    disabled={busy}
                    onClick={() => {
                      void run(async () => {
                        const child = await request("/api/pages", {
                          title: "新增子頁面",
                          parent_id: page.id,
                        });
                        if (child) await navigate(child.id);
                      });
                    }}
                  >
                    新增子頁面
                  </Button>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run(async () => {
                        const moved = await request(
                          `/api/pages/${page.id}/move`,
                          { parent_id: parent || null },
                        );
                        if (moved) changed(moved);
                        await refresh();
                        setPanel("");
                      });
                    }}
                  >
                    <Stack gap="sm">
                      <NativeSelect
                        label="移動至上層"
                        value={parent}
                        onChange={(event) => setParent(event.target.value)}
                        data={[
                          { value: "", label: "最上層" },
                          ...pages
                            .filter(
                              (item) =>
                                item.kind === "note" && item.id !== page.id,
                            )
                            .map((item) => ({
                              value: item.id,
                              label: item.title,
                            })),
                        ]}
                      />
                      <Button variant="light" type="submit" loading={busy}>
                        移動頁面
                      </Button>
                    </Stack>
                  </form>
                </>
              )}
              <Divider />
              <Button
                color="red"
                variant="light"
                leftSection={<IconTrash size={18} />}
                disabled={busy}
                onClick={() => setPanel("delete")}
              >
                移到垃圾桶
              </Button>
            </>
          )}
          {panel === "delete" && (
            <>
              <Text>
                「{page.title}」會移到垃圾桶，之後可以還原。
                {page.kind === "note" && "子頁面也會一起隱藏。"}
              </Text>
              <Group justify="end">
                <Button variant="default" onClick={() => setPanel("")}>
                  取消
                </Button>
                <Button
                  color="red"
                  loading={busy}
                  onClick={() => {
                    void run(async () => {
                      await saveDraft();
                      await request(`/api/pages/${page.id}/delete`, {});
                      await navigate();
                    });
                  }}
                >
                  確認移到垃圾桶
                </Button>
              </Group>
            </>
          )}
        </Stack>
      </Modal>
    </AppShell>
  );
}
