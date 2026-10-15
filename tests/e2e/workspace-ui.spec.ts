import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { openPrivate, saved } from "./helpers";
import { origin } from "./ports";

test.beforeEach(async ({ request, page }, info) => {
  await request.post("/__test/reset");
  await request.post("/__test/control", {
    data: { now: Date.now() + 86400000 },
  });
  if (info.project.name === "chromium-desktop")
    await page.setViewportSize({ width: 1440, height: 960 });
});
// 只有指定 P_NOTE_UI_STAGE 時才更新文件引用的截圖，平常執行不弄髒版控。
const screenshotDir = process.env.P_NOTE_UI_STAGE
  ? "docs/screenshots/ui"
  : "test-results/screenshots";
async function screenshot(
  page: import("@playwright/test").Page,
  name: string,
  project: string,
) {
  await mkdir(screenshotDir, { recursive: true });
  if (await page.locator(".mantine-Modal-content").isVisible())
    await expect(page.locator(".mantine-Drawer-content")).toBeHidden();
  for (const selector of [
    ".mantine-Modal-content",
    ".mantine-Drawer-content",
  ]) {
    const panel = page.locator(selector);
    if (await panel.isVisible()) {
      await expect(panel).toHaveCSS("opacity", "1");
      await expect(panel).toHaveCSS(
        "transform",
        /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/,
      );
    }
  }
  await page.screenshot({
    path: `${screenshotDir}/${process.env.P_NOTE_UI_STAGE ?? "after"}-${project}-${name}.png`,
    fullPage: true,
    animations: "disabled",
  });
}
async function noOverflow(page: import("@playwright/test").Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}

test("UI-01：登入有清楚用途、唯一主操作與完整狀態", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await screenshot(page, "login", info.project.name);
  await expect(page.getByText("不需要密碼", { exact: false })).toBeVisible();
  await expect(page.locator(".login-card")).toBeVisible();
  await noOverflow(page);
  const button = page.getByRole("button", {
    name: "寄送登入連結",
    exact: true,
  });
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.getByLabel("Email", { exact: true }).fill("owner@example.test");
  await button.click();
  await expect(page.getByRole("status")).toContainText("查看登入郵件");
});

