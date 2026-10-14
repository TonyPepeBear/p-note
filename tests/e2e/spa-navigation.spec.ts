import { test, expect, type Page } from "@playwright/test";
import {
  openPrivate,
  saved,
  showNavigation,
  gate,
  setRule,
  release,
  heldCount,
  trackSockets,
} from "./helpers";
import { origin } from "./ports";

const headers = { Origin: origin };

test.beforeEach(async ({ request }) => {
  await request.post("/__test/reset");
  await request.post("/__test/control", {
    data: { now: Date.now() + 86400000 },
  });
});

async function createNote(page: Page, title: string) {
  const response = await page.request.post("/api/pages", {
    headers,
    data: { title, parent_id: null },
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { id: string }).id;
}

async function openPage(page: Page, id: string) {
  await page.goto("/?page=" + id);
  await expect(page.getByTestId("ready")).toHaveText("可編輯");
  await saved(page);
}

async function setText(page: Page, ...paragraphs: string[]) {
  await page.evaluate((paragraphs) => {
    const editor = window.probe!.editor;
    editor.replaceBlocks(
      editor.document,
      paragraphs.map((content) => ({ type: "paragraph" as const, content })),
    );
  }, paragraphs);
  await saved(page);
}

// 測試用記憶體標記：整頁重新載入後會消失。
const mark = (page: Page) =>
  page.evaluate(() => ((window as unknown as { spaMarker: number }).spaMarker = 1));
const marked = (page: Page) =>
  page.evaluate(() => (window as unknown as { spaMarker?: number }).spaMarker === 1);

async function clickNote(page: Page, title: string) {
  await showNavigation(page);
  await page
    .getByRole("navigation", { name: "筆記頁面" })
    .getByRole("link", { name: title, exact: true })
    .click();
}

async function arrive(page: Page, id: string, title: string) {
  await page.waitForURL((url) => url.searchParams.get("page") === id);
  await expect(page.getByLabel("文件標題", { exact: true })).toHaveValue(title);
  await expect(page.getByTestId("ready")).toHaveText("可編輯");
  await saved(page);
}

test("UX-16：側欄切換頁面不重新載入，只保留一條同步連線", async ({ page }) => {
  const sockets = await trackSockets(page);
  await openPrivate(page);
  const a = await createNote(page, "甲頁");
  const b = await createNote(page, "乙頁");
  await openPage(page, a);
  await setText(page, "甲的內容");
  await mark(page);
  const header = await page.getByRole("navigation", { name: "頁面路徑", exact: true }).elementHandle();
  await clickNote(page, "乙頁");
  await arrive(page, b, "乙頁");
  await expect(page.locator(".tiptap")).not.toContainText("甲的內容");
  expect(await marked(page)).toBe(true);
  expect(await header!.evaluate((element) => element.isConnected)).toBe(true);
  await expect.poll(sockets).toBe(1);
});

test("UX-17：上一頁與下一頁回到對應頁面並還原捲動位置", async ({ page }) => {
  await openPrivate(page);
  const a = await createNote(page, "長頁");
  const b = await createNote(page, "短頁");
  await openPage(page, a);
  await setText(
    page,
    ...Array.from({ length: 80 }, (_, i) => `第 ${i + 1} 段，讓頁面夠長可以捲動。`),
  );
  await page.evaluate(() => window.scrollTo(0, 900));
  await expect.poll(() => page.evaluate(() => Math.round(scrollY))).toBeGreaterThan(400);
  const before = await page.evaluate(() => Math.round(scrollY));
  await clickNote(page, "短頁");
  await arrive(page, b, "短頁");
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await page.goBack();
  await arrive(page, a, "長頁");
  await expect
    .poll(() => page.evaluate(() => Math.round(scrollY)))
    .toBeGreaterThanOrEqual(before - 4);
  expect(await page.evaluate(() => Math.round(scrollY))).toBeLessThanOrEqual(
    before + 4,
  );
  await page.goForward();
  await arrive(page, b, "短頁");
});

test("UX-18：快速連續切換只開啟最後一頁且內容不混用", async ({ page }) => {
  const sockets = await trackSockets(page);
  await openPrivate(page);
  const a = await createNote(page, "甲頁");
  const b = await createNote(page, "乙頁");
  await openPage(page, a);
  await setText(page, "甲的內容");
  await openPage(page, b);
  await setText(page, "乙的內容");
  await page.evaluate(
    async ([a, b]) => {
      for (const id of [a, b, a, b]) {
        document.querySelector<HTMLAnchorElement>(`a.note-link[href="/?page=${id}"]`)!.click();
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    },
    [a, b],
  );
  await arrive(page, b, "乙頁");
  await expect(page.locator(".tiptap")).toContainText("乙的內容");
  await expect(page.locator(".tiptap")).not.toContainText("甲的內容");
  await page.evaluate(() => {
    const editor = window.probe!.editor;
    editor.insertBlocks(
      [{ type: "paragraph", content: "快速切換後的新字" }],
      editor.document.at(-1)!,
      "after",
    );
  });
  await saved(page);
  await expect.poll(sockets).toBe(1);
  await openPage(page, a);
  await expect(page.locator(".tiptap")).toContainText("甲的內容");
  await expect(page.locator(".tiptap")).not.toContainText("快速切換後的新字");
  await openPage(page, b);
  await expect(page.locator(".tiptap")).toContainText("快速切換後的新字");
});

test("UX-19：輸入後立即換頁，修改保留並保存到雲端", async ({
  page,
  browser,
}) => {
  await openPrivate(page);
  const a = await createNote(page, "甲頁");
  const b = await createNote(page, "乙頁");
  await openPage(page, a);
  await page.evaluate(() => {
    const editor = window.probe!.editor;
    editor.updateBlock(editor.document[0], { content: "來不及等確認的字" });
  });
  await clickNote(page, "乙頁");
  await arrive(page, b, "乙頁");
  await page.goBack();
  await arrive(page, a, "甲頁");
  await expect(page.locator(".tiptap")).toContainText("來不及等確認的字");
  const other = await browser.newContext({
    storageState: {
      cookies: (await page.context().storageState()).cookies,
      origins: [],
    },
  });
  try {
    const fresh = await other.newPage();
    await fresh.goto("/?page=" + a);
    await expect(fresh.getByTestId("ready")).toHaveText("可編輯");
    await expect(fresh.locator(".tiptap")).toContainText("來不及等確認的字");
  } finally {
    await other.close();
  }
});

const VERSION = "^/$";
const PAGE_API = "^/api/pages/[^/?]+$";

async function addText(page: Page, text: string) {
  await page.evaluate((text) => {
    const editor = window.probe!.editor;
    editor.insertBlocks(
      [{ type: "paragraph", content: text }],
      editor.document.at(-1)!,
      "after",
    );
  }, text);
  await expect(page.getByTestId("local-status")).toHaveText("本機已儲存");
}

test("UX-20：背景發現新版時先保存草稿再整頁載入最後目標，查詢失敗仍站內切換", async ({
  page,
}) => {
  await openPrivate(page);
  const a = await createNote(page, "甲頁");
  const b = await createNote(page, "乙頁");
  await openPage(page, b);
  await setText(page, "乙的內容");
  await openPage(page, a);
  await gate(page, [{ pattern: VERSION, hold: true, result: "newbuild" }]);
  await mark(page);
  await clickNote(page, "乙頁");
  await expect(page.getByLabel("文件標題", { exact: true })).toHaveValue("乙頁");
  await expect(page.getByTestId("ready")).toHaveText("可編輯");
  expect(await heldCount(page, VERSION)).toBeGreaterThan(0);
  await addText(page, "新版查詢期間的字");
  await release(page, VERSION);
  await expect.poll(() => marked(page).catch(() => true)).toBe(false);
  await arrive(page, b, "乙頁");
  await expect(page.locator(".tiptap")).toContainText("新版查詢期間的字");
  await gate(page, [{ pattern: VERSION, result: "reject" }]);
  await mark(page);
  await clickNote(page, "甲頁");
  await arrive(page, a, "甲頁");
  expect(await marked(page)).toBe(true);
});

test("LFN-01：新版載入前本機保存失敗時保留畫面不重新載入", async ({ page }) => {
  await openPrivate(page);
  const a = await createNote(page, "甲頁");
  const b = await createNote(page, "乙頁");
  await openPage(page, b);
  await openPage(page, a);
  await gate(page, [{ pattern: VERSION, hold: true, result: "newbuild" }]);
  await mark(page);
  await clickNote(page, "乙頁");
  await expect(page.getByLabel("文件標題", { exact: true })).toHaveValue("乙頁");
  await expect(page.getByTestId("ready")).toHaveText("可編輯");
  await addText(page, "保存失敗前的字");
  await page.evaluate(() => {
    IDBDatabase.prototype.transaction = function () {
      throw new DOMException("測試容量不足", "QuotaExceededError");
    };
  });
  await release(page, VERSION);
  await expect(page.getByRole("alert").first()).toContainText("本機儲存失敗");
  await page.waitForTimeout(500);
  expect(await marked(page)).toBe(true);
  await expect(page.locator(".tiptap")).toContainText("保存失敗前的字");
  await expect(page.getByTestId("ready")).toHaveText("可編輯");
});

test("LFN-07：快速換頁時過期的驗證與版本回應不影響最後頁面", async ({ page }) => {
  const sockets = await trackSockets(page);
  await openPrivate(page);
  const a = await createNote(page, "甲頁");
  const b = await createNote(page, "乙頁");
  await openPage(page, a);
  await setText(page, "甲的內容");
  await openPage(page, b);
  await setText(page, "乙的內容");
  await gate(page, [
    { pattern: VERSION, hold: true, result: "newbuild" },
    { pattern: PAGE_API, hold: true },
  ]);
  await page.evaluate(
    async ([a, b]) => {
      for (const id of [a, b, a, b]) {
        document.querySelector<HTMLAnchorElement>(`a.note-link[href="/?page=${id}"]`)!.click();
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    },
    [a, b],
  );
  await expect(page.getByLabel("文件標題", { exact: true })).toHaveValue("乙頁");
  await expect(page.getByTestId("ready")).toHaveText("可編輯");
  await expect(page.locator(".tiptap")).toContainText("乙的內容");
  expect(await heldCount(page, `^/api/pages/${b}$`)).toBeGreaterThan(0);
  await setRule(page, { pattern: `^/api/pages/${a}$`, result: 401 });
  await release(page, `^/api/pages/${b}$`);
  await saved(page);
  await release(page, PAGE_API);
  await page.waitForTimeout(500);
  await expect(page.getByLabel("Email", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("文件標題", { exact: true })).toHaveValue("乙頁");
  await expect(page.getByTestId("ready")).toHaveText("可編輯");
  expect(new URL(page.url()).searchParams.get("page")).toBe(b);
  expect(await sockets()).toBeLessThanOrEqual(1);
  await addText(page, "乙的新字");
  await saved(page);
  await mark(page);
  await release(page, VERSION);
  await expect.poll(() => marked(page).catch(() => true)).toBe(false);
  await arrive(page, b, "乙頁");
  await expect(page.locator(".tiptap")).toContainText("乙的新字");
  await expect.poll(sockets).toBe(1);
  await openPage(page, a);
  await expect(page.locator(".tiptap")).toContainText("甲的內容");
  await expect(page.locator(".tiptap")).not.toContainText("乙的新字");
});
