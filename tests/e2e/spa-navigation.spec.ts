import { test, expect, type Page } from "@playwright/test";
import { openPrivate, saved, showNavigation } from "./helpers";
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

// 在頁面內記錄同步連線，直接以 readyState 判斷目前文件仍開著幾條。
async function trackSockets(page: Page) {
  await page.addInitScript(() => {
    const sockets: WebSocket[] = [];
    (window as unknown as { syncSockets: WebSocket[] }).syncSockets = sockets;
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (String(url).includes("/parties/")) sockets.push(this);
      }
    };
  });
  return () =>
    page.evaluate(
      () =>
        (window as unknown as { syncSockets: WebSocket[] }).syncSockets.filter(
          (socket) => socket.readyState < WebSocket.CLOSING,
        ).length,
    );
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
  const header = await page.locator(".mantine-AppShell-header").elementHandle();
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

test("UX-20：伺服器有新版時換頁改為整頁載入，查詢失敗仍站內切換", async ({
  page,
}) => {
  await openPrivate(page);
  const a = await createNote(page, "甲頁");
  const b = await createNote(page, "乙頁");
  await openPage(page, a);
  await page.evaluate(() => {
    const original = window.fetch;
    window.fetch = async (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        location.href,
      );
      const response = await original(input, init);
      if (url.pathname !== "/") return response;
      const html = (await response.text()).replace(
        /src="[^"]*\/(index|main)[^"]*"/,
        'src="/assets/index-NEWBUILD.js"',
      );
      return new Response(html, {
        headers: { "Content-Type": "text/html" },
      });
    };
  });
  await mark(page);
  await clickNote(page, "乙頁");
  await arrive(page, b, "乙頁");
  expect(await marked(page)).toBe(false);
  await page.evaluate(() => {
    const original = window.fetch;
    window.fetch = (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        location.href,
      );
      return url.pathname === "/"
        ? Promise.reject(new TypeError("離線"))
        : original(input, init);
    };
  });
  await mark(page);
  await clickNote(page, "甲頁");
  await arrive(page, a, "甲頁");
  expect(await marked(page)).toBe(true);
});
