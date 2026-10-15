import { test, expect, type Page } from "@playwright/test";
import { openPrivate, showNavigation, saved, moveToTrash, gate, heldCount, release } from "./helpers";
import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } from "@zip.js/zip.js";
import { origin } from "./ports";

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
  options: { id: string; name: string }[] = [],
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

test("DB-11：條件讀取回空 304，列異動與祖先刪除使快取失效", async ({ page }) => {
  await openPrivate(page);
  const parent = await (await post(page, "/api/pages", { title: "上層" })).json();
  const db = await (await post(page, "/api/databases", { title: "條件讀取", parent_id: parent.id })).json();
  const path = "/api/databases/" + db.id;
  const first = await page.request.get(path);
  const etag = first.headers().etag;
  expect(etag).toBeTruthy();
  const unchanged = await page.request.get(path, { headers: { "If-None-Match": etag } });
  expect(unchanged.status()).toBe(304);
  expect(await unchanged.body()).toHaveLength(0);
  const record = await row(page, db, "新增列");
  const inserted = await page.request.get(path, { headers: { "If-None-Match": etag } });
  expect(inserted.status()).toBe(200);
  expect(inserted.headers().etag).not.toBe(etag);
  expect((await inserted.json()).rows.map((r: { id: string }) => r.id)).toEqual([record.id]);
  await values(page, record, "title", "修改列");
  const edited = await page.request.get(path, { headers: { "If-None-Match": inserted.headers().etag } });
  expect(edited.status()).toBe(200);
  expect((await edited.json()).rows[0].title).toBe("修改列");
  await post(page, "/api/pages/" + parent.id + "/delete", {});
  expect((await page.request.get(path, { headers: { "If-None-Match": edited.headers().etag } })).status()).toBe(404);
});

test("DB-11：背景暫停輪詢，恢復可見立即以 ETag 更新", async ({ page }) => {
  await openPrivate(page);
  const db = await create(page);
  await row(page, db, "前景列");
  const path = "/api/databases/" + db.id;
  const requests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === path && request.method() === "GET") requests.push(request.headers()["if-none-match"] ?? "");
  });
  await openDB(page, db.id);
  await expect(page.getByTestId("database-rows")).toContainText("前景列");
  await page.evaluate((path) => {
    const counter = { count: 0 };
    (window as unknown as { databaseGetCounter: typeof counter }).databaseGetCounter = counter;
    const original = window.fetch;
    window.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.pathname === path && (init?.method ?? "GET") === "GET") counter.count++;
      return original(input, init);
    };
  }, path);
  await page.clock.install();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(9100);
  expect(await page.evaluate(() => (window as unknown as { databaseGetCounter: { count: number } }).databaseGetCounter.count)).toBe(0);
  const response = page.waitForResponse(r => new URL(r.url()).pathname === path);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const unchanged = await response;
  expect(requests.at(-1)).toBeTruthy();
  expect(unchanged.headers().etag).toBe(requests.at(-1));
  // WebKit 會將重新驗證的 304 呈現為快取 200，因此斷言實際沒有傳輸本文。
  expect((await unchanged.request().sizes()).responseBodySize).toBe(0);
  await row(page, db, "背景新增");
  const updated = page.waitForResponse(r => new URL(r.url()).pathname === path && r.status() === 200);
  await page.clock.runFor(3100);
  await updated;
  await expect(page.getByTestId("database-rows")).toContainText("背景新增");
});

test("DB-11：慢速讀取跨過輪詢週期仍只發一個請求並完成載入", async ({ page }) => {
  await openPrivate(page);
  const db = await create(page);
  await row(page, db, "慢速列");
  const pattern = "^/api/databases/" + db.id + "$";
  await gate(page, [{ pattern, hold: true }], true);
  await page.goto("/?page=" + db.id);
  await expect(page.getByTestId("database-loading")).toBeVisible();
  await expect.poll(() => heldCount(page, pattern)).toBe(1);
  await page.clock.install();
  await page.clock.runFor(9100);
  expect(await heldCount(page, pattern)).toBe(1);
  await release(page, pattern);
  await expect(page.getByTestId("database-ready")).toBeVisible();
  await expect(page.getByTestId("database-rows")).toContainText("慢速列");
});

