import {
  test,
  expect,
  type BrowserContext,
  type Page,
  type WebSocketRoute,
} from "@playwright/test";
import { openPrivate, saved } from "./helpers";
import { origin } from "./ports";

const headers = { Origin: origin };

test.beforeEach(async ({ request }) => {
  await request.post("/__test/reset");
  await request.post("/__test/control", {
    data: { now: Date.now() + 86400000 },
  });
});

// 延後同步 WebSocket 連到伺服器；連上前頁面送出的訊息先暫存再依序轉送。
async function delaySync(target: Page | BrowserContext, ms: number) {
  const closeCode = (code: number | undefined) =>
    code === 1000 || (code !== undefined && code >= 3000) ? { code } : {};
  await target.routeWebSocket(/\/parties\//, (ws) => {
    const pending: (string | Buffer)[] = [];
    let server: WebSocketRoute | undefined;
    ws.onMessage((message) =>
      server ? server.send(message) : pending.push(message),
    );
    ws.onClose((code) => server?.close(closeCode(code)));
    setTimeout(() => {
      server = ws.connectToServer();
      server.onMessage((message) => ws.send(message));
      server.onClose((code) => ws.close(closeCode(code)));
      for (const message of pending.splice(0)) server.send(message);
    }, ms);
  });
}

async function prepareNote(page: Page, text: string) {
  await openPrivate(page);
  const response = await page.request.post("/api/pages", {
    headers,
    data: { title: "本機優先", parent_id: null },
  });
  const id = ((await response.json()) as { id: string }).id;
  await page.goto("/?page=" + id);
  await saved(page);
  await page.evaluate((text) => {
    const editor = window.probe!.editor;
    editor.updateBlock(editor.document[0], { content: text });
  }, text);
  await saved(page);
  return id;
}

test("UX-21：雲端連線緩慢時，已下載頁面立即可編輯並在背景保存", async ({
  page,
  browser,
}) => {
  const id = await prepareNote(page, "本機已有的內容");
  await delaySync(page, 3000);
  await page.reload();
  await expect(page.getByTestId("ready")).toHaveText("可編輯", {
    timeout: 2000,
  });
  await expect(page.locator(".tiptap")).toContainText("本機已有的內容");
  await expect(page.locator(".cloud-indicator")).toHaveAttribute(
    "data-state",
    "syncing",
  );
  await expect(
    page.getByRole("button", { name: "重試儲存", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    const editor = window.probe!.editor;
    editor.insertBlocks(
      [{ type: "paragraph", content: "連線前寫下的字" }],
      editor.document[0],
      "after",
    );
  });
  await expect(page.getByTestId("cloud-status")).toHaveText("雲端已儲存", {
    timeout: 10000,
  });
  const other = await browser.newContext({
    storageState: {
      cookies: (await page.context().storageState()).cookies,
      origins: [],
    },
  });
  try {
    const fresh = await other.newPage();
    await fresh.goto("/?page=" + id);
    await expect(fresh.getByTestId("ready")).toHaveText("可編輯");
    await expect(fresh.locator(".tiptap")).toContainText("連線前寫下的字");
  } finally {
    await other.close();
  }
});

test("UX-22：未下載的頁面等雲端內容到達後才可編輯", async ({
  page,
  browser,
}) => {
  const id = await prepareNote(page, "只在雲端的內容");
  const other = await browser.newContext({
    storageState: {
      cookies: (await page.context().storageState()).cookies,
      origins: [],
    },
  });
  try {
    await delaySync(other, 2500);
    const fresh = await other.newPage();
    const started = Date.now();
    await fresh.goto("/?page=" + id);
    await fresh.waitForTimeout(Math.max(0, 1500 - (Date.now() - started)));
    await expect(fresh.locator('.tiptap[contenteditable="true"]')).toHaveCount(
      0,
    );
    await expect(fresh.getByTestId("ready")).toHaveText("可編輯", {
      timeout: 10000,
    });
    await expect(fresh.locator(".tiptap")).toContainText("只在雲端的內容");
  } finally {
    await other.close();
  }
});
