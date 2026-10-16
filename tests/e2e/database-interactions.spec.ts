import { test, expect, type Page } from "@playwright/test";
import {
  openPrivate,
  showNavigation,
  saved,
  moveToTrash,
  gate,
  heldCount,
  release,
  openCreateMenu,
} from "./helpers";

import { origin } from "./ports";
import type { PropertyOption } from "../../src/shared/databases";

test.beforeEach(async ({ request }) => {
  await request.post("/__test/reset");
});
async function post(page: Page, path: string, data: object) {
  return page.request.post(path, { headers: { Origin: origin }, data });
}
async function create(page: Page, title = "筆記資料庫") {
  const response = await post(page, "/api/databases", { title });
  expect(response.status()).toBe(200);
  return response.json();
}
async function row(page: Page, db: { id: string }, title: string) {
  const response = await post(page, "/api/pages", { title, parent_id: db.id });
  expect(response.status()).toBe(200);
  return response.json();
}
async function config(page: Page, db: { id: string }, next: object) {
  const old = await (await page.request.get("/api/pages/" + db.id)).json();
  const response = await post(page, "/api/databases/" + db.id + "/config", {
    previous: old.database_config,
    generation: old.sync_generation,
    config: next,
  });
  expect(response.status()).toBe(200);
  return response.json();
}
const property = (
  id: string,
  name: string,
  type = "text",
  options: PropertyOption[] = [],
) => ({ id, name, type, options });
const view = (id = "view-1", name = "全部筆記", layout = "table") => ({
  id,
  name,
  layout,
  columns: ["title"],
  filters: [],
  filterMode: "and",
  sorts: [],
});
const fields = [
  property("topic", "主題", "select", [
    { id: "tech", name: "技術" },
    { id: "life", name: "生活" },
  ]),
  property("score", "分數", "number"),
];
async function values(
  page: Page,
  record: { id: string; sync_generation: string },
  property: string,
  value: unknown,
) {
  const response = await post(page, "/api/pages/" + record.id + "/properties", {
    property,
    value,
    generation: record.sync_generation,
  });
  expect(response.status()).toBe(200);
  return response.json();
}
async function openDB(page: Page, id: string) {
  await page.goto("/?page=" + id);
  await expect(page.getByTestId("database-ready")).toBeVisible();
}

async function failRequests(page: Page, path: string, message: string) {
  await page.evaluate(
    ({ path, message }) => {
      const control = { fail: true, count: 0 };
      Object.assign(window, { databaseRequestFailure: control });
      const original = window.fetch;
      window.fetch = (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
          location.href,
        );
        if (control.fail && url.pathname === path && init?.method === "POST") {
          control.count++;
          return Promise.resolve(Response.json({ message }, { status: 503 }));
        }
        return original(input, init);
      };
    },
    { path, message },
  );
  return async () =>
    page.evaluate(() => {
      const control = (
        window as unknown as {
          databaseRequestFailure: { fail: boolean; count: number };
        }
      ).databaseRequestFailure;
      if (!control.count) throw new Error("未觸發指定的失敗請求");
      control.fail = false;
    });
}

test("DB-13：工具列即時篩選、chip 與欄標題排序", async ({ page }) => {
  await openPrivate(page);
  const db = await create(page);
  await row(page, db, "甲");
  await row(page, db, "乙");
  await openDB(page, db.id);
  await page.getByRole("button", { name: "篩選", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "檢視設定", exact: true }),
  ).toBeHidden();
  await page.getByRole("button", { name: "新增篩選", exact: true }).click();
  await page.getByLabel("篩選值 1", { exact: true }).fill("甲");
  await expect(page.getByTestId("database-row")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "移除條件 1", exact: true }).click();
  await expect(page.getByTestId("database-row")).toHaveCount(2);
  await page
    .getByRole("button", { name: "欄位選單 名稱", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "降冪", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/databases/" + db.id)).json())
          .config.views[0].sorts,
    )
    .toEqual([{ property: "title", direction: "desc" }]);
});

test("DB-14：原地新增並以 Combobox 建立彩色選項", async ({ page }) => {
  await openPrivate(page);
  const db = await create(page);
  await config(page, db, {
    properties: fields,
    views: [{ ...view(), columns: ["title", "topic"] }],
  });
  await openDB(page, db.id);
  await page.getByRole("button", { name: "新增資料列", exact: true }).click();
  await expect(page).toHaveURL(new RegExp("page=" + db.id));
  const title = page.getByLabel("名稱", { exact: true });
  await expect(title).toBeFocused();
  await title.fill("原地筆記");
  await title.blur();
  await page.getByRole("combobox", { name: "主題", exact: true }).click();
  await page
    .getByRole("combobox", { name: "主題", exact: true })
    .fill("新主題");
  await page
    .getByRole("option", { name: "建立「新主題」", exact: true })
    .click();
  await expect(
    page.getByTestId("database-row").locator(".database-option-pill"),
  ).toContainText("新主題");
  await expect
    .poll(
      async () =>
        (
          await (await page.request.get("/api/databases/" + db.id)).json()
        ).config.properties[0].options.at(-1).color,
    )
    .toBe("blue");
});

