import { test, expect } from "@playwright/test";
import { openPrivate, saved } from "./helpers";

test.beforeEach(async ({ request }) => {
  await request.post("/__test/reset");
});

test("UI-CREATE-01：側欄無常駐新增按鈕，鍵盤選單可取消並建立最上層筆記", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  const original = await openPrivate(page);
  await page.locator(".tiptap").fill("新增前保留的正文");
  await saved(page);
  const sidebar = page.getByRole("complementary", { name: "側邊欄" });
  await expect(sidebar.getByRole("button", { name: /^新增(筆記|資料庫)$/ })).toHaveCount(0);
  const trigger = page.getByRole("button", { name: "新增", exact: true });
  const menu = page.getByRole("menu", { name: "新增", exact: true });
  await expect(menu).toBeHidden();
  await trigger.focus();
  await trigger.press("Enter");
  await expect(menu.getByRole("menuitem")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.locator(".tiptap")).toContainText("新增前保留的正文");
  expect(new URL(page.url()).searchParams.get("page")).toBe(original);
  await trigger.press("Enter");
  const item = menu.getByRole("menuitem", { name: "新增筆記", exact: true });
  await expect(item).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "新增資料庫", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(item).toBeFocused();
  await item.press("Enter");
  await expect(page).not.toHaveURL(new RegExp(`page=${original}$`));
  await expect(page.getByTestId("ready")).toHaveText("可編輯");
  const title = page.getByLabel("文件標題", { exact: true });
  await expect(title).toBeFocused();
  expect(await title.evaluate((el: HTMLTextAreaElement) => el.selectionEnd - el.selectionStart)).toBe(3);
  const note = await (await page.request.get("/api/pages/" + new URL(page.url()).searchParams.get("page"))).json();
  expect(note.parent_id).toBeNull();
  expect(note.title).toBe("未命名");
  await page.goBack();
  await expect(page.locator(".tiptap")).toContainText("新增前保留的正文");
});

test("UI-CREATE-02：收合側欄與設定內仍可由頂端選單建立最上層資料庫", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await openPrivate(page);
  await page.getByRole("button", { name: "收合側邊欄", exact: true }).click();
  await page.getByRole("button", { name: "備份設定", exact: true }).click();
  await expect(page.getByRole("heading", { name: "備份設定", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "新增", exact: true }).click();
  await page.getByRole("menuitem", { name: "新增資料庫", exact: true }).click();
  await expect(page.getByTestId("database-ready")).toBeVisible();
  const database = await (await page.request.get("/api/pages/" + new URL(page.url()).searchParams.get("page"))).json();
  expect(database.parent_id).toBeNull();
  expect(database.database_config).toBeTruthy();
  await expect(page.getByRole("menu", { name: "新增", exact: true })).toBeHidden();
  await expect(page.getByRole("heading", { name: "備份設定", exact: true })).toBeHidden();
});

test("UI-CREATE-03：手機導覽無新增按鈕，頂端與選項可觸控且無水平溢出", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openPrivate(page);
  await page.getByRole("button", { name: "導覽", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "導覽", exact: true });
  await expect(drawer.getByRole("button", { name: /^新增(筆記|資料庫)$/ })).toHaveCount(0);
  await page.getByRole("button", { name: "關閉導覽", exact: true }).click();
  const trigger = page.getByRole("button", { name: "新增", exact: true });
  expect((await trigger.boundingBox())!.width).toBeGreaterThanOrEqual(44);
  expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await trigger.click();
  const item = page.getByRole("menuitem", { name: "新增筆記", exact: true });
  expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await item.click();
  await expect(page.getByLabel("文件標題", { exact: true })).toHaveValue("未命名");
  await page.locator(".tiptap").fill("手機新增後繼續寫作");
  await saved(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("UI-CREATE-04：新增失敗保留原頁與正文並可重新開啟選單重試", async ({ page }) => {
  const original = await openPrivate(page);
  await page.locator(".tiptap").fill("失敗也不遺失的草稿");
  await saved(page);
  await page.evaluate(() => {
    const fetch = window.fetch;
    let failed = false;
    window.fetch = async (input, init) => {
      if (!failed && init?.method === "POST" && String(input) === "/api/pages") {
        failed = true;
        return Response.json({ message: "測試新增暫時失敗" }, { status: 503 });
      }
      return fetch(input, init);
    };
  });
  await page.getByRole("button", { name: "新增", exact: true }).click();
  await page.getByRole("menuitem", { name: "新增筆記", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("測試新增暫時失敗");
  expect(new URL(page.url()).searchParams.get("page")).toBe(original);
  await expect(page.locator(".tiptap")).toContainText("失敗也不遺失的草稿");
  await page.getByRole("button", { name: "新增", exact: true }).click();
  await page.getByRole("menuitem", { name: "新增筆記", exact: true }).click();
  await expect(page.getByLabel("文件標題", { exact: true })).toHaveValue("未命名");
});

for (const database of [false, true]) {
  test(`UI-CREATE-05：私人頁面加號可取消並建立最上層${database ? "資料庫" : "筆記"}`, async ({ page, isMobile }) => {
    await openPrivate(page);
    await page.locator(".tiptap").fill("從私人頁面新增前的正文");
    await saved(page);
    if (isMobile) await page.getByRole("button", { name: "導覽", exact: true }).click();
    const navigation = isMobile
      ? page.getByRole("dialog", { name: "導覽", exact: true })
      : page.getByRole("complementary", { name: "側邊欄" });
    const trigger = navigation.locator(".pn-section-label").getByRole("button", { name: "新增私人頁面", exact: true });
    await expect(trigger).toBeVisible();
    await expect(navigation.getByRole("button", { name: /^新增(筆記|資料庫)$/ })).toHaveCount(0);
    if (isMobile) {
      const bounds = (await trigger.boundingBox())!;
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
    }
    const menu = page.getByRole("menu", { name: "新增私人頁面", exact: true });
    await trigger.focus();
    await trigger.press("Enter");
    const noteItem = menu.getByRole("menuitem", { name: "新增筆記", exact: true });
    await expect(noteItem).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(navigation).toBeVisible();
    await expect(page.locator(".tiptap")).toContainText("從私人頁面新增前的正文");
    await trigger.click();
    await expect(menu).toHaveCount(1);
    await menu.getByRole("menuitem", { name: database ? "新增資料庫" : "新增筆記", exact: true }).click();
    if (isMobile) await expect(navigation).toBeHidden();
    if (database) await expect(page.getByTestId("database-ready")).toBeVisible();
    else {
      await expect(page.getByLabel("文件標題", { exact: true })).toHaveValue("未命名");
      await expect(page.getByLabel("文件標題", { exact: true })).toBeFocused();
    }
    const created = await (await page.request.get("/api/pages/" + new URL(page.url()).searchParams.get("page"))).json();
    expect(created.parent_id).toBeNull();
    expect(!!created.database_config).toBe(database);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}
