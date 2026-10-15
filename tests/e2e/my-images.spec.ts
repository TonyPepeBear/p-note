import { expect, test, type Page } from "@playwright/test";
import { images } from "../fixtures/images";
import {
  blocks,
  gate,
  heldCount,
  openPrivate,
  release,
  saved,
  showNavigation,
} from "./helpers";
import { origin } from "./ports";

type AssetInfo = {
  id: string;
  original_name: string;
  mime_type: string;
  byte_size: number;
  created_at: number;
  url: string;
};
type AssetList = {
  items: AssetInfo[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
};

const listPattern = "^/api/assets(?:\\?|$)";
const original = Buffer.from(images.png);

// 使用真正上傳 API 建立原檔與 metadata，不插入文件區塊，涵蓋未被頁面使用的圖片。
async function upload(page: Page, name: string, createdAt: number) {
  const control = await page.request.post("/__test/control", {
    data: { now: createdAt },
  });
  expect(control.ok()).toBe(true);
  const response = await page.request.post("/api/assets", {
    headers: {
      Origin: origin,
      "Content-Type": "image/png",
      "X-File-Name": encodeURIComponent(name),
    },
    data: original,
  });
  expect(response.status()).toBe(201);
  const { id, url } = (await response.json()) as { id: string; url: string };
  return {
    id,
    url,
    original_name: name,
    mime_type: "image/png",
    byte_size: original.length,
    created_at: createdAt,
  } satisfies AssetInfo;
}

async function openImages(page: Page) {
  await showNavigation(page);
  await page
    .getByRole("navigation", { name: "工作區管理", exact: true })
    .getByRole("button", { name: "我的圖片", exact: true })
    .click();
  const view = page.getByRole("region", { name: "我的圖片", exact: true });
  await expect(view).toBeVisible();
  await expect(
    view.getByRole("heading", { name: "我的圖片", exact: true, level: 1 }),
  ).toBeVisible();
  return view;
}

async function returnToDocument(page: Page) {
  await page.getByRole("button", { name: "返回文件", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "我的圖片", exact: true }),
  ).toBeHidden();
  await expect(page.locator('.tiptap[contenteditable="true"]')).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await request.post("/__test/reset");
  await request.post("/__test/control", {
    data: { now: Date.now() + 86400000 },
  });
});

test("ASSET-07：21 張真實上傳依時間由新到舊，兩頁沒有遺漏或重複", async ({
  page,
}) => {
  test.setTimeout(45_000);
  await openPrivate(page);
  const oldest = Date.now() + 86400000;
  const uploaded: AssetInfo[] = [];
  for (let index = 0; index < 21; index++) {
    uploaded.push(
      await upload(
        page,
        `分頁原圖-${String(index + 1).padStart(2, "0")}.png`,
        oldest + index * 1000,
      ),
    );
  }
  const expected = [...uploaded].reverse();
  const requests: URL[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === "/api/assets")
      requests.push(url);
  });
  const view = await openImages(page);
  const cards = view.getByRole("article");
  await expect(cards).toHaveCount(20);
  expect(
    await cards.evaluateAll((items) =>
      items.map((item) => item.getAttribute("aria-label")),
    ),
  ).toEqual(expected.slice(0, 20).map((asset) => asset.original_name));
  await expect(view.getByText("第 1 / 2 頁", { exact: true })).toBeVisible();
  await expect(view.getByText("共 21 張圖片", { exact: true })).toBeVisible();
  await expect(
    view.getByRole("button", { name: "上一頁", exact: true }),
  ).toBeDisabled();
  expect(requests.at(-1)?.searchParams.get("page")).toBe("1");
  expect(requests.at(-1)?.searchParams.get("page_size")).toBe("20");
  const firstResponse = await page.request.get(
    "/api/assets?page=1&page_size=20",
  );
  expect(firstResponse.status()).toBe(200);
  const first = (await firstResponse.json()) as AssetList;
  expect(first).toMatchObject({
    items: expected.slice(0, 20),
    page: 1,
    page_size: 20,
    total: 21,
    total_pages: 2,
  });

  await view.getByRole("button", { name: "下一頁", exact: true }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards).toHaveAttribute("aria-label", expected[20].original_name);
  await expect(view.getByText("第 2 / 2 頁", { exact: true })).toBeVisible();
  await expect(
    view.getByRole("button", { name: "上一頁", exact: true }),
  ).toBeEnabled();
  await expect(
    view.getByRole("button", { name: "下一頁", exact: true }),
  ).toBeDisabled();
  expect(requests.at(-1)?.searchParams.get("page")).toBe("2");
  expect(requests.at(-1)?.searchParams.get("page_size")).toBe("20");
  const secondResponse = await page.request.get(
    "/api/assets?page=2&page_size=20",
  );
  expect(secondResponse.status()).toBe(200);
  const second = (await secondResponse.json()) as AssetList;
  expect(second).toMatchObject({
    items: expected.slice(20),
    page: 2,
    page_size: 20,
    total: 21,
    total_pages: 2,
  });
  const ids = [...first.items, ...second.items].map((asset) => asset.id);
  expect(ids).toEqual(expected.map((asset) => asset.id));
  expect(new Set(ids).size).toBe(21);

  await view.getByRole("button", { name: "上一頁", exact: true }).click();
  await expect(cards).toHaveCount(20);
  expect(
    await cards.evaluateAll((items) =>
      items.map((item) => item.getAttribute("aria-label")),
    ),
  ).toEqual(expected.slice(0, 20).map((asset) => asset.original_name));
});

