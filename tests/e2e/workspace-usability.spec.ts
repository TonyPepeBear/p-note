import { test, expect, type Page } from "@playwright/test";
import {
  blocks,
  openPageActions,
  openPrivate,
  saved,
  showNavigation,
} from "./helpers";
import { origin } from "./ports";

const headers = { Origin: origin };

test.beforeEach(async ({ request }) => {
  await request.post("/__test/reset");
  await request.post("/__test/control", {
    data: { now: Date.now() + 86400000 },
  });
});

async function createNote(page: Page, title: string, parent: string | null) {
  const response = await page.request.post("/api/pages", {
    headers,
    data: { title, parent_id: parent },
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { id: string }).id;
}

async function openPage(page: Page, id: string) {
  await page.goto("/?page=" + id);
  await expect(page.getByTestId("ready")).toHaveText("可編輯");
  await saved(page);
}

async function closeDrawer(page: Page) {
  // 抽屜開啟時 header 會被 aria-hidden，需用 CSS 定位導覽按鈕判斷狀態。
  const trigger = page.locator('button[aria-label="導覽"]');
  if (
    !(await trigger.isVisible()) ||
    (await trigger.getAttribute("aria-expanded")) !== "true"
  )
    return;
  const drawer = page.getByRole("dialog", { name: "導覽", exact: true });
  await drawer.getByRole("button", { name: "關閉導覽", exact: true }).click();
  await expect(drawer).toBeHidden();
}

// WebKit 的 page.route 攔不到受 Service Worker 控制頁面的請求，改在頁面內包裝 fetch。
async function failFetch(page: Page, pattern: RegExp, body: object = {}) {
  const install = ([source, payload]: [string, string]) => {
    const original = window.fetch;
    window.fetch = (input, init) => {
      const request = input instanceof Request ? input : undefined;
      const url = new URL(
        request?.url ?? (input instanceof URL ? input.href : String(input)),
        location.href,
      );
      const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
      if (new RegExp(source).test(method + " " + url.pathname))
        return Promise.resolve(
          new Response(payload, {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
        );
      return original(input, init);
    };
  };
  const args: [string, string] = [pattern.source, JSON.stringify(body)];
  await page.addInitScript(install, args);
  await page.evaluate(install, args);
}

const titleInput = (page: Page) => page.getByLabel("文件標題", { exact: true });

const apiTitle = async (page: Page, id: string) =>
  ((await (await page.request.get("/api/pages/" + id)).json()) as {
    title: string;
  }).title;

test("UX-01：連續輸入時保存狀態列不跳動、不出現重試", async ({ page }) => {
  await openPrivate(page);
  await expect(page.getByTestId("save-announcer")).toHaveCount(1);
  await page.evaluate(() => {
    const target = document.querySelector(".save-status")!;
    const live = document.querySelector("[data-testid=save-announcer]")!;
    const record = { heights: [] as number[], retry: 0, announcements: 0 };
    (window as unknown as { uxRecord: typeof record }).uxRecord = record;
    new ResizeObserver(() => {
      const height = Math.round(target.getBoundingClientRect().height);
      if (!record.heights.includes(height)) record.heights.push(height);
    }).observe(target);
    new MutationObserver(() => {
      if (
        [...document.querySelectorAll("button")].some(
          (button) => button.textContent?.trim() === "重試儲存",
        )
      )
        record.retry++;
    }).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    new MutationObserver(() => record.announcements++).observe(live, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  await page.locator(".tiptap").click();
  await page.keyboard.type("連續輸入二十個字元不應讓狀態列閃動或跳出重試", {
    delay: 40,
  });
  await saved(page);
  const record = await page.evaluate(
    () =>
      (
        window as unknown as {
          uxRecord: { heights: number[]; retry: number; announcements: number };
        }
      ).uxRecord,
  );
  expect(record.retry).toBe(0);
  expect(record.heights.length).toBeLessThanOrEqual(1);
  expect(record.announcements).toBeLessThanOrEqual(3);
  await expect(page.locator(".save-status [aria-live]")).toHaveCount(1);
});

test("UX-02：雲端失敗與離線顯示非成功圖示與重試", async ({ page }) => {
  await openPrivate(page);
  const room = await page.evaluate(() => window.probe!.room);
  const control = (fail: boolean) =>
    page.request.post("/__test/storage-failure", { data: { room, fail } });
  const retry = page.getByRole("button", { name: "重試儲存", exact: true });
  const indicator = page.locator(".cloud-indicator");
  try {
    await control(true);
    await page.evaluate(() =>
      window.probe!.editor.updateBlock(window.probe!.editor.document[0], {
        content: "故障中",
      }),
    );
    await expect(indicator).toHaveAttribute("data-state", "failed");
    await expect(retry).toBeVisible();
    await control(false);
    await retry.click();
    await saved(page);
    await expect(indicator).toHaveAttribute("data-state", "saved");
    await expect(retry).toBeHidden();
    await page.context().setOffline(true);
    await page.evaluate(() =>
      window.probe!.editor.updateBlock(window.probe!.editor.document[0], {
        content: "離線中",
      }),
    );
    await expect(indicator).toHaveAttribute("data-state", "offline");
    await expect(retry).toBeVisible();
    await page.context().setOffline(false);
    await saved(page);
    await expect(indicator).toHaveAttribute("data-state", "saved");
    await expect(retry).toBeHidden();
  } finally {
    await control(false);
    await page.context().setOffline(false);
  }
});

test("UX-03：標題可直接編輯，Enter 保存、Escape 取消", async ({ page }) => {
  await openPrivate(page);
  const id = await createNote(page, "原始標題", null);
  await openPage(page, id);
  const input = titleInput(page);
  await expect(input).toHaveValue("原始標題");
  await expect(page.locator(".document-heading")).toContainText("筆記");
  await input.click();
  await input.fill("取消的名稱");
  await input.press("Escape");
  await expect(input).toHaveValue("原始標題");
  expect(await apiTitle(page, id)).toBe("原始標題");
  await input.click();
  await input.fill("直接改好的標題");
  await input.press("Enter");
  await expect.poll(() => apiTitle(page, id)).toBe("直接改好的標題");
  await expect(
    page.getByRole("navigation", { name: "頁面路徑" }),
  ).toContainText("直接改好的標題");
  await expect(page).toHaveTitle(/直接改好的標題/);
  await showNavigation(page);
  await expect(
    page
      .getByRole("navigation", { name: "筆記頁面" })
      .getByRole("link", { name: "直接改好的標題", exact: true }),
  ).toBeVisible();
  await closeDrawer(page);
  await page.reload();
  await expect(titleInput(page)).toHaveValue("直接改好的標題");
});

test("UX-04：空白、過長或失敗的標題恢復原值並說明", async ({ page }) => {
  await openPrivate(page);
  const id = await createNote(page, "保留的標題", null);
  await openPage(page, id);
  const input = titleInput(page);
  await input.fill("");
  await page.locator(".tiptap").click();
  await expect(input).toHaveValue("保留的標題");
  await expect(page.getByRole("alert")).toContainText("標題");
  await input.fill("長".repeat(201));
  await input.press("Enter");
  await expect(input).toHaveValue("保留的標題");
  await expect(page.getByRole("alert")).toContainText("200");
  await failFetch(page, /^POST \/api\/pages\/[^/]+\/title$/, {
    message: "伺服器暫時無法保存標題",
  });
  await input.fill("不會保存的標題");
  await input.press("Enter");
  await expect(input).toHaveValue("保留的標題");
  await expect(page.getByRole("alert")).toContainText("伺服器暫時無法保存標題");
  expect(await apiTitle(page, id)).toBe("保留的標題");
});

test("UX-05：新筆記與子頁面以未命名建立並可立即輸入標題", async ({
  page,
}) => {
  await openPrivate(page);
  await showNavigation(page);
  const today = new URL(page.url()).searchParams.get("page");
  await page.getByRole("button", { name: "新增筆記", exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get("page") !== today);
  await expect(page.getByTestId("ready")).toHaveText("可編輯");
  const parent = new URL(page.url()).searchParams.get("page")!;
  expect(new URL(page.url()).searchParams.get("new")).toBeNull();
  expect(await apiTitle(page, parent)).toBe("未命名");
  const input = titleInput(page);
  await expect(input).toBeFocused();
  expect(
    await input.evaluate(
      (element: HTMLTextAreaElement) =>
        element.selectionEnd - element.selectionStart,
    ),
  ).toBe("未命名".length);
  await page.keyboard.type("我的新筆記");
  await page.keyboard.press("Enter");
  await expect.poll(() => apiTitle(page, parent)).toBe("我的新筆記");
  await openPageActions(page);
  await page.getByRole("menuitem", { name: "新增子頁面", exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get("page") !== parent);
  await expect(page.getByTestId("ready")).toHaveText("可編輯");
  const child = new URL(page.url()).searchParams.get("page")!;
  const info = await (await page.request.get("/api/pages/" + child)).json();
  expect(info.title).toBe("未命名");
  expect(info.parent_id).toBe(parent);
  await expect(titleInput(page)).toBeFocused();
  await page.reload();
  await expect(page.getByTestId("ready")).toHaveText("可編輯");
  await expect(titleInput(page)).not.toBeFocused();
});

async function prepareBlocks(page: Page) {
  await page.evaluate(() => {
    const editor = window.probe!.editor;
    editor.replaceBlocks(editor.document, [
      { id: "a", type: "paragraph", content: "甲" },
      { id: "b", type: "paragraph", content: "乙" },
      { id: "c", type: "paragraph", content: "丙" },
      { id: "d", type: "paragraph", content: "丁" },
    ]);
    editor.setTextCursorPosition("d", "end");
  });
}

test("UX-06：區塊選單可連續上移並標示目前區塊", async ({ page }, info) => {
  await openPrivate(page);
  await prepareBlocks(page);
  const trigger = page.getByRole("button", { name: "區塊操作", exact: true });
  if (info.project.use.hasTouch) await trigger.tap();
  else {
    await trigger.focus();
    await page.keyboard.press("Enter");
  }
  const menu = page.getByRole("menu", { name: "區塊操作" });
  const surface = page.locator(".writing-surface");
  await expect(menu).toBeVisible();
  await expect(surface).toHaveAttribute("data-active-block", "d");
  const up = page.getByRole("menuitem", { name: "上移區塊", exact: true });
  for (let i = 0; i < 3; i++) {
    if (info.project.use.hasTouch) await up.tap();
    else await up.click();
    await expect(menu).toBeVisible();
  }
  expect((await blocks(page)).map((block) => block.id)).toEqual([
    "d",
    "a",
    "b",
    "c",
  ]);
  await expect(surface).toHaveAttribute("data-active-block", "d");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(page.locator(".tiptap")).toBeFocused();
  await expect(surface).not.toHaveAttribute("data-active-block", /.+/);
});

test("UX-07：刪除區塊可復原，非程式碼區塊停用複製", async ({ page }) => {
  await openPrivate(page);
  await prepareBlocks(page);
  await saved(page);
  // Yjs UndoManager 會合併 500 ms 內的連續變更，間隔開才代表使用者的獨立操作。
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "區塊操作", exact: true }).click();
  const menu = page.getByRole("menu", { name: "區塊操作" });
  await expect(page.getByRole("menuitem", { name: "複製程式碼" })).toBeDisabled();
  await expect(menu).toContainText("游標放在程式碼區塊");
  await page.getByRole("menuitem", { name: "刪除區塊", exact: true }).click();
  await expect(menu).toBeHidden();
  expect((await blocks(page)).map((block) => block.id)).toEqual([
    "a",
    "b",
    "c",
  ]);
  await expect(page.locator(".tiptap")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () => (await blocks(page)).map((block) => block.id))
    .toEqual(["a", "b", "c", "d"]);
});

const jargon = /世代|隔離|確認格式錯誤/;

test("UX-08：隔離與錯誤提示使用易懂文字並正確分隔", async ({
  page,
  browser,
}) => {
  const id = await openPrivate(page);
  await expect(page.locator("body")).not.toContainText(
    /PERSONAL NOTE|DAILY JOURNAL/,
  );
  await page.evaluate(() =>
    window.probe!.provider.emit("custom-message", ["不是 JSON"]),
  );
  await expect(page.locator(".cloud-indicator")).toHaveAttribute(
    "data-state",
    "failed",
  );
  await expect(page.getByTestId("cloud-status")).not.toHaveText(jargon);
  await page.evaluate(() =>
    window.probe!.editor.replaceBlocks(window.probe!.editor.document, [
      { type: "paragraph", content: "雲端原稿" },
    ]),
  );
  await saved(page);
  const otherContext = await browser.newContext({ ignoreHTTPSErrors: true,
    storageState: await page.context().storageState(),
  });
  try {
    const other = await otherContext.newPage();
    await openPrivate(other, id);
    const title = await apiTitle(other, id);
    const backup = await (
      await other.request.post("/api/backups", { headers, data: {} })
    ).json();
    await page.context().setOffline(true);
    await page.evaluate(() =>
      window.probe!.editor.updateBlock(window.probe!.editor.document[0], {
        content: "只在舊裝置的草稿",
      }),
    );
    await expect(page.getByTestId("local-status")).toHaveText("本機已儲存");
    expect(
      (
        await other.request.post(`/api/backups/${backup.id}/restore`, {
          headers,
          data: { request_id: "ux-08-restore" },
        })
      ).status(),
    ).toBe(200);
    await page.context().setOffline(false);
    await expect(
      page.getByRole("button", { name: "檢視本機草稿", exact: true }),
    ).toBeVisible();
    await page.evaluate(() => sessionStorage.removeItem("p-note-scope"));
    await page.reload();
    const view = page.getByRole("button", { name: "檢視本機草稿", exact: true });
    await expect(view).toBeVisible();
    await expect(page.locator("body")).not.toContainText(jargon);
    await expect(page.locator("body")).toContainText(`目前版本：${title}。`);
    await view.click();
    await expect(page.locator("body")).not.toContainText(jargon);
  } finally {
    await page.context().setOffline(false);
    await otherContext.close();
  }
  await page.goto("/");
  await page.getByRole("button", { name: "備份設定", exact: true }).click();
  await expect(page.getByRole("heading", { name: "備份設定" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("DATA & BACKUP");
});

test("UX-09：日記面板立即列出當月且日期不重複", async ({ page }) => {
  const id = await openPrivate(page);
  const today = (await (await page.request.get("/api/pages/" + id)).json())
    .journal_date as string;
  const dates = [`${today.slice(0, 7)}-01`, `${today.slice(0, 7)}-02`];
  for (const date of dates)
    expect(
      (
        await page.request.post("/api/journal", { headers, data: { date } })
      ).status(),
    ).toBe(200);
  await showNavigation(page);
  await page.getByRole("button", { name: "日記", exact: true }).click();
  const list = page.getByRole("region", { name: "月份日記" });
  for (const date of dates)
    await expect(list.getByRole("link", { name: date, exact: true })).toBeVisible();
  for (const text of await list.getByRole("link").allTextContents()) {
    const date = text.match(/\d{4}-\d{2}-\d{2}/)![0];
    expect(text.split(date).length - 1).toBe(1);
  }
});

test("UX-10：手機首屏上半部即可開始書寫", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openPrivate(page);
  const box = (await page.locator(".tiptap").boundingBox())!;
  expect(box.y).toBeLessThan(812 * 0.45);
  await expect(page.locator("body")).not.toContainText(
    /留一頁給今天|從一個想法開始|你的私人筆記空間/,
  );
});

test("UX-11：頁面樹可收合並在重新整理後保留", async ({ page }) => {
  await openPrivate(page);
  const a = await createNote(page, "第一層", null);
  const b = await createNote(page, "第二層", a);
  const c = await createNote(page, "第三層", b);
  await openPage(page, a);
  await showNavigation(page);
  const tree = page.getByRole("navigation", { name: "筆記頁面" });
  const link = (name: string) => tree.getByRole("link", { name, exact: true });
  await expect(link("第三層")).toBeVisible();
  const collapse = tree.getByRole("button", { name: "收合 第一層", exact: true });
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await collapse.click();
  await expect(
    tree.getByRole("button", { name: "展開 第一層", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(link("第二層")).toBeHidden();
  await expect(link("第三層")).toBeHidden();
  await page.reload();
  await expect(page.getByTestId("ready")).toHaveText("可編輯");
  await showNavigation(page);
  await expect(link("第一層")).toBeVisible();
  await expect(link("第二層")).toBeHidden();
  await closeDrawer(page);
  await openPage(page, c);
  await showNavigation(page);
  await expect(link("第三層")).toBeVisible();
});

test("UX-12：移動選項依階層並排除子孫，Ctrl/Meta+K 開啟搜尋", async ({
  page,
}) => {
  await openPrivate(page);
  const a = await createNote(page, "甲頁", null);
  const b = await createNote(page, "乙頁", a);
  await createNote(page, "丙頁", b);
  const d = await createNote(page, "丁頁", null);
  await createNote(page, "戊頁", d);
  await openPage(page, a);
  const path = page.getByRole("navigation", { name: "頁面路徑" });
  await expect(path.locator(".mantine-Breadcrumbs-breadcrumb").first()).toHaveText(
    "筆記",
  );
  await expect(
    path.getByRole("button", { name: "筆記列表", exact: true }),
  ).toBeVisible();
  await openPageActions(page);
  await page.getByRole("menuitem", { name: "移動頁面", exact: true }).click();
  const options = page
    .getByLabel("移動至上層", { exact: true })
    .locator("option");
  await expect(options).toHaveText(["最上層", "丁頁", "　戊頁"]);
  await page.keyboard.press("Escape");
  await page.locator(".tiptap").click();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(
    page.getByRole("dialog", { name: "搜尋筆記", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("搜尋文字", { exact: true })).toBeFocused();
});

test("UX-13：長標題還原不溢出並有明確回饋", async ({ page }) => {
  await openPrivate(page);
  const longTitle = "很長的標題".repeat(40);
  const id = await createNote(page, longTitle, null);
  const secondId = await createNote(page, "第二個刪除頁", null);
  for (const target of [id, secondId])
    expect(
      (
        await page.request.post(`/api/pages/${target}/delete`, {
          headers,
          data: {},
        })
      ).status(),
    ).toBe(200);
  await showNavigation(page);
  await page.getByRole("button", { name: "垃圾桶", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "垃圾桶", exact: true });
  const restore = dialog.getByRole("button", { name: "還原 " + longTitle });
  await expect(restore).toHaveText("還原");
  expect(
    await dialog
      .locator(".mantine-Modal-body")
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);
  await restore.click();
  await expect(dialog.getByRole("status")).toContainText("已還原");
  expect((await page.request.get("/api/pages/" + id)).status()).toBe(200);
  const second = dialog.getByRole("button", {
    name: "還原 第二個刪除頁",
    exact: true,
  });
  await expect(second).toBeVisible();
  await failFetch(page, /^GET \/api\/trash$/);
  await second.click();
  await expect(dialog.getByRole("alert")).toBeVisible();
});

test("UX-14：備份還原高亮、捲入可視範圍並可取消；全域錯誤可關閉", async ({
  page,
}) => {
  await openPrivate(page);
  for (let i = 0; i < 3; i++)
    expect(
      (await page.request.post("/api/backups", { headers, data: {} })).ok(),
    ).toBe(true);
  await page.getByRole("button", { name: "備份設定", exact: true }).click();
  const choose = page.getByRole("button", { name: "選擇還原", exact: true });
  await expect(choose).toHaveCount(3);
  let restoreRequests = 0;
  page.on("request", (request) => {
    if (/\/api\/backups\/[^/]+\/restore$/.test(request.url())) restoreRequests++;
  });
  await choose.nth(2).click();
  await expect(page.locator(".backup-card").nth(2)).toHaveAttribute(
    "aria-current",
    "true",
  );
  const confirm = page.getByRole("region", { name: "覆蓋還原確認" });
  await expect(confirm).toBeInViewport();
  await page.getByRole("button", { name: "取消還原", exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(page.locator('.backup-card[aria-current="true"]')).toHaveCount(0);
  expect(restoreRequests).toBe(0);
  await failFetch(page, /^GET \/api\/pages$/);
  await page.goto("/");
  const alert = page.getByRole("alert").filter({ hasText: "頁面列表" });
  await expect(alert).toBeVisible();
  await alert.getByRole("button", { name: "關閉提示" }).click();
  await expect(alert).toBeHidden();
});

async function contrastFailures(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    const rgba = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = "#000";
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const luminance = ([r, g, b]: number[]) =>
      [r, g, b]
        .map((v) => v / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const background = (element: Element | null) => {
      for (let node = element; node; node = node.parentElement) {
        const color = rgba(getComputedStyle(node).backgroundColor);
        if (color[3] > 0.99) return color;
      }
      return [255, 255, 255, 1];
    };
    const failures: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>("body *")) {
      if (element.closest(".bn-editor, [disabled], [aria-disabled=true]"))
        continue;
      const own = [...element.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim(),
      );
      if (!own || !element.checkVisibility({ opacityProperty: true })) continue;
      const style = getComputedStyle(element);
      if (parseFloat(style.fontSize) > 14) continue;
      const bg = background(element);
      const fg = rgba(style.color);
      const mixed = fg
        .slice(0, 3)
        .map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
      const [high, low] = [luminance(mixed), luminance(bg)].sort(
        (x, y) => y - x,
      );
      const ratio = (high + 0.05) / (low + 0.05);
      if (ratio < 4.5)
        failures.push(
          `${element.textContent!.trim().slice(0, 20)} ${ratio.toFixed(2)}`,
        );
    }
    return failures;
  });
}

test("UX-15：小字輔助文字對比達 WCAG AA", async ({ page }) => {
  test.setTimeout(60000);
  await page.goto("/");
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  expect(await contrastFailures(page)).toEqual([]);
  await openPrivate(page);
  await showNavigation(page);
  await expect(
    page.getByRole("navigation", { name: "筆記頁面" }),
  ).toBeVisible();
  expect(await contrastFailures(page)).toEqual([]);
  await closeDrawer(page);
  await page.getByRole("button", { name: "備份設定", exact: true }).click();
  await expect(page.getByText("還沒有備份", { exact: true })).toBeVisible();
  expect(await contrastFailures(page)).toEqual([]);
});