test("DB-12：不同檢視的過期設定合併，同檢視衝突仍拒絕", async ({ page }) => {
  await openPrivate(page);
  const db = await create(page);
  const record = await row(page, db, "併發列");
  const base = { properties: fields, views: [view("a", "甲"), view("b", "乙")] };
  const saved = await config(page, db, base);
  const save = (next: object) => post(page, "/api/databases/" + db.id + "/config", {
    previous: saved.database_config, generation: saved.sync_generation, config: next,
  });
  expect((await save({ ...base, views: [view("a", "甲修改"), base.views[1]] })).status()).toBe(200);
  await values(page, record, "score", 7);
  const second = await save({ ...base, views: [base.views[0], view("b", "乙修改")] });
  expect(second.status()).toBe(200);
  expect(JSON.parse((await second.json()).database_config).views.map((v: { name: string }) => v.name)).toEqual(["甲修改", "乙修改"]);
  expect((await save({ ...base, views: [view("a", "甲衝突"), base.views[1]] })).status()).toBe(409);
  expect(JSON.parse((await (await page.request.get("/api/pages/" + record.id)).json()).property_values).score).toBe(7);
});

test("DB-12：兩端開啟的檢視草稿在背景更新後仍獨立保存", async ({ page, browser }) => {
  await openPrivate(page);
  const db = await create(page);
  await config(page, db, { properties: [], views: [view("a", "甲檢視"), view("b", "乙檢視")] });
  await openDB(page, db.id);
  const other = await browser.newContext({ ignoreHTTPSErrors: true, storageState: await page.context().storageState() });
  try {
    const p2 = await other.newPage();
    await openDB(p2, db.id);
    await p2.getByLabel("目前檢視", { exact: true }).selectOption("b");
    for (const p of [page, p2]) await p.getByRole("button", { name: "檢視設定", exact: true }).click();
    await page.getByLabel("檢視名稱", { exact: true }).fill("甲端保存");
    await p2.getByLabel("檢視名稱", { exact: true }).fill("乙端保存");
    await page.getByRole("button", { name: "儲存檢視", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "檢視設定", exact: true })).toBeHidden();
    const refresh = p2.waitForResponse(r => new URL(r.url()).pathname === "/api/databases/" + db.id && r.status() === 200);
    await p2.evaluate(() => dispatchEvent(new Event("focus")));
    await refresh;
    await p2.getByRole("button", { name: "儲存檢視", exact: true }).click();
    await expect(p2.getByRole("dialog", { name: "檢視設定", exact: true })).toBeHidden();
    const saved = await (await p2.request.get("/api/databases/" + db.id)).json();
    expect(saved.config.views.map((v: { name: string }) => v.name)).toEqual(["甲端保存", "乙端保存"]);
  } finally { await other.close(); }
});

test("DB-01：建立資料庫、筆記與移入移出保留正文", async ({ page }) => {
  await openPrivate(page);
  await showNavigation(page);
  await page.getByRole("button", { name: "新增資料庫", exact: true }).click();
  await expect(page.getByTestId("database-ready")).toBeVisible();
  const db = new URL(page.url()).searchParams.get("page")!;
  await page
    .locator(".database-page")
    .getByRole("button", { name: "新增筆記", exact: true })
    .click();
  await expect(page.getByTestId("ready")).toHaveText("可編輯");
  const id = new URL(page.url()).searchParams.get("page")!;
  await page.evaluate(() =>
    window.probe!.editor.updateBlock(window.probe!.editor.document[0], {
      content: "資料庫正文保留",
    }),
  );
  await saved(page);
  await page
    .getByRole("link", { name: "未命名資料庫", exact: true })
    .first()
    .click();
  await expect(page.getByTestId("database-ready")).toBeVisible();
  await expect(page.getByTestId("database-rows")).toContainText("未命名");
  await post(page, "/api/pages/" + id + "/move", { parent_id: null });
  expect(
    (await (await page.request.get("/api/pages/" + id)).json()).parent_id,
  ).toBeNull();
  await post(page, "/api/pages/" + id + "/move", { parent_id: db });
  await openPrivate(page, id);
  await expect(page.locator(".tiptap")).toContainText("資料庫正文保留");
});

test("DB-02：刪除與還原資料庫不復活先前刪除列", async ({ page }) => {
  await openPrivate(page);
  const db = await create(page);
  const a = await row(page, db, "保留");
  const b = await row(page, db, "先刪");
  await post(page, "/api/pages/" + b.id + "/delete", {});
  await post(page, "/api/pages/" + db.id + "/delete", {});
  expect((await page.request.get("/api/databases/" + db.id)).status()).toBe(
    404,
  );
  await post(page, "/api/pages/" + db.id + "/restore", {});
  await openDB(page, db.id);
  await expect(page.getByTestId("database-rows")).toContainText(a.title);
  await expect(page.getByTestId("database-rows")).not.toContainText(b.title);
});