test("UI-02：正文優先、導覽可觸控且手機無水平溢出", async ({
  page,
  isMobile,
}, info) => {
  await openPrivate(page);
  const notes: string[] = [];
  for (const title of ["週末的小旅行", "靈感收集", "閱讀筆記"]) {
    const response = await page.request.post("/api/pages", {
      headers: { Origin: origin },
      data: { title, parent_id: null },
    });
    expect(response.status()).toBe(200);
    notes.push((await response.json()).id);
  }
  await page.goto("/?page=" + notes[0]);
  await saved(page);
  await page.evaluate(() => {
    const editor = window.probe!.editor;
    editor.replaceBlocks(editor.document, [
      { type: "heading", props: { level: 2 }, content: "留一點時間給自己" },
      {
        type: "paragraph",
        content:
          "這週末想搭一班慢車，到海邊走走。帶一本書、一台相機，還有不急著趕路的心情。",
      },
      {
        type: "paragraph",
        content:
          "想把沿途看到的小事記下來：車窗外的稻田、轉角的咖啡店，還有午後的光。",
      },
      { type: "checkListItem", content: "整理想去的地方" },
      { type: "checkListItem", content: "帶上最近在讀的書" },
    ]);
  });
  await saved(page);
  if (isMobile) await page.setViewportSize({ width: 375, height: 812 });
  await screenshot(page, "workspace", info.project.name);
  const editor = page.locator(".tiptap");
  expect((await editor.boundingBox())!.y).toBeLessThan(
    page.viewportSize()!.height * 0.65,
  );
  await expect(
    page.getByRole("button", { name: "頁面操作", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("日記日期", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("圖片檔案", { exact: true })).toHaveCount(0);
  await noOverflow(page);
  if (isMobile) {
    await page.getByRole("button", { name: "導覽", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "導覽", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "導覽", exact: true }).getByRole("button", { name: /^新增(筆記|資料庫)$/ }),
    ).toHaveCount(0);
    await screenshot(page, "navigation", info.project.name);
    await page.getByRole("button", { name: "關閉導覽", exact: true }).click();
  } else
    await expect(
      page.getByRole("navigation", { name: "筆記頁面" }),
    ).toBeVisible();
});

test("UI-03：搜尋與日記以獨立面板呈現，Escape 返回觸發點", async ({
  page,
  isMobile,
}, info) => {
  await openPrivate(page);
  const search = page.getByRole("button", { name: "搜尋筆記", exact: true });
  await search.click();
  await expect(
    page.getByRole("dialog", { name: "搜尋筆記", exact: true }),
  ).toBeVisible();
  await page.getByLabel("搜尋文字", { exact: true }).fill("沒有這個標記");
  await page.getByRole("button", { name: "搜尋", exact: true }).click();
  await expect(page.getByText("沒有符合的頁面", { exact: true })).toBeVisible();
  await screenshot(page, "search", info.project.name);
  await page.getByLabel("搜尋文字", { exact: true }).press("Escape");
  await expect(search).toBeFocused();
  if (isMobile)
    await page.getByRole("button", { name: "導覽", exact: true }).click();
  await page.getByRole("button", { name: "日記", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "日記回顧", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("日記日期", { exact: true })).toBeVisible();
  await screenshot(page, "journal", info.project.name);
});

test("UI-04：頁面操作有明確範圍，移到垃圾桶可取消", async ({ page }, info) => {
  const id = await openPrivate(page);
  await page.getByRole("button", { name: "頁面操作", exact: true }).click();
  await expect(
    page.getByRole("menu", { name: "頁面操作", exact: true }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "重新命名", exact: true }).click();
  await page.getByLabel("頁面標題", { exact: true }).fill("介面驗證日記");
  await page.getByRole("button", { name: "儲存標題", exact: true }).click();
  await expect(page.getByLabel("文件標題", { exact: true })).toHaveValue(
    "介面驗證日記",
  );
  await page.getByRole("button", { name: "頁面操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "移到垃圾桶", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "移到垃圾桶？",
    exact: true,
  });
  await expect(dialog).toContainText("介面驗證日記");
  await screenshot(page, "delete-confirmation", info.project.name);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  expect((await page.request.get("/api/pages/" + id)).status()).toBe(200);
});

test("UI-05：圖片工具在面板內，關閉後正文可持續保存", async ({
  page,
}, info) => {
  await openPrivate(page);
  await page.getByRole("button", { name: "插入圖片", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "圖片上傳", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("圖片檔案", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "圖片檔案", exact: true }),
  ).toContainText("選擇圖片檔案");
  await expect(
    page.getByRole("button", { name: "上傳圖片", exact: true }),
  ).toBeDisabled();
  await screenshot(page, "image-upload", info.project.name);
  await page.getByRole("button", { name: "關閉圖片上傳", exact: true }).click();
  await page.locator(".tiptap").fill("關閉工具後仍能寫作");
  await saved(page);
  await noOverflow(page);
});

test("UI-06：備份有空狀態、成功卡片與安全還原", async ({
  page,
  isMobile,
}, info) => {
  await openPrivate(page);
  await page.getByRole("button", { name: "備份設定", exact: true }).click();
  await expect(page.getByText("還沒有備份", { exact: true })).toBeVisible();
  await screenshot(page, "backup-empty", info.project.name);
  await page.getByRole("button", { name: "建立備份", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "下載 ZIP", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "選擇還原", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "覆蓋還原", exact: true }),
  ).toBeDisabled();
  await screenshot(page, "backup-restore", info.project.name);
});