test("ASSET-08：唯讀列表顯示私有縮圖與 metadata，返回同一文件保存草稿且手機不溢出", async ({
  page,
  request,
}) => {
  await openPrivate(page);
  const documentUrl = page.url();
  const name = `未引用的中文原始圖片-${"很長的檔名".repeat(12)}.png`;
  const asset = await upload(page, name, Date.now() + 86400000);
  expect(JSON.stringify(await blocks(page))).not.toContain(asset.id);
  await page.evaluate(() => {
    const editor = window.probe!.editor;
    (window as unknown as { editorBeforeImages: typeof editor }).editorBeforeImages = editor;
    editor.updateBlock(editor.document[0], { content: "開啟我的圖片前立即輸入的草稿" });
  });

  const view = await openImages(page);
  const card = view.getByRole("article", { name, exact: true });
  await expect(card).toBeVisible();
  for (const field of ["原始檔名", "格式", "大小", "上傳時間"])
    await expect(card.getByText(field, { exact: true })).toBeVisible();
  await expect(card.getByText(name, { exact: true })).toBeVisible();
  await expect(card).toContainText(/image\/png|PNG/);
  await expect(card).toContainText(
    new RegExp(`${original.length}\\s*(?:B|bytes|位元組)`),
  );
  const time = card.locator("time");
  await expect(time).toHaveAttribute(
    "datetime",
    new Date(asset.created_at).toISOString(),
  );
  await expect(time).toHaveText(/\d/);
  const thumbnail = card.getByRole("img", { name, exact: true });
  await expect(thumbnail).toHaveAttribute("src", asset.url);
  await expect(thumbnail).toHaveAttribute("loading", "lazy");
  await expect
    .poll(() =>
      thumbnail.evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
      ),
    )
    .toBe(true);
  expect(asset.url).toBe(`/api/assets/${asset.id}`);
  const originalResponse = await page.request.get(asset.url);
  expect(originalResponse.status()).toBe(200);
  expect(await originalResponse.body()).toEqual(original);
  expect((await request.get(asset.url)).status()).toBe(401);
  expect((await request.get("/api/assets?page=1&page_size=20")).status()).toBe(401);
  await expect(view.getByRole("button", { name: /刪除|移到垃圾桶/ })).toHaveCount(0);
  await expect(view.getByText(/使用頁面|引用頁面|使用此圖片的頁面/)).toHaveCount(0);
  await expect(page).toHaveURL(documentUrl);

  // fast 桌面專案也以窄螢幕驗證長檔名；完整驗收再涵蓋手機瀏覽器。
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(card).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await returnToDocument(page);
  expect(
    await page.evaluate(
      () =>
        window.probe!.editor ===
        (window as unknown as { editorBeforeImages: unknown }).editorBeforeImages,
    ),
  ).toBe(true);
  await expect(page).toHaveURL(documentUrl);
  await expect(page.locator(".tiptap")).toContainText(
    "開啟我的圖片前立即輸入的草稿",
  );
  await saved(page);
  await openImages(page);
  await page
    .getByRole("navigation", { name: "頁面路徑", exact: true })
    .getByRole("button", { name: "返回目前文件", exact: true })
    .click();
  await expect(view).toBeHidden();
  await expect(page.locator('.tiptap[contenteditable="true"]')).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        window.probe!.editor ===
        (window as unknown as { editorBeforeImages: unknown }).editorBeforeImages,
    ),
  ).toBe(true);
  await expect(page).toHaveURL(documentUrl);
  await expect(page.locator(".tiptap")).toContainText(
    "開啟我的圖片前立即輸入的草稿",
  );
  await saved(page);
  await page.reload();
  await saved(page);
  await expect(page.locator(".tiptap")).toContainText(
    "開啟我的圖片前立即輸入的草稿",
  );
});