test("DB-03：各欄位在表格與筆記往返、重新命名保留值", async ({ page }) => {
  await openPrivate(page);
  const db = await create(page);
  const record = await row(page, db, "欄位筆記");
  const props = [
    property("txt", "摘要"),
    property("num", "數字", "number"),
    property("date", "日期", "date"),
    fields[0],
    property("tags", "標籤", "multiSelect", [{ id: "a", name: "React" }]),
    property("done", "完成", "checkbox"),
    property("url", "來源", "url"),
  ];
  await config(page, db, {
    properties: props,
    views: [
      {
        ...view(),
        columns: [
          "title",
          ...props.map((p) => p.id),
          "created_at",
          "updated_at",
        ],
      },
    ],
  });
  await openDB(page, db.id);
  await page.getByLabel("名稱", { exact: true }).fill("表格修改標題");
  await page.getByLabel("名稱", { exact: true }).blur();
  await expect(page.getByTestId("property-status")).toContainText("已儲存");
  const area = page.getByTestId("database-rows");
  await area.getByLabel("摘要").fill("中文摘要");
  await area.getByLabel("摘要").blur();
  await expect(page.getByTestId("property-status")).toContainText("已儲存");
  for (const [key, value] of [
    ["num", 42],
    ["date", "2026-10-14"],
    ["topic", "tech"],
    ["tags", ["a"]],
    ["done", true],
    ["url", "https://example.com"],
  ] as const)
    await values(page, record, key, value);
  await openPrivate(page, record.id);
  await expect(page.getByLabel("摘要")).toHaveValue("中文摘要");
  await page.getByLabel("摘要").fill("筆記頁編輯");
  await page.getByLabel("摘要").blur();
  await expect(page.getByTestId("property-status")).toContainText("已儲存");
  props[0].name = "說明";
  await config(page, db, {
    properties: props,
    views: [
      {
        ...view(),
        columns: [
          "title",
          ...props.map((p) => p.id),
          "created_at",
          "updated_at",
        ],
      },
    ],
  });
  await openDB(page, db.id);
  await expect(area.getByLabel("說明")).toHaveValue("筆記頁編輯");
  expect(
    JSON.parse(
      (await (await page.request.get("/api/pages/" + record.id)).json())
        .property_values,
    ),
  ).toEqual({
    txt: "筆記頁編輯",
    num: 42,
    date: "2026-10-14",
    topic: "tech",
    tags: ["a"],
    done: true,
    url: "https://example.com",
  });
});

test("DB-04：無效欄位值、選項及型別變更拒絕，取消刪除保留", async ({
  page,
}) => {
  await openPrivate(page);
  const db = await create(page);
  const record = await row(page, db, "驗證");
  const props = [
    ...fields,
    property("date", "日期", "date"),
    property("url", "來源", "url"),
  ];
  await config(page, db, { properties: props, views: [view()] });
  await values(page, record, "score", 9);
  for (const [property, value] of [
    ["score", "abc"],
    ["date", "2026-02-30"],
    ["url", "javascript:alert(1)"],
    ["topic", "unknown"],
    ["unknown", "x"],
  ])
    expect(
      (
        await post(page, "/api/pages/" + record.id + "/properties", {
          property,
          value,
          generation: record.sync_generation,
        })
      ).status(),
    ).toBe(400);
  const old = (await (await page.request.get("/api/pages/" + db.id)).json())
    .database_config;
  expect(
    (
      await post(page, "/api/databases/" + db.id + "/config", {
        previous: old,
        generation: db.sync_generation,
        config: {
          properties: props.map((p) =>
            p.id === "score" ? { ...p, type: "text" } : p,
          ),
          views: [view()],
        },
      })
    ).status(),
  ).toBe(409);
  await openDB(page, db.id);
  await page.getByRole("button", { name: "管理欄位", exact: true }).click();
  await page.getByRole("button", { name: "刪除 分數", exact: true }).click();
  await page.getByRole("button", { name: "取消刪除", exact: true }).click();
  expect(
    (await (await page.request.get("/api/pages/" + db.id)).json())
      .database_config,
  ).toBe(old);
});