test("DB-15：日期篩選、欄寬、換行與 sticky 設定持久化", async ({ page }) => {
  await openPrivate(page);
  const db = await create(page);
  await row(page, db, "日期筆記");
  await config(page, db, {
    properties: [],
    views: [{ ...view(), columns: ["title", "created_at"] }],
  });
  await openDB(page, db.id);
  await page.getByRole("button", { name: "篩選", exact: true }).click();
  await page.getByRole("button", { name: "新增篩選", exact: true }).click();
  await page.getByLabel("篩選欄位 1").selectOption("created_at");
  await expect(page.getByLabel("篩選值 1")).toHaveAttribute("type", "date");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "移除條件 1", exact: true }).click();
  await page.getByRole("button", { name: "檢視設定", exact: true }).click();
  await page.getByRole("switch", { name: "自動換行", exact: true }).check();
  await page.keyboard.press("Escape");
  const handle = page.getByRole("separator", {
    name: "調整欄寬 名稱",
    exact: true,
  });
  await handle.focus();
  await handle.press("ArrowRight");
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/databases/" + db.id)).json())
          .config.views[0],
    )
    .toMatchObject({ wrap: true, widths: { title: 260 } });
  await page.reload();
  await expect(page.getByTestId("database-ready")).toBeVisible();
  await expect(page.locator(".database-table")).toHaveClass(/database-wrap/);
  await expect(page.locator("th").first()).toHaveCSS("position", "sticky");
});

test("DB-16：列選單複製屬性與批次刪除", async ({ page }) => {
  await openPrivate(page);
  const db = await create(page);
  const record = await row(page, db, "來源");
  await config(page, db, { properties: fields, views: [view()] });
  await values(page, record, "score", 42);
  await openDB(page, db.id);
  await page.getByRole("button", { name: "列選單 來源", exact: true }).click();
  await page.getByRole("menuitem", { name: "複製筆記", exact: true }).click();
  await expect(page.getByTestId("database-row")).toHaveCount(2);
  const data = await (await page.request.get("/api/databases/" + db.id)).json();
  const copy = data.rows.find((r: { id: string }) => r.id !== record.id);
  expect(JSON.parse(copy.property_values)).toEqual({ score: 42 });
  expect(copy.sync_generation).not.toBe(record.sync_generation);
  await page.getByLabel("選取全部筆記", { exact: true }).check();
  await page.getByRole("button", { name: "刪除所選筆記", exact: true }).click();
  await page.getByRole("button", { name: "確認刪除筆記", exact: true }).click();
  await expect(page.getByTestId("database-row")).toHaveCount(0);
});

test("DB-13：檢視分頁可重新命名、複製、刪除，欄位 Switch 與鍵盤排序即時保存", async ({
  page,
}) => {
  await openPrivate(page);
  const db = await create(page);
  await row(page, db, "檢視管理");
  await config(page, db, {
    properties: fields,
    views: [{ ...view(), columns: ["title", "topic", "score"] }],
  });
  await openDB(page, db.id);
  await expect(page.getByLabel("目前檢視", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "檢視選單 全部筆記", exact: true })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "刪除檢視", exact: true }),
  ).toHaveAttribute("data-disabled", "true");
  await page.getByRole("menuitem", { name: "複製檢視", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "全部筆記 副本", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page
    .getByRole("button", { name: "檢視選單 全部筆記 副本", exact: true })
    .click();
  await page
    .getByRole("menu", { name: "檢視選單 全部筆記 副本", exact: true })
    .getByRole("menuitem", { name: "重新命名檢視", exact: true })
    .click();
  await page.getByLabel("檢視名稱", { exact: true }).fill("獨立檢視");
  await page.getByRole("button", { name: "儲存檢視", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "獨立檢視", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "檢視設定", exact: true }).click();
  await page
    .getByRole("button", { name: "移動欄位 分數", exact: true })
    .press("ArrowUp");
  await page.getByRole("switch", { name: "主題", exact: true }).uncheck();
  await page.keyboard.press("Escape");
  await expect(page.locator("th[data-column]")).toHaveCount(2);
  await expect
    .poll(
      async () =>
        (
          await (await page.request.get("/api/databases/" + db.id)).json()
        ).config.views.find((v: { name: string }) => v.name === "獨立檢視")
          .columns,
    )
    .toEqual(["title", "score"]);
  await page.getByRole("tab", { name: "全部筆記", exact: true }).click();
  await expect(page.locator("th[data-column]")).toHaveCount(3);
  await page
    .getByRole("button", { name: "檢視選單 獨立檢視", exact: true })
    .click();
  await page
    .getByRole("menu", { name: "檢視選單 獨立檢視", exact: true })
    .getByRole("menuitem", { name: "刪除檢視", exact: true })
    .click();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/databases/" + db.id)).json())
          .config.views.length,
    )
    .toBe(1);
});