test("ASSET-08：草稿本機儲存失敗時保留文件，不開啟我的圖片並顯示錯誤", async ({
  page,
}) => {
  await openPrivate(page);
  const documentUrl = page.url();
  await page.locator(".tiptap").fill("開啟圖片列表失敗時仍保留的草稿");
  await saved(page);
  // 導覽必須先完成 saveDraft；讓本機交易失敗，驗證不會切換到圖片列表。
  await page.evaluate(() => {
    IDBDatabase.prototype.transaction = function () {
      throw new DOMException("測試容量不足", "QuotaExceededError");
    };
  });
  await showNavigation(page);
  await page
    .getByRole("navigation", { name: "工作區管理", exact: true })
    .getByRole("button", { name: "我的圖片", exact: true })
    .click();
  const closeNavigation = page.getByRole("button", { name: "關閉導覽", exact: true });
  if (await closeNavigation.isVisible()) await closeNavigation.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "本機儲存失敗" }).first(),
  ).toBeVisible();
  await expect(page.locator('.tiptap[contenteditable="true"]')).toBeVisible();
  await expect(page.locator(".tiptap")).toContainText(
    "開啟圖片列表失敗時仍保留的草稿",
  );
  await expect(
    page.getByRole("region", { name: "我的圖片", exact: true }),
  ).toBeHidden();
  await expect(page).toHaveURL(documentUrl);
});

test("ASSET-08：開啟圖片的保存尚未完成時切換文件，過期保存不得重開圖片列表", async ({
  page,
}) => {
  await openPrivate(page);
  const response = await page.request.post("/api/pages", {
    headers: { Origin: origin },
    data: { title: "保存等待期間切換的新文件", parent_id: null },
  });
  expect(response.status()).toBe(200);
  const next = (await response.json()) as { id: string };
  await showNavigation(page);
  await page.evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(
      IDBTransaction.prototype,
      "oncomplete",
    );
    if (!descriptor?.set) throw new Error("測試瀏覽器須支援交易完成 setter");
    const nativeSet = descriptor.set;
    const editorDatabase = window.probe!.cache.db;
    const delayed = { held: false, released: false, release: undefined as (() => void) | undefined };
    (window as unknown as { delayedImageDraft: typeof delayed }).delayedImageDraft = delayed;
    Object.defineProperty(IDBTransaction.prototype, "oncomplete", {
      ...descriptor,
      set: function (
        this: IDBTransaction,
        callback: ((this: IDBTransaction, event: Event) => unknown) | null,
      ) {
        const stores = Array.from(this.objectStoreNames);
        if (
          this.db === editorDatabase &&
          this.mode === "readwrite" &&
          stores.length === 2 &&
          stores.includes("updates") &&
          stores.includes("custom") &&
          typeof callback === "function"
        ) {
          // 原交易照常提交，僅延後 saveDraft 的完成通知；後續交易使用原 setter。
          Object.defineProperty(IDBTransaction.prototype, "oncomplete", descriptor);
          const transaction = this;
          nativeSet.call(transaction, (event: Event) => {
            delayed.held = true;
            delayed.release = () => {
              callback.call(transaction, event);
              delayed.released = true;
            };
          });
        } else nativeSet.call(this, callback);
      },
    });
  });
  await page
    .getByRole("navigation", { name: "工作區管理", exact: true })
    .getByRole("button", { name: "我的圖片", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { delayedImageDraft: { held: boolean } }).delayedImageDraft.held,
      ),
    )
    .toBe(true);
  const view = page.getByRole("region", { name: "我的圖片", exact: true });
  await expect(view).toBeHidden();
  await page.evaluate((id) => {
    history.pushState({ scrollY: 0 }, "", "/?page=" + encodeURIComponent(id));
    window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
  }, next.id);
  await expect(page.getByLabel("文件標題", { exact: true })).toHaveValue(
    "保存等待期間切換的新文件",
  );
  await expect(page.getByTestId("ready")).toHaveText("可編輯");
  await saved(page);
  await page.evaluate(async () => {
    const delayed = (window as unknown as {
      delayedImageDraft: { release?: () => void; released: boolean };
    }).delayedImageDraft;
    if (!delayed.release) throw new Error("必須先攔住原保存的完成通知");
    delayed.release();
    // 等待 Promise 回呼與 React 繪製，避免在過期切換實際執行前就完成斷言。
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  expect(
    await page.evaluate(
      () => (window as unknown as { delayedImageDraft: { released: boolean } }).delayedImageDraft.released,
    ),
  ).toBe(true);
  await expect(view).toBeHidden();
  await expect(page.getByLabel("文件標題", { exact: true })).toHaveValue(
    "保存等待期間切換的新文件",
  );
  await expect(page).toHaveURL(new RegExp(`\\?page=${next.id}$`));
  await expect(page.locator('.tiptap[contenteditable="true"]')).toBeVisible();
});