test("DB-05：儲存檢視獨立篩選、排序、隱藏與重開", async ({ page }) => {
  test.setTimeout(60000);
  await openPrivate(page);
  const db = await create(page);
  const a = await row(page, db, "甲");
  const b = await row(page, db, "乙");
  const c = await row(page, db, "丙");
  await config(page, db, { properties: fields, views: [view()] });
  await values(page, a, "topic", "tech");
  await values(page, a, "score", 2);
  await values(page, b, "topic", "life");
  await values(page, b, "score", 10);
  await values(page, c, "topic", "tech");
  await values(page, c, "score", 20);
  await openDB(page, db.id);
  await page.getByRole("button", { name: "新增檢視", exact: true }).click();
  await page.getByLabel("檢視名稱", { exact: true }).fill("技術清單");
  await page.getByLabel("檢視形式", { exact: true }).selectOption("list");
  await page.getByRole("button", { name: "新增篩選", exact: true }).click();
  await page.getByLabel("篩選欄位 1").selectOption("topic");
  await page.getByLabel("篩選值 1").selectOption("tech");
  await page.getByRole("button", { name: "新增排序", exact: true }).click();
  await page.getByLabel("排序欄位 1").selectOption("score");
  await page.getByLabel("排序方向 1").selectOption("desc");
  await page.getByRole("button", { name: "儲存檢視", exact: true }).click();
  await expect(
    page.getByTestId("database-rows").getByTestId("database-row"),
  ).toHaveText(["丙", "甲"]);
  await page.reload();
  await page.getByLabel("目前檢視").selectOption({ label: "技術清單" });
  await expect(
    page.getByTestId("database-rows").getByTestId("database-row"),
  ).toHaveText(["丙", "甲"]);
  await page.getByLabel("目前檢視").selectOption({ label: "全部筆記" });
  await expect(page.getByTestId("database-row")).toHaveCount(3);
  const cases = [
    {
      filters: [
        { property: "score", operator: "gt", value: "9" },
        { property: "topic", operator: "eq", value: "tech" },
      ],
      mode: "and",
      titles: ["丙"],
    },
    {
      filters: [
        { property: "score", operator: "lt", value: "3" },
        { property: "topic", operator: "eq", value: "life" },
      ],
      mode: "or",
      titles: ["乙", "甲"],
    },
    {
      filters: [{ property: "topic", operator: "neq", value: "life" }],
      mode: "and",
      titles: ["丙", "甲"],
    },
    {
      filters: [{ property: "title", operator: "contains", value: "乙" }],
      mode: "and",
      titles: ["乙"],
    },
    {
      filters: [{ property: "score", operator: "empty", value: "" }],
      mode: "and",
      titles: [],
    },
    {
      filters: [{ property: "score", operator: "notEmpty", value: "" }],
      mode: "and",
      titles: ["丙", "乙", "甲"],
    },
  ];
  for (const item of cases) {
    await config(page, db, {
      properties: fields,
      views: [
        {
          ...view("matrix", "條件驗證", "list"),
          columns: ["title"],
          filters: item.filters,
          filterMode: item.mode,
          sorts: [{ property: "score", direction: "desc" }],
        },
      ],
    });
    await openDB(page, db.id);
    await expect(page.getByTestId("database-row")).toHaveText(item.titles);
  }
  const pages = await (
    await page.request.get("/api/databases/" + db.id)
  ).json();
  expect(pages.rows).toHaveLength(3);
});