test("DB-13：快速篩選修改立即生效，保存失敗保留條件可重試", async ({
  page,
}) => {
  await openPrivate(page);
  const db = await create(page);
  await row(page, db, "保留甲");
  await row(page, db, "保留乙");
  await openDB(page, db.id);
  const recover = await failRequests(
    page,
    "/api/databases/" + db.id + "/config",
    "檢視測試失敗",
  );
  await page.getByRole("button", { name: "篩選", exact: true }).click();
  await page.getByRole("button", { name: "新增篩選", exact: true }).click();
  await page.getByLabel("篩選值 1", { exact: true }).fill("保留甲");
  await expect(page.getByTestId("database-row")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alert")).toContainText("檢視測試失敗");
  await recover();
  await page.getByRole("button", { name: "重試檢視設定", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/databases/" + db.id)).json())
          .config.views[0].filters[0].value,
    )
    .toBe("保留甲");
  await page.reload();
  await expect(page.getByTestId("database-row")).toHaveCount(1);
});

test("DB-14：多選彩色 pill、cell 錯誤框與重試", async ({ page }) => {
  await openPrivate(page);
  const db = await create(page);
  await row(page, db, "多選筆記");
  await config(page, db, {
    properties: [
      property("tags", "標籤", "multiSelect", [
        { id: "a", name: "紅標籤", color: "red" },
      ]),
      property("summary", "摘要"),
    ],
    views: [{ ...view(), columns: ["title", "tags", "summary"] }],
  });
  await openDB(page, db.id);
  await page.getByRole("combobox", { name: "標籤", exact: true }).click();
  await page.getByRole("option", { name: "紅標籤", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByTestId("database-row").locator(".database-option-pill"),
  ).toContainText("紅標籤");
  const recover = await failRequests(
    page,
    "/api/pages/" +
      (await (await page.request.get("/api/databases/" + db.id)).json()).rows[0]
        .id +
      "/properties",
    "cell 測試失敗",
  );
  await page.getByLabel("摘要", { exact: true }).fill("未丟失草稿");
  await page.getByLabel("摘要", { exact: true }).blur();
  await expect(
    page.locator(".property-input[data-save-state=error]"),
  ).toBeVisible();
  await expect(page.getByLabel("摘要", { exact: true })).toHaveValue(
    "未丟失草稿",
  );
  await recover();
  await page.getByRole("button", { name: "重試保存", exact: true }).click();
  await expect(
    page.locator(".property-input[data-save-state=error]"),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("摘要", { exact: true }).locator("..").locator(".."),
  ).toBeVisible();
});

test("DB-15：長文換行增高、拖曳欄寬、捲動固定與清單標籤", async ({ page }) => {
  await openPrivate(page);
  const db = await create(page);
  const record = await row(page, db, "幾何筆記");
  await config(page, db, {
    properties: [property("summary", "摘要")],
    views: [
      {
        ...view(),
        columns: ["title", "summary", "created_at", "updated_at"],
        widths: { title: 240, summary: 160 },
        wrap: false,
      },
    ],
  });
  await values(page, record, "summary", "長內容中文測試".repeat(30));
  for (let i = 0; i < 12; i++) await row(page, db, "筆記 " + i);
  await openDB(page, db.id);
  const cell = page
    .getByTestId("database-row")
    .first()
    .locator("td[data-column=summary]");
  const before = (await cell.boundingBox())!.height;
  await page.getByRole("button", { name: "檢視設定", exact: true }).click();
  await page.getByRole("switch", { name: "自動換行", exact: true }).check();
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => (await cell.boundingBox())!.height)
    .toBeGreaterThan(before + 40);
  const handle = page.getByRole("separator", {
    name: "調整欄寬 名稱",
    exact: true,
  });
  await expect(page.locator(".database-controls")).toBeHidden();
  await handle.hover({ position: { x: 3, y: 10 } });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 3, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 63, box.y + 10);
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/databases/" + db.id)).json())
          .config.views[0].widths.title,
    )
    .toBe(300);
  const scroll = page.locator(".database-scroll");
  const headerBefore = (await page.locator("th").first().boundingBox())!;
  await scroll.evaluate((element) => {
    element.scrollTop = 150;
    element.scrollLeft = 100;
  });
  const headerAfter = (await page.locator("th").first().boundingBox())!;
  expect(Math.abs(headerAfter.y - headerBefore.y)).toBeLessThan(2);
  expect(Math.abs(headerAfter.x - headerBefore.x)).toBeLessThan(2);
  await page.getByRole("button", { name: "檢視設定", exact: true }).click();
  await page.getByLabel("檢視形式", { exact: true }).selectOption("list");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("database-row").first()).toContainText(
    "摘要：",
  );
  await expect(page.getByTestId("database-row").first()).toContainText(
    "建立時間：",
  );
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
});