test("ASSET-09：列表請求完成前顯示載入狀態，回應後顯示圖片", async ({
  page,
}) => {
  await openPrivate(page);
  const asset = await upload(page, "等待列表載入的圖片.png", Date.now() + 86400000);
  await gate(page, [{ pattern: listPattern, hold: true, result: "pass" }]);
  const view = await openImages(page);
  await expect.poll(() => heldCount(page, listPattern)).toBe(1);
  await expect(view.getByRole("status")).toHaveText("載入圖片中…");
  await expect(view.getByRole("article")).toHaveCount(0);
  await expect(view.getByText("還沒有上傳圖片", { exact: true })).toHaveCount(0);
  await release(page, listPattern);
  await expect(
    view.getByRole("article", { name: asset.original_name, exact: true }),
  ).toBeVisible();
  await expect(
    view.getByRole("status").filter({ hasText: "載入圖片中…" }),
  ).toHaveCount(0);
});

test("ASSET-09：空集合、列表失敗重試、縮圖失敗與 401 均有明確結果", async ({
  page,
}) => {
  await openPrivate(page);
  let view = await openImages(page);
  await expect(view.getByText("還沒有上傳圖片", { exact: true })).toBeVisible();
  await expect(view.getByRole("article")).toHaveCount(0);
  await expect(view.getByRole("alert")).toHaveCount(0);
  await returnToDocument(page);

  const asset = await upload(page, "縮圖錯誤仍保留 metadata.png", Date.now() + 86400000);
  await gate(page, [{ pattern: listPattern, result: 503 }]);
  view = await openImages(page);
  await expect(view.getByRole("alert")).toContainText(
    "圖片列表載入失敗，請重試",
  );
  await expect(view.getByRole("button", { name: "重試", exact: true })).toBeVisible();
  await expect(view.getByText("還沒有上傳圖片", { exact: true })).toHaveCount(0);
  await expect(view.getByRole("article")).toHaveCount(0);

  await page.route(`**${asset.url}`, (route) =>
    route.fulfill({ status: 503, body: "測試原檔暫時無法讀取" }),
  );
  await gate(page, [{ pattern: listPattern, result: "pass" }]);
  await view.getByRole("button", { name: "重試", exact: true }).click();
  const card = view.getByRole("article", { name: asset.original_name, exact: true });
  await expect(card).toBeVisible();
  await expect(view.getByRole("article")).toHaveCount(1);
  await expect(card.getByText("縮圖無法載入", { exact: true })).toBeVisible();
  await expect(card.getByText(asset.original_name, { exact: true })).toBeVisible();
  await expect(card).toContainText(/image\/png|PNG/);
  await expect(view.getByRole("alert")).toHaveCount(0);
  await expect(view.getByRole("button", { name: "重試", exact: true })).toHaveCount(0);
  await expect(view.getByText("共 1 張圖片", { exact: true })).toBeVisible();

  await returnToDocument(page);
  await gate(page, [{ pattern: listPattern, result: 401 }]);
  await showNavigation(page);
  await page.getByRole("button", { name: "我的圖片", exact: true }).click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "我的圖片", exact: true }),
  ).toBeHidden();
  await expect(page.getByRole("article", { name: asset.original_name, exact: true })).toHaveCount(0);
});
