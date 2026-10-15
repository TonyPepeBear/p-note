import { expect, test, type Page } from "@playwright/test";
import { openPrivate, saved, showNavigation } from "./helpers";
import { origin } from "./ports";

test.beforeEach(async ({ request }) => { await request.post("/__test/reset"); });

async function create(page: Page, title: string, parent_id: string | null = null, database = false) {
  const response = await page.request.post(database ? "/api/databases" : "/api/pages", {
    headers: { Origin: origin }, data: { title, parent_id },
  });
  expect(response.ok()).toBe(true);
  return response.json() as Promise<{ id: string }>;
}

const menu = (page: Page) => page.getByRole("menu", { name: /^頁面操作/ });
const item = (page: Page, name: string) => menu(page).getByRole("menuitem", { name, exact: true });

async function sidebarMenu(page: Page, title: string, right = false) {
  await showNavigation(page);
  const drawer = page.locator(".mantine-Drawer-content");
  if (await drawer.isVisible()) {
    await expect(drawer).toHaveCSS("transform", /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
  }
  const row = page.getByRole("navigation", { name: "筆記頁面" })
    .getByRole("link", { name: title, exact: true }).locator("..");
  if (right) await row.click({ button: "right" });
  else await row.getByRole("button", { name: "頁面操作：" + title, exact: true }).click();
  await expect(menu(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

test("UI-04：右上角為動作列表，鍵盤、Escape、外部點擊與日記操作可用", async ({ page }) => {
  await openPrivate(page);
  const trigger = page.getByRole("button", { name: "頁面操作", exact: true });
  await trigger.focus();
  await trigger.press("Enter");
  await expect(menu(page)).toBeVisible();
  await expect(page.getByRole("dialog", { name: "頁面操作", exact: true })).toHaveCount(0);
  await expect(item(page, "新增子頁面")).toHaveCount(0);
  await expect(item(page, "移動頁面")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(menu(page)).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.locator(".pn-current-page").click();
  await expect(menu(page)).toBeHidden();
  await trigger.click();
  await item(page, "重新命名").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "重新命名頁面", exact: true })).toBeVisible();
  await page.getByLabel("頁面標題", { exact: true }).fill("選單改名日記");
  await page.getByRole("button", { name: "儲存標題", exact: true }).click();
  await expect(page.getByLabel("文件標題", { exact: true })).toHaveValue("選單改名日記");
});

test("UI-04：側欄點擊與右鍵操作其他頁面，取消與刪除不影響目前正文", async ({ page }) => {
  // 此流程包含重新命名與兩次刪除面板往返；每步斷言仍維持原本 5 秒。
  test.setTimeout(45_000);
  const current = await openPrivate(page);
  const target = await create(page, "側欄目標");
  await page.reload();
  await saved(page);
  await page.locator(".tiptap").fill("保留目前文件正文");
  await saved(page);
  await sidebarMenu(page, "側欄目標");
  const sideTrigger = page.getByRole("button", { name: "頁面操作：側欄目標", exact: true });
  if (test.info().project.name !== "chromium-desktop") {
    const box = (await sideTrigger.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await page.keyboard.press("Escape");
  await expect(menu(page)).toBeHidden();
  await expect(sideTrigger).toBeFocused();
  await sideTrigger.press("Enter");
  await expect(menu(page)).toBeVisible();
  expect(new URL(page.url()).searchParams.get("page")).toBe(current);
  await item(page, "重新命名").click();
  await page.getByLabel("頁面標題", { exact: true }).fill("目標已改名");
  await page.getByRole("button", { name: "儲存標題", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "重新命名頁面", exact: true })).toBeHidden();
  expect((await (await page.request.get("/api/pages/" + target.id)).json()).title).toBe("目標已改名");
  await sidebarMenu(page, "目標已改名", true);
  await item(page, "移到垃圾桶").click();
  const confirm = page.getByRole("dialog", { name: "移到垃圾桶？", exact: true });
  await expect(confirm).toContainText("目標已改名");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  expect((await page.request.get("/api/pages/" + target.id)).status()).toBe(200);
  await sidebarMenu(page, "目標已改名", true);
  await item(page, "移到垃圾桶").click();
  await page.getByRole("button", { name: "確認移到垃圾桶", exact: true }).click();
  await expect(confirm).toBeHidden();
  expect((await page.request.get("/api/pages/" + target.id)).status()).toBe(409);
  expect(new URL(page.url()).searchParams.get("page")).toBe(current);
  await expect(page.locator(".tiptap")).toContainText("保留目前文件正文");
});

test("UI-04：側欄移動排除目標與後代，失敗可重試且目前文件不變", async ({ page }) => {
  const current = await openPrivate(page);
  const target = await create(page, "待移動");
  await create(page, "後代", target.id);
  const parent = await create(page, "新上層");
  await page.reload();
  await saved(page);
  await sidebarMenu(page, "待移動", true);
  await item(page, "移動頁面").click();
  const select = page.getByLabel("移動至上層", { exact: true });
  await expect(select.locator("option")).toHaveText(["最上層", "新上層"]);
  await select.selectOption(parent.id);
  await page.evaluate(id => {
    const original = window.fetch;
    let fail = true;
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (fail && url.pathname === `/api/pages/${id}/move`) {
        fail = false;
        return Response.json({ message: "測試移動失敗" }, { status: 500 });
      }
      return original(input, init);
    };
  }, target.id);
  await page.getByRole("button", { name: "移動頁面", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("測試移動失敗");
  await page.getByRole("button", { name: "移動頁面", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "移動頁面", exact: true })).toBeHidden();
  expect((await (await page.request.get("/api/pages/" + target.id)).json()).parent_id).toBe(parent.id);
  expect(new URL(page.url()).searchParams.get("page")).toBe(current);
});

for (const database of [false, true]) {
  test(`UI-04：側欄新增子${database ? "資料庫" : "頁面"}使用所選上層`, async ({ page }) => {
    const current = await openPrivate(page);
    const target = await create(page, "選定上層");
    await page.reload();
    await saved(page);
    await sidebarMenu(page, "選定上層");
    await item(page, database ? "新增子資料庫" : "新增子頁面").click();
    await page.waitForURL(url => url.searchParams.get("page") !== null && url.searchParams.get("page") !== current && url.pathname === "/");
    await expect.poll(async () => {
      const id = new URL(page.url()).searchParams.get("page");
      return (await (await page.request.get("/api/pages/" + id)).json()).parent_id;
    }).toBe(target.id);
    // 網址先更新，等新文件掛載後再開手機導覽，避免換頁 effect 將抽屜關閉。
    if (database) await expect(page.getByTestId("database-ready")).toBeVisible();
    else {
      await expect(page.getByLabel("文件標題", { exact: true })).toHaveValue("未命名");
      await expect(page.getByTestId("ready")).toHaveText("可編輯");
    }
    await sidebarMenu(page, database ? "未命名資料庫" : "未命名");
    await expect(item(page, "新增子資料庫")).toHaveCount(database ? 0 : 1);
  });
}

test("UI-04：管理祖先會更新路徑，刪除祖先安全離開目前子頁", async ({ page }) => {
  await openPrivate(page);
  const parent = await create(page, "原祖先");
  const child = await create(page, "目前子頁", parent.id);
  await page.goto("/?page=" + child.id);
  await saved(page);
  await sidebarMenu(page, "原祖先");
  await item(page, "重新命名").click();
  await page.getByLabel("頁面標題", { exact: true }).fill("更新祖先");
  await page.getByRole("button", { name: "儲存標題", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "頁面路徑" })).toContainText("更新祖先");
  await sidebarMenu(page, "更新祖先", true);
  await item(page, "移到垃圾桶").click();
  await page.getByRole("button", { name: "確認移到垃圾桶", exact: true }).click();
  await page.waitForURL(url => url.searchParams.get("page") !== child.id);
  await expect(page.getByTestId("ready")).toHaveText("可編輯");
});

test("UI-04：長標題選單保持在視窗內，右鍵取消焦點返回該列", async ({ page, isMobile }) => {
  await openPrivate(page);
  const title = "長標題".repeat(60);
  await create(page, title);
  await page.reload();
  await saved(page);
  await showNavigation(page);
  const trigger = page.getByRole("button", { name: "頁面操作：" + title, exact: true });
  if (isMobile) await trigger.tap();
  else await trigger.click();
  await expect(menu(page)).toBeVisible();
  const box = (await menu(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.keyboard.press("Escape");
  await sidebarMenu(page, title, true);
  await page.keyboard.press("Escape");
  await expect(menu(page)).toBeHidden();
  await expect(trigger).toBeFocused();
});