test("DB-16：批次移動部分失敗只保留未完成選取供重試", async ({ page }) => {
  await openPrivate(page);
  const db = await create(page);
  const destination = await create(page, "目的資料庫");
  const first = await row(page, db, "第一篇");
  const second = await row(page, db, "第二篇");
  await openDB(page, db.id);
  const recover = await failRequests(
    page,
    "/api/pages/" + second.id + "/move",
    "第二筆移動失敗",
  );
  await page.getByLabel("選取全部筆記", { exact: true }).check();
  await page.getByRole("button", { name: "移動所選筆記", exact: true }).click();
  await page
    .getByLabel("移動目的地", { exact: true })
    .selectOption(destination.id);
  await page.getByRole("button", { name: "確認移動筆記", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("第二筆移動失敗");
  expect(
    (await (await page.request.get("/api/pages/" + first.id)).json()).parent_id,
  ).toBe(destination.id);
  expect(
    (await (await page.request.get("/api/pages/" + second.id)).json())
      .parent_id,
  ).toBe(db.id);
  await expect(page.getByRole("dialog")).toContainText("移動 1 篇筆記到");
  await recover();
  await page.getByRole("button", { name: "確認移動筆記", exact: true }).click();
  await expect(page.getByTestId("database-row")).toHaveCount(0);
});

test("DB-13：欄標題可篩選、隱藏及編輯含顏色選項的欄位", async ({ page }) => {
  await openPrivate(page);
  const db = await create(page);
  const a = await row(page, db, "甲");
  const b = await row(page, db, "乙");
  await config(page, db, {
    properties: fields,
    views: [{ ...view(), columns: ["title", "topic", "score"] }],
  });
  await values(page, a, "topic", "tech");
  await values(page, b, "topic", "life");
  await openDB(page, db.id);
  await page
    .getByRole("button", { name: "欄位選單 主題", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "篩選此欄", exact: true }).click();
  await expect(page.getByLabel("篩選欄位 1", { exact: true })).toHaveValue(
    "topic",
  );
  await page.getByLabel("篩選值 1", { exact: true }).selectOption("tech");
  await expect(page.getByTestId("database-row")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "移除條件 1", exact: true }).click();
  await page
    .getByRole("button", { name: "欄位選單 分數", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "隱藏欄位", exact: true }).click();
  await expect(page.locator("th[data-column=score]")).toHaveCount(0);
  await page
    .getByRole("button", { name: "欄位選單 主題", exact: true })
    .click();
  await page
    .getByRole("menu", { name: "欄位選單 主題", exact: true })
    .getByRole("menuitem", { name: "編輯欄位", exact: true })
    .click();
  await expect(page.getByLabel("欄位名稱 1", { exact: true })).toBeFocused();
  await page.getByLabel("欄位名稱 1", { exact: true }).fill("分類");
  await page.getByLabel("選項顏色 分類 1", { exact: true }).selectOption("red");
  await page.getByRole("button", { name: "儲存欄位", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "分類", exact: true }),
  ).toHaveCount(2);
  const current = await (
    await page.request.get("/api/databases/" + db.id)
  ).json();
  expect(current.config.properties[0].options[0].color).toBe("red");
  expect(current.config.views[0].columns).toEqual(["title", "topic"]);
});

test("DB-13：欄位拖曳與鍵盤調整順序立即保存", async ({ page, isMobile }) => {
  await openPrivate(page);
  const db = await create(page);
  await row(page, db, "排序筆記");
  await config(page, db, {
    properties: fields,
    views: [{ ...view(), columns: ["title", "topic", "score"] }],
  });
  await openDB(page, db.id);
  await page.getByRole("button", { name: "檢視設定", exact: true }).click();
  const handle = page.getByRole("button", {
    name: "移動欄位 分數",
    exact: true,
  });
  if (isMobile) await handle.press("ArrowUp");
  else
    await page
      .locator("[data-field-id=score]")
      .dragTo(page.locator("[data-field-id=topic]"));
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/databases/" + db.id)).json())
          .config.views[0].columns,
    )
    .toEqual(["title", "score", "topic"]);
  await page.keyboard.press("Escape");
  expect(
    await page
      .locator("th[data-column]")
      .evaluateAll((cells) =>
        cells.map((cell) => cell.getAttribute("data-column")),
      ),
  ).toEqual(["title", "score", "topic"]);
});
