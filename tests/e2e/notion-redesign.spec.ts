import { test, expect, type Page, type Locator } from "@playwright/test";
import { openPrivate, saved, showNavigation } from "./helpers";
import { origin } from "./ports";

test.beforeEach(async ({ request }) => {
  await request.post("/__test/reset");
});

async function post(page: Page, path: string, data: object) {
  const response = await page.request.post(path, {
    headers: { Origin: origin },
    data,
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

async function noOverflow(page: Page) {
  await expect.poll(() => page.evaluate(
    () => document.documentElement.scrollWidth <= innerWidth + 1,
  )).toBe(true);
}

async function touchTarget(locator: Locator) {
  await expect(locator).toBeVisible();
  const bounds = (await locator.boundingBox())!;
  expect(bounds.height).toBeGreaterThanOrEqual(44);
  expect(bounds.width).toBeGreaterThanOrEqual(44);
}

test("UI-02：收合與展開側邊欄保留目前文件及正在編輯的內容", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  const id = await openPrivate(page);
  const editor = page.locator(".tiptap");
  await editor.click();
  await page.keyboard.type("收合導覽後繼續寫作");
  await saved(page);
  const tree = page.getByRole("navigation", { name: "筆記頁面", exact: true });
  await expect(tree).toBeVisible();
  await page.getByRole("button", { name: "收合側邊欄", exact: true }).click();
  await expect(tree).toBeHidden();
  await expect(editor).toContainText("收合導覽後繼續寫作");
  expect(new URL(page.url()).searchParams.get("page")).toBe(id);
  await page.getByRole("button", { name: "展開側邊欄", exact: true }).click();
  await expect(tree).toBeVisible();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("，也能重新找到頁面");
  await saved(page);
  await page.reload();
  await expect(editor).toContainText("收合導覽後繼續寫作，也能重新找到頁面");
});

test("UI-06：在備份與 API key 設定切換時保留導覽並返回原文件", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  const id = await openPrivate(page);
  const editor = page.locator(".tiptap");
  await editor.click();
  await page.keyboard.type("設定完成後回到這份筆記");
  await saved(page);
  await page.getByRole("button", { name: "備份設定", exact: true }).click();
  await expect(page.getByRole("heading", { name: "備份設定", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "筆記頁面", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await expect(page.getByRole("heading", { name: "API key 設定", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "筆記頁面", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回筆記", exact: true }).click();
  await expect(page.getByTestId("ready")).toHaveText("可編輯");
  expect(new URL(page.url()).searchParams.get("page")).toBe(id);
  await expect(editor).toContainText("設定完成後回到這份筆記");
});

test("UI-02：緊湊中性側欄與無框白色文件讓長頁面清單仍可操作", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await openPrivate(page);
  const notes = [];
  for (let index = 1; index <= 12; index++) {
    notes.push(await post(page, "/api/pages", { title: `工作筆記 ${index}`, parent_id: null }));
  }
  await page.goto("/?page=" + notes[0].id);
  await expect(page.getByTestId("ready")).toHaveText("可編輯");
  const sidebar = page.getByRole("complementary", { name: "側邊欄" });
  const bounds = (await sidebar.boundingBox())!;
  expect(bounds.width).toBeGreaterThanOrEqual(220);
  expect(bounds.width).toBeLessThanOrEqual(256);
  const tree = page.getByRole("navigation", { name: "筆記頁面", exact: true });
  await expect(tree.getByRole("link")).toHaveCount(12);
  const lastNote = tree.getByRole("link", { name: "工作筆記 12", exact: true });
  await expect(lastNote).toBeInViewport();
  const rowHeight = (await lastNote.boundingBox())!.height;
  expect(rowHeight).toBeGreaterThanOrEqual(28);
  expect(rowHeight).toBeLessThanOrEqual(36);
  const colors = await sidebar.evaluate(element => {
    const color = getComputedStyle(element).backgroundColor;
    return color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
  });
  expect(Math.max(...colors) - Math.min(...colors)).toBeLessThanOrEqual(8);
  expect(Math.min(...colors)).toBeGreaterThanOrEqual(240);
  const surface = page.locator(".writing-surface");
  const presentation = await surface.evaluate(element => {
    const style = getComputedStyle(element);
    let background = "";
    for (let node: Element | null = element; node; node = node.parentElement) {
      const color = getComputedStyle(node).backgroundColor;
      if (color !== "transparent" && color !== "rgba(0, 0, 0, 0)") { background = color; break; }
    }
    return { border: style.borderTopWidth, shadow: style.boxShadow, background };
  });
  expect(presentation).toEqual({ border: "0px", shadow: "none", background: "rgb(255, 255, 255)" });
  await lastNote.click();
  await expect(page.getByLabel("文件標題", { exact: true })).toHaveValue("工作筆記 12");
  await expect(tree.getByRole("link", { name: "工作筆記 12", exact: true })).toHaveAttribute("aria-current", "page");
  await page.locator(".tiptap").click();
  await page.keyboard.type("從清單最後一頁開始寫作");
  await saved(page);
  await noOverflow(page);
});

test("UI-02：手機可開關導覽、新增筆記並繼續編輯且操作可觸控", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const original = await openPrivate(page);
  const navigation = page.getByRole("button", { name: "導覽", exact: true });
  await touchTarget(navigation);
  await touchTarget(page.getByRole("button", { name: "頁面操作", exact: true }));
  await navigation.click();
  const drawer = page.getByRole("dialog", { name: "導覽", exact: true });
  await expect(drawer).toBeVisible();
  const create = drawer.getByRole("button", { name: "新增筆記", exact: true });
  await touchTarget(create);
  await create.click();
  await expect(drawer).toBeHidden();
  await expect(page.getByTestId("ready")).toHaveText("可編輯");
  expect(new URL(page.url()).searchParams.get("page")).not.toBe(original);
  await page.getByLabel("文件標題", { exact: true }).fill("手機上完成的筆記");
  await page.getByLabel("文件標題", { exact: true }).press("Enter");
  await page.locator(".tiptap").click();
  await page.keyboard.type("開啟導覽後仍能接續輸入");
  await saved(page);
  await navigation.click();
  const active = drawer.getByRole("link", { name: "手機上完成的筆記", exact: true });
  await touchTarget(active);
  await expect(active).toHaveAttribute("aria-current", "page");
  const close = page.getByRole("button", { name: "關閉導覽", exact: true });
  await touchTarget(close);
  await close.click();
  await expect(drawer).toBeHidden();
  await expect(page.locator(".tiptap")).toContainText("開啟導覽後仍能接續輸入");
  expect((await page.locator(".tiptap").boundingBox())!.y).toBeLessThan(812 * 0.45);
  await noOverflow(page);
});

test("UI-05：資料庫以鍵盤切換檢視、搜尋並新增有正文的筆記", async ({ page }) => {
  test.setTimeout(45000);
  await openPrivate(page);
  const database = await post(page, "/api/databases", { title: "閱讀整理" });
  for (const title of ["閱讀計畫", "週末清單"])
    await post(page, "/api/pages", { title, parent_id: database.id });
  const info = await (await page.request.get("/api/pages/" + database.id)).json();
  await post(page, "/api/databases/" + database.id + "/config", {
    previous: info.database_config,
    generation: info.sync_generation,
    config: {
      properties: [],
      views: [
        { id: "all", name: "全部筆記", layout: "table", columns: ["title"], filters: [], filterMode: "and", sorts: [] },
        { id: "reading", name: "閱讀清單", layout: "list", columns: ["title"], filters: [{ property: "title", operator: "contains", value: "閱讀" }], filterMode: "and", sorts: [] },
      ],
    },
  });
  await page.goto("/?page=" + database.id);
  await expect(page.getByTestId("database-ready")).toBeVisible();
  const tabs = page.getByRole("tablist", { name: "資料庫檢視", exact: true });
  const all = tabs.getByRole("tab", { name: "全部筆記", exact: true });
  const reading = tabs.getByRole("tab", { name: "閱讀清單", exact: true });
  const rows = page.getByTestId("database-row");
  await expect(all).toHaveAttribute("aria-selected", "true");
  await expect(rows).toHaveCount(2);
  await all.focus();
  await page.keyboard.press("ArrowRight");
  await expect(reading).toBeFocused();
  await expect(reading).toHaveAttribute("aria-selected", "true");
  await expect(rows).toHaveText(["閱讀計畫"]);
  const toolbar = page.getByRole("toolbar", { name: "資料庫工具列", exact: true });
  await toolbar.getByLabel("搜尋資料庫筆記", { exact: true }).fill("沒有這個標題");
  await expect(rows).toHaveCount(0);
  await toolbar.getByLabel("搜尋資料庫筆記", { exact: true }).clear();
  await expect(rows).toHaveText(["閱讀計畫"]);
  await all.click();
  await expect(rows).toHaveCount(2);
  await toolbar.getByRole("button", { name: "新增筆記", exact: true }).click();
  await expect(page.getByTestId("ready")).toHaveText("可編輯");
  await page.getByLabel("文件標題", { exact: true }).fill("閱讀心得");
  await page.getByLabel("文件標題", { exact: true }).press("Enter");
  await page.locator(".tiptap").click();
  await page.keyboard.type("從資料庫建立並保存的正文");
  await saved(page);
  await showNavigation(page);
  await page.getByRole("navigation", { name: "筆記頁面", exact: true }).getByRole("link", { name: "閱讀整理", exact: true }).click();
  await expect(page.getByTestId("database-ready")).toBeVisible();
  await reading.click();
  await expect(rows).toHaveCount(2);
  await page.getByTestId("database-rows").getByRole("link", { name: "閱讀心得", exact: true }).click();
  await expect(page.locator(".tiptap")).toContainText("從資料庫建立並保存的正文");
  await noOverflow(page);
});

test("UI-06：設定內選擇另一份筆記能離開設定並保留既有內容", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openPrivate(page);
  const note = await post(page, "/api/pages", { title: "設定之後要處理的筆記", parent_id: null });
  await page.reload();
  await expect(page.getByTestId("ready")).toHaveText("可編輯");
  await page.getByRole("button", { name: "備份設定", exact: true }).click();
  await expect(page.getByRole("heading", { name: "備份設定", exact: true })).toBeVisible();
  await showNavigation(page);
  const drawer = page.getByRole("dialog", { name: "導覽", exact: true });
  await drawer.getByRole("link", { name: note.title, exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("heading", { name: "備份設定", exact: true })).toBeHidden();
  await expect(page.getByLabel("文件標題", { exact: true })).toHaveValue(note.title);
  expect(new URL(page.url()).searchParams.get("page")).toBe(note.id);
  await page.locator(".tiptap").click();
  await page.keyboard.type("從設定返回工作區後可立即編輯");
  await saved(page);
  await page.getByRole("button", { name: "備份設定", exact: true }).click();
  await page.getByRole("button", { name: "返回編輯", exact: true }).click();
  await expect(page.locator(".tiptap")).toContainText("從設定返回工作區後可立即編輯");
  await noOverflow(page);
});