test("DB-06：保存失敗保留輸入供重試，不同欄位併發不覆蓋", async ({
  page,
  browser,
}) => {
  await openPrivate(page);
  const db = await create(page);
  const record = await row(page, db, "併發");
  await config(page, db, {
    properties: [property("a", "甲欄"), property("b", "乙欄")],
    views: [{ ...view(), columns: ["title", "a", "b"] }],
  });
  await openDB(page, db.id);
  await page.evaluate(() => {
    const original = window.fetch;
    const control = { fail: true, count: 0 };
    (window as unknown as { databaseFailure: typeof control }).databaseFailure = control;
    window.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (control.fail && url.pathname.endsWith('/properties') && init?.method === 'POST') {
        control.count++; return Promise.resolve(Response.json({ message: '測試保存失敗' }, { status: 503 }));
      }
      return original(input, init);
    };
  });
  await page.getByLabel("甲欄").fill("保留草稿");
  await page.getByLabel("甲欄").blur();
  await expect(page.getByTestId("property-status")).toContainText(
    "測試保存失敗",
  );
  await expect(page.getByLabel("甲欄")).toHaveValue("保留草稿");
  expect(await page.evaluate(() => (window as unknown as { databaseFailure: { count: number } }).databaseFailure.count)).toBeGreaterThan(0);
  await page.evaluate(() => { (window as unknown as { databaseFailure: { fail: boolean } }).databaseFailure.fail = false; });
  await page.getByRole("button", { name: "重試保存", exact: true }).click();
  await expect(page.getByTestId("property-status")).toContainText("已儲存");
  const other = await browser.newContext({ ignoreHTTPSErrors: true,
    storageState: await page.context().storageState(),
  });
  const p2 = await other.newPage();
  await openDB(p2, db.id);
  await Promise.all([
    values(page, record, "a", "第一端"),
    values(p2, record, "b", "第二端"),
  ]);
  await expect(p2.getByLabel("甲欄")).toHaveValue("第一端", { timeout: 10000 });
  const old = (await (await page.request.get("/api/pages/" + db.id)).json())
    .database_config;
  await config(page, db, {
    properties: [property("a", "改名"), property("b", "乙欄")],
    views: [view()],
  });
  expect(
    (
      await post(page, "/api/databases/" + db.id + "/config", {
        previous: old,
        config: JSON.parse(old),
      })
    ).status(),
  ).toBe(409);
  const final = JSON.parse(
    (await (await page.request.get("/api/pages/" + record.id)).json())
      .property_values,
  );
  expect(final).toEqual({ a: "第一端", b: "第二端" });
  await other.close();
});

