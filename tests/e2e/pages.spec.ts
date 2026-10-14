import {
  expect,
  test,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  saved,
  showNavigation,
  openJournal,
  openPageActions,
  moveToTrash,
} from "./helpers";

type PageInfo = {
  id: string;
  title: string;
  kind: string;
  parent_id: string | null;
  journal_date: string | null;
  deleted_at: number | null;
};
async function login(page: Page, request: APIRequestContext) {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("owner@example.test");
  await page.getByRole("button", { name: "寄送登入連結", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("查看登入郵件");
  const mails = (await (await request.get("/__test/mailbox")).json()) as {
    url: string;
  }[];
  await page.goto(mails.at(-1)!.url);
  await page.getByRole("button", { name: "確認登入", exact: true }).click();
  await saved(page);
}
async function create(
  page: Page,
  title: string,
  parent_id: string | null = null,
): Promise<PageInfo> {
  const response = await page.request.post("/api/pages", {
    headers: { Origin: "http://127.0.0.1:5173" },
    data: { title, parent_id },
  });
  expect(response.status()).toBe(200);
  return response.json();
}
async function openPage(page: Page, id: string) {
  await page.goto("/?page=" + id);
  await saved(page);
}
async function go(page: Page, action: () => Promise<unknown>, editable = true) {
  const navigation = page.waitForEvent(
    "framenavigated",
    (frame) => frame === page.mainFrame(),
  );
  await action();
  await navigation;
  if (editable) await saved(page);
}
async function text(page: Page, value: string) {
  await page.evaluate((value) => {
    const editor = window.probe!.editor;
    editor.updateBlock(editor.document[0].id, { content: value });
  }, value);
  await saved(page);
}
const menu = openPageActions;
test.beforeEach(async ({ request }) => {
  await request.post("/__test/reset");
  await request.post("/__test/control", {
    data: { now: Date.now() + 86400000 },
  });
});

test("PAGE-01：首頁今天沿用既有日記與正文，不建立第二篇", async ({
  page,
  request,
}) => {
  await login(page, request);
  const id = new URL(page.url()).searchParams.get("page");
  await text(page, "今天的原內容");
  await showNavigation(page);
  await go(page, () =>
    page.getByRole("button", { name: "今天", exact: true }).click(),
  );
  await expect(page.locator(".tiptap")).toContainText("今天的原內容");
  expect(new URL(page.url()).searchParams.get("page")).toBe(id);
  const journals = (await (
    await page.request.get("/api/journals")
  ).json()) as PageInfo[];
  expect(journals.map((row) => row.id)).toEqual([id]);
});

test("PAGE-03：日期補寫與月份列表返回原日記，修改標題不改日期", async ({
  page,
  request,
}) => {
  await login(page, request);
  await openJournal(page);
  await page.getByLabel("日記日期", { exact: true }).fill("2024-02-29");
  await go(page, () =>
    page.getByRole("button", { name: "開啟日期日記", exact: true }).click(),
  );
  await saved(page);
  const original = new URL(page.url()).searchParams.get("page");
  await text(page, "補寫二月的日記");
  await menu(page);
  await page.getByLabel("頁面標題", { exact: true }).fill("閏日補寫");
  await page.getByRole("button", { name: "儲存標題", exact: true }).click();
  await expect(page.getByLabel("文件標題", { exact: true })).toHaveValue(
    "閏日補寫",
  );
  await showNavigation(page);
  await go(page, () =>
    page.getByRole("button", { name: "今天", exact: true }).click(),
  );
  await openJournal(page);
  await page.getByLabel("日記月份", { exact: true }).fill("2024-02");
  await page.getByRole("button", { name: "查看月份", exact: true }).click();
  await go(page, () =>
    page
      .getByRole("link", { name: "2024-02-29 閏日補寫", exact: true })
      .click(),
  );
  await expect(page.locator(".tiptap")).toContainText("補寫二月的日記");
  expect(new URL(page.url()).searchParams.get("page")).toBe(original);
});

test("PAGE-04：桌面鍵盤／手機觸控建立子頁、編輯與路徑返回", async ({
  page,
  request,
  isMobile,
}) => {
  await login(page, request);
  await showNavigation(page);
  const add = page.getByRole("button", { name: "新增筆記", exact: true });
  await expect(add).toBeEnabled();
  await go(page, async () => {
    if (isMobile) await add.tap();
    else {
      await add.focus();
      await add.press("Enter");
    }
  });
  await saved(page);
  const parent = new URL(page.url()).searchParams.get("page")!;
  await menu(page);
  await page.getByLabel("頁面標題", { exact: true }).fill("我的上層");
  await page.getByRole("button", { name: "儲存標題", exact: true }).click();
  await expect(page.getByLabel("文件標題", { exact: true })).toHaveValue(
    "我的上層",
  );
  await expect(
    page.getByRole("dialog", { name: "頁面操作", exact: true }),
  ).toBeHidden();
  await menu(page);
  const childButton = page.getByRole("button", {
    name: "新增子頁面",
    exact: true,
  });
  await expect(childButton).toBeEnabled();
  await go(page, async () => {
    if (isMobile) await childButton.tap();
    else {
      await childButton.focus();
      await childButton.press("Enter");
    }
  });
  await saved(page);
  const child = new URL(page.url()).searchParams.get("page")!;
  await text(page, "子頁仍可寫正文");
  expect(
    (await (await page.request.get("/api/pages/" + child)).json()).parent_id,
  ).toBe(parent);
  await go(page, () =>
    page
      .getByRole("navigation", { name: "頁面路徑" })
      .getByRole("link", { name: "我的上層", exact: true })
      .click(),
  );
  await saved(page);
  expect(new URL(page.url()).searchParams.get("page")).toBe(parent);
  await showNavigation(page);
  await go(page, () =>
    page
      .getByRole("navigation", { name: "筆記頁面" })
      .getByRole("link", { name: "未命名", exact: true })
      .click(),
  );
  await expect(page.locator(".tiptap")).toContainText("子頁仍可寫正文");
  await menu(page);
  await page.getByLabel("移動至上層", { exact: true }).selectOption("");
  await page.getByRole("button", { name: "移動頁面", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/pages/" + child)).json())
          .parent_id,
    )
    .toBeNull();
  await expect(
    page.getByRole("navigation", { name: "頁面路徑" }).getByRole("link"),
  ).toHaveCount(0);
});

test("PAGE-06：上層垃圾桶還原保留有效子頁／圖片，先前刪除子頁仍留垃圾桶", async ({
  page,
  request,
}) => {
  await login(page, request);
  const parent = await create(page, "上層");
  const child = await create(page, "有效子頁", parent.id);
  const separate = await create(page, "先刪子頁", parent.id);
  const pixel = await readFile("public/fixtures/pixel.png");
  expect(
    (await request.post("/__test/assets/pixel", { data: pixel })).status(),
  ).toBe(200);
  await openPage(page, child.id);
  await text(page, "子頁與圖片保留");
  await page.evaluate(() => {
    const editor = window.probe!.editor;
    editor.insertBlocks(
      [
        {
          type: "image",
          props: {
            url: "/__test/assets/pixel",
            name: "固定圖片",
            showPreview: true,
          },
        },
      ],
      editor.document[0],
      "after",
    );
  });
  await saved(page);
  await page.request.post(`/api/pages/${separate.id}/delete`, {
    headers: { Origin: "http://127.0.0.1:5173" },
    data: {},
  });
  await openPage(page, parent.id);
  await menu(page);
  await go(page, () => moveToTrash(page));
  await showNavigation(page);
  await page.getByRole("button", { name: "垃圾桶", exact: true }).click();
  const trash = page.getByRole("region", { name: "垃圾桶內容" });
  await trash.getByRole("button", { name: "還原 上層", exact: true }).click();
  await page.getByRole("button", { name: "關閉垃圾桶", exact: true }).click();
  await showNavigation(page);
  await go(page, () =>
    page
      .getByRole("navigation", { name: "筆記頁面" })
      .getByRole("link", { name: "有效子頁", exact: true })
      .click(),
  );
  await expect(page.locator(".tiptap")).toContainText("子頁與圖片保留");
  await expect
    .poll(() =>
      page.evaluate(() => JSON.stringify(window.probe!.editor.document)),
    )
    .toContain("/__test/assets/pixel");
  expect(await (await request.get("/__test/assets/pixel")).body()).toEqual(
    pixel,
  );
  await showNavigation(page);
  await page.getByRole("button", { name: "垃圾桶", exact: true }).click();
  await expect(
    trash.getByRole("button", { name: "還原 先刪子頁", exact: true }),
  ).toBeVisible();
  expect((await page.request.get("/api/pages/" + separate.id)).status()).toBe(
    409,
  );
});

test("PAGE-07：同日期垃圾桶提示還原原日記，還原後正文與 ID 不變", async ({
  page,
  request,
}) => {
  await login(page, request);
  await openJournal(page);
  await page.getByLabel("日記日期", { exact: true }).fill("2024-01-01");
  await go(page, () =>
    page.getByRole("button", { name: "開啟日期日記", exact: true }).click(),
  );
  await saved(page);
  const id = new URL(page.url()).searchParams.get("page")!;
  await text(page, "原日記內容");
  await menu(page);
  await go(page, () => moveToTrash(page));
  await openJournal(page);
  await page.getByLabel("日記日期", { exact: true }).fill("2024-01-01");
  await go(
    page,
    () =>
      page.getByRole("button", { name: "開啟日期日記", exact: true }).click(),
    false,
  );
  await expect(page.getByRole("alert")).toContainText("垃圾桶");
  await go(page, () =>
    page.getByRole("button", { name: "還原此頁", exact: true }).click(),
  );
  await expect(page.locator(".tiptap")).toContainText("原日記內容");
  expect(new URL(page.url()).searchParams.get("page")).toBe(id);
});

test("PAGE-08：中文正文搜尋與導航，刪除上層後排除子樹", async ({
  page,
  request,
}) => {
  await login(page, request);
  const target = await create(page, "搜尋目標");
  const parent = await create(page, "隱藏上層");
  const hidden = await create(page, "中文內容", parent.id);
  await openPage(page, target.id);
  await text(page, "正文的中文內容與搜尋");
  await page.request.post(`/api/pages/${parent.id}/delete`, {
    headers: { Origin: "http://127.0.0.1:5173" },
    data: {},
  });
  await expect
    .poll(async () =>
      (
        (await (
          await page.request.get(
            "/api/search?q=" + encodeURIComponent("中文內容"),
          )
        ).json()) as PageInfo[]
      ).map((item) => item.id),
    )
    .toEqual([target.id]);
  await page.getByRole("button", { name: "搜尋筆記", exact: true }).click();
  await page.getByLabel("搜尋文字", { exact: true }).fill("中文內容");
  await page.getByRole("button", { name: "搜尋", exact: true }).click();
  const results = page.getByRole("region", { name: "搜尋結果" });
  await expect(results.getByRole("link")).toHaveCount(1);
  await go(page, () =>
    results.getByRole("link", { name: "搜尋目標", exact: true }).click(),
  );
  await expect(page.locator(".tiptap")).toContainText("正文的中文內容與搜尋");
  expect((await page.request.get("/api/pages/" + hidden.id)).status()).toBe(
    409,
  );
});

test("PAGE-LOCAL-01：本機保存失敗時保留原頁與草稿，不繼續導覽", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (failure) => errors.push(failure.message));
  await login(page, request);
  const note = await create(page, "本機錯誤");
  await openPage(page, note.id);
  const original = page.url();
  await page.evaluate(() => {
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
      if (args[1] === "readwrite")
        throw new DOMException("測試容量不足", "QuotaExceededError");
      return Reflect.apply(transaction, this, args);
    };
    const editor = window.probe!.editor;
    editor.updateBlock(editor.document[0].id, { content: "記憶體中的草稿" });
  });
  await expect(page.getByTestId("local-status")).toHaveText("本機儲存失敗");
  await showNavigation(page);
  await page.getByRole("button", { name: "今天", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("本機儲存失敗");
  expect(page.url()).toBe(original);
  await expect(page.locator(".tiptap")).toContainText("記憶體中的草稿");
  await menu(page);
  await moveToTrash(page);
  await expect(page.getByRole("alert")).toContainText("本機儲存失敗");
  expect(
    (await (await page.request.get("/api/pages/" + note.id)).json()).deleted_at,
  ).toBeNull();
  await page.evaluate(() => {
    const original = window.fetch;
    window.fetch = (input, init) =>
      String(input).startsWith("/api/pages/")
        ? Promise.reject(new Error("測試權限查詢斷線"))
        : original(input, init);
    window.probe!.provider.emit("connection-close", [
      new CloseEvent("close", { code: 4002 }),
    ]);
  });
  await expect(page.getByTestId("cloud-status")).toHaveText("連線失敗，可重試");
  expect(errors).toEqual([]);
});