test("DB-07：權限、刪除、舊世代與离線屬性限制", async ({ page, browser }) => {
  await openPrivate(page);
  const db = await create(page);
  const record = await row(page, db, "離線");
  await config(page, db, {
    properties: [property("a", "摘要")],
    views: [view()],
  });
  const anon = await browser.newContext({ ignoreHTTPSErrors: true });
  expect(
    (await anon.request.get(origin + "/api/databases/" + db.id)).status(),
  ).toBe(401);
  await anon.close();
  expect(
    (
      await page.request.post("/api/databases/" + db.id + "/config", {
        headers: { Origin: "https://other.test" },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect((await page.request.get("/api/databases/not-owned")).status()).toBe(
    404,
  );
  const current = await (await page.request.get("/api/pages/" + db.id)).json();
  expect(
    (
      await post(page, "/api/databases/" + db.id + "/config", {
        previous: current.database_config,
        generation: "old",
        config: JSON.parse(current.database_config),
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await post(page, "/api/pages/" + record.id + "/properties", {
        property: "a",
        value: "x",
        generation: "old",
      })
    ).status(),
  ).toBe(409);
  await openPrivate(page, record.id);
  await page.context().setOffline(true);
  await expect(
    page.getByText("欄位修改需要連線", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("摘要")).toBeDisabled();
  await page.evaluate(() =>
    window.probe!.editor.updateBlock(window.probe!.editor.document[0], {
      content: "離線正文",
    }),
  );
  await expect(page.locator(".tiptap")).toContainText("離線正文");
  await page.context().setOffline(false);
  await post(page, "/api/pages/" + db.id + "/delete", {});
  expect(
    (
      await post(page, "/api/pages/" + record.id + "/properties", {
        property: "a",
        value: "x",
        generation: record.sync_generation,
      })
    ).status(),
  ).toBe(404);
});

test("DB-08：手機與鍵盤可新增欄位且整頁不溢出", async ({ page }) => {
  await openPrivate(page);
  const db = await create(page);
  await row(page, db, "手機筆記");
  await openDB(page, db.id);
  await page.getByRole("button", { name: "管理欄位", exact: true }).click();
  await page.getByLabel("新欄位名稱").fill("手機摘要");
  await page.getByLabel("新欄位類型").selectOption("text");
  await page.getByLabel("新欄位名稱").press("Enter");
  await page.getByRole("button", { name: "關閉欄位管理", exact: true }).click();
  await page.getByLabel("手機摘要", { exact: true }).fill("觸控與鍵盤");
  await page.getByLabel("手機摘要", { exact: true }).blur();
  await expect(page.getByTestId("property-status")).toContainText("已儲存");
  await expect(
    page.getByRole("dialog", { name: "管理欄位", exact: true }),
  ).toBeHidden();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
});

test("DB-09：ZIP 與還原保留資料庫、檢視、欄位與正文", async ({
  page,
  browser,
}) => {
  await openPrivate(page);
  const db = await create(page);
  const record = await row(page, db, "備份筆記");
  await config(page, db, { properties: fields, views: [view()] });
  await values(page, record, "score", 42);
  await openDB(page, db.id);
  await openPrivate(page, record.id);
  await page.evaluate(() =>
    window.probe!.editor.updateBlock(window.probe!.editor.document[0], {
      content: "資料庫備份正文",
    }),
  );
  await saved(page);
  const backup = await post(page, "/api/backups", {});
  expect(backup.status()).toBe(201);
  const catalog = await backup.json();
  const zip = await page.request.get("/api/backups/" + catalog.id + "/export");
  expect(zip.status()).toBe(200);
  const reader = new ZipReader(
    new Uint8ArrayReader(new Uint8Array(await zip.body())),
    { useWebWorkers: false },
  );
  const entries = await reader.getEntries();
  const manifestEntry = entries.find((e) => e.filename === "manifest.json")!;
  expect(manifestEntry.directory).toBe(false);
  if (manifestEntry.directory) throw new Error("清單不得為目錄");
  const bytes = await manifestEntry.getData!(new Uint8ArrayWriter());
  const manifest = JSON.parse(new TextDecoder().decode(bytes));
  await reader.close();
  expect(
    JSON.parse(
      manifest.pages.find(
        (p: { metadata: { id: string } }) => p.metadata.id === db.id,
      ).metadata.database_config,
    ).properties,
  ).toEqual(fields);
  expect(
    JSON.parse(
      manifest.pages.find(
        (p: { metadata: { id: string } }) => p.metadata.id === record.id,
      ).metadata.property_values,
    ),
  ).toEqual({ score: 42 });
  await values(page, record, "score", 99);
  const restored = await post(page, "/api/backups/" + catalog.id + "/restore", {
    request_id: crypto.randomUUID(),
  });
  expect(restored.status()).toBe(200);
  await openDB(page, db.id);
  expect(
    JSON.parse(
      (await (await page.request.get("/api/pages/" + record.id)).json())
        .property_values,
    ).score,
  ).toBe(42);
  const currentConfig = (
    await (await page.request.get("/api/pages/" + db.id)).json()
  ).database_config;
  expect(
    (
      await post(page, "/api/databases/" + db.id + "/config", {
        generation: db.sync_generation,
        previous: currentConfig,
        config: JSON.parse(currentConfig),
      })
    ).status(),
  ).toBe(409);
  const fresh = await browser.newContext({ ignoreHTTPSErrors: true,
    storageState: {
      cookies: (await page.context().storageState()).cookies,
      origins: [],
    },
  });
  const p2 = await fresh.newPage();
  await openPrivate(p2, record.id);
  await expect(p2.locator(".tiptap")).toContainText("資料庫備份正文");
  await fresh.close();
  expect(
    (
      await post(page, "/api/pages/" + record.id + "/properties", {
        property: "score",
        value: 100,
        generation: record.sync_generation,
      })
    ).status(),
  ).toBe(409);
});

test("DB-10：舊格式備份可還原且無效新設定拒絕", async ({ page }) => {
  await openPrivate(page);
  const db = await create(page);
  await row(page, db, "舊格式");
  const legacy = await post(page, "/__test/database-backup", { legacy: true });
  expect(legacy.status()).toBe(200);
  const b = await legacy.json();
  expect(
    (
      await post(page, "/api/backups/" + b.id + "/restore", {
        request_id: crypto.randomUUID(),
      })
    ).status(),
  ).toBe(200);
  expect(
    (await (await page.request.get("/api/pages/" + db.id)).json())
      .database_config,
  ).toBeNull();
  const invalid = await post(page, "/__test/database-backup", {
    invalid: true,
  });
  expect(invalid.status()).toBe(503);
});

test('DB-04：大型欄位設定與完整中文值可保存', async ({ page }) => {
  await openPrivate(page); const db = await create(page); const record = await row(page, db, '大量欄位');
  const properties = Array.from({ length: 50 }, (_, i) => property('field-' + i, '欄位 ' + i));
  const views = Array.from({ length: 5 }, (_, i) => ({ ...view('view-' + i, '檢視 ' + i), columns: ['title', ...properties.map(p => p.id)] }));
  await config(page, db, { properties, views });
  const value = '繁體中文'.repeat(500); await values(page, record, 'field-0', value);
  const info = await (await page.request.get('/api/pages/' + record.id)).json(); expect(JSON.parse(info.property_values)['field-0']).toBe(value);
});
