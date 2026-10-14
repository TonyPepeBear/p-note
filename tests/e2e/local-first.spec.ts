import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
  type WebSocketRoute,
} from "@playwright/test";
import {
  openPrivate,
  saved,
  gate,
  setRule,
  release,
  heldCount,
  trackSockets,
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

const PAGE_API = "^/api/pages/[^/?]+$";
const VERSION = "^/$";

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

async function addText(page: Page, text: string) {
  await page.evaluate((text) => {
    const editor = window.probe!.editor;
    editor.insertBlocks(
      [{ type: "paragraph", content: text }],
      editor.document.at(-1)!,
      "after",
    );
  }, text);
  await expect(page.getByTestId("local-status")).toHaveText("本機已儲存");
}

const go = (page: Page, id: string) =>
  page.evaluate((id) => {
    document.querySelector<HTMLAnchorElement>(`a.note-link[href="/?page=${id}"]`)!.click();
  }, id);

async function cloudText(page: Page, browser: Browser, id: string) {
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
    await saved(fresh);
    return (await fresh.locator(".tiptap").textContent()) ?? "";
  } finally {
    await other.close();
  }
}

test("LFN-02：網路請求未回應時，已下載頁面 500 毫秒內切換並可寫入本機", async ({
  page,
  browser,
}) => {
  const sockets = await trackSockets(page);
  await openPrivate(page);
  const a = await createNote(page, "甲頁");
  const b = await createNote(page, "乙頁");
  await openPage(page, b);
  await setText(page, ...Array.from({ length: 20 }, (_, i) => `乙第 ${i + 1} 段`));
  await openPage(page, a);
  await setText(page, "甲的內容");
  await gate(page, [
    { pattern: VERSION, hold: true },
    { pattern: PAGE_API, hold: true },
  ]);
  const elapsed = await page.evaluate(async (b) => {
    const started = performance.now();
    document.querySelector<HTMLAnchorElement>(`a.note-link[href="/?page=${b}"]`)!.click();
    const done = () =>
      document.querySelector('[data-testid="ready"]')?.textContent === "可編輯" &&
      document.querySelector<HTMLTextAreaElement>('[aria-label="文件標題"]')?.value === "乙頁" &&
      document.querySelector('.tiptap[contenteditable="true"]')?.textContent?.includes("乙第 20 段");
    while (!done() && performance.now() - started < 5000)
      await new Promise((resolve) => requestAnimationFrame(resolve));
    return performance.now() - started;
  }, b);
  expect(elapsed).toBeLessThan(500);
  await addText(page, "驗證前寫下的字");
  await expect(page.getByTestId("cloud-status")).toHaveText("同步中");
  await page.waitForTimeout(3000);
  await expect(page.getByTestId("cloud-status")).toHaveText("同步中");
  expect(await heldCount(page, PAGE_API)).toBeGreaterThan(0);
  expect(await sockets()).toBe(0);
  await release(page, PAGE_API);
  await release(page, VERSION);
  await saved(page);
  expect(await cloudText(page, browser, b)).toContain("驗證前寫下的字");
});

test("LFN-03：上一頁、下一頁與重新整理不等頁面資訊即恢復本機內容", async ({
  page,
}) => {
  await openPrivate(page);
  const a = await createNote(page, "長頁");
  const b = await createNote(page, "短頁");
  await openPage(page, b);
  await setText(page, "短頁內容");
  await openPage(page, a);
  await setText(
    page,
    ...Array.from({ length: 80 }, (_, i) => `第 ${i + 1} 段，讓頁面夠長可以捲動。`),
  );
  await page.evaluate(() => window.scrollTo(0, 900));
  await expect.poll(() => page.evaluate(() => Math.round(scrollY))).toBeGreaterThan(400);
  const before = await page.evaluate(() => Math.round(scrollY));
  await gate(page, []);
  await go(page, b);
  await expect(page.getByLabel("文件標題", { exact: true })).toHaveValue("短頁");
  await saved(page);
  await setRule(page, { pattern: PAGE_API, hold: true });
  await page.goBack();
  await expect(page.getByLabel("文件標題", { exact: true })).toHaveValue("長頁");
  await expect(page.getByTestId("ready")).toHaveText("可編輯");
  await expect(page.locator(".tiptap")).toContainText("第 80 段");
  await expect
    .poll(() => page.evaluate(() => Math.round(scrollY)))
    .toBeGreaterThanOrEqual(before - 4);
  expect(await page.evaluate(() => Math.round(scrollY))).toBeLessThanOrEqual(before + 4);
  await page.goForward();
  await expect(page.getByLabel("文件標題", { exact: true })).toHaveValue("短頁");
  await expect(page.getByTestId("ready")).toHaveText("可編輯");
  await expect(page.locator(".tiptap")).toContainText("短頁內容");
  expect(await heldCount(page, PAGE_API)).toBeGreaterThan(0);
  await gate(page, [{ pattern: PAGE_API, hold: true }], true);
  await page.reload();
  await expect(page.getByTestId("ready")).toHaveText("可編輯");
  await expect(page.locator(".tiptap")).toContainText("短頁內容");
  expect(await heldCount(page, PAGE_API)).toBeGreaterThan(0);
});

test("LFN-03：今天入口只在有今天的本機日記時直接開啟", async ({
  page,
  request,
}) => {
  await request.post("/__test/control", { data: { now: Date.now() } });
  await openPrivate(page);
  await setText(page, "今天的日記");
  const held = "^/api/(today|pages/[^/?]+$)";
  await gate(page, [{ pattern: held, hold: true }], true);
  await page.goto("/");
  await expect(page.getByTestId("ready")).toHaveText("可編輯");
  await expect(page.locator(".tiptap")).toContainText("今天的日記");
  expect(await heldCount(page, held)).toBeGreaterThan(0);
  await page.clock.setSystemTime(Date.now() + 86400000);
  await page.goto("/");
  await page.waitForTimeout(1000);
  await expect(page.locator(".tiptap")).toHaveCount(0);
  expect(await heldCount(page, "^/api/today")).toBeGreaterThan(0);
  await release(page, held);
  await expect(page.getByTestId("ready")).toHaveText("可編輯");
});

for (const kind of ["缺少正文", "損毀索引", "不同擁有者"] as const)
  test(`LFN-04：${kind}的快取不冒充可用文件`, async ({ page }) => {
    await openPrivate(page);
    const id = await createNote(page, "快取頁");
    await openPage(page, id);
    await setText(page, "雲端正文");
    await page.goto("/sw.js");
    await page.evaluate(
      async ([kind, id]) => {
        const owner = localStorage.getItem("p-note:owner")!;
        const key = `p-note:page:${owner}:${id}`;
        if (kind === "缺少正文")
          for (const db of await indexedDB.databases())
            if (db.name?.startsWith("p-note:"))
              await new Promise((done) => {
                const request = indexedDB.deleteDatabase(db.name!);
                request.onsuccess = request.onerror = request.onblocked = done;
              });
        if (kind === "損毀索引") localStorage.setItem(key, "{損毀");
        if (kind === "不同擁有者") {
          const page = JSON.parse(localStorage.getItem(key)!);
          localStorage.setItem("p-note:owner", "intruder");
          localStorage.setItem(
            `p-note:page:intruder:${id}`,
            JSON.stringify({ ...page, owner_id: "intruder", ancestors: [] }),
          );
        }
      },
      [kind, id],
    );
    await page.context().setOffline(true);
    await page.goto("/?page=" + id);
    await expect(page.getByRole("alert")).toContainText("尚未下載");
    await expect(page.locator(".tiptap")).toHaveCount(0);
    await page.context().setOffline(false);
    await gate(page, [{ pattern: PAGE_API, hold: true }], true);
    await page.goto("/?page=" + id);
    await page.waitForTimeout(1000);
    await expect(page.locator(".tiptap")).toHaveCount(0);
    await release(page, PAGE_API);
    await expect(page.getByTestId("ready")).toHaveText("可編輯");
    await expect(page.locator(".tiptap")).toContainText("雲端正文");
  });

test("LFN-04：已知登出後不以本機快取繞過登入", async ({ page }) => {
  await openPrivate(page);
  const id = await createNote(page, "登出前的頁");
  await openPage(page, id);
  await setText(page, "登出前內容");
  await showNavigation(page);
  await page.getByRole("button", { name: "登出", exact: true }).click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await gate(page, [{ pattern: "^/api/", hold: true }], true);
  await page.goto("/?page=" + id);
  await page.waitForTimeout(1000);
  await expect(page.locator(".tiptap")).toHaveCount(0);
  await release(page, "^/api/");
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page.locator(".tiptap")).toHaveCount(0);
});

const invalid = ["登入到期", "刪頁", "撤銷權限", "擁有者改變", "還原版本", "撤銷且本機保存失敗"] as const;
for (const reason of invalid)
  test(`LFN-05：驗證期間的草稿在${reason}時保留且不寫回`, async ({ page, browser }) => {
    const sockets = await trackSockets(page);
    await openPrivate(page);
    const id = await createNote(page, "驗證頁");
    await openPage(page, id);
    await setText(page, "雲端原稿");
    const backup =
      reason === "還原版本"
        ? ((await (await page.request.post("/api/backups", { headers, data: {} })).json()) as { id: string })
        : undefined;
    await gate(page, [{ pattern: PAGE_API, hold: true }], true);
    await page.reload();
    await expect(page.getByTestId("ready")).toHaveText("可編輯");
    await addText(page, "驗證期間的新字");
    if (reason === "登入到期")
      expect((await page.request.post("/api/logout", { headers, data: {} })).ok()).toBe(true);
    if (reason === "刪頁")
      expect((await page.request.post(`/api/pages/${id}/delete`, { headers, data: {} })).ok()).toBe(true);
    if (reason === "還原版本")
      expect(
        (await page.request.post(`/api/backups/${backup!.id}/restore`, {
          headers,
          data: { request_id: "restore-lfn-05" },
        })).ok(),
      ).toBe(true);
    if (reason.startsWith("撤銷")) await setRule(page, { pattern: PAGE_API, result: 403 });
    if (reason === "擁有者改變")
      await setRule(page, { pattern: PAGE_API, result: { json: { owner_id: "other-owner" } } });
    if (reason === "撤銷且本機保存失敗")
      await page.evaluate(() => {
        IDBDatabase.prototype.transaction = function () {
          throw new DOMException("測試容量不足", "QuotaExceededError");
        };
      });
    await release(page, PAGE_API);
    await expect(page.locator('.tiptap[contenteditable="true"]')).toHaveCount(0);
    if (reason === "登入到期") await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    else if (reason === "刪頁") await expect(page.getByText("這頁在垃圾桶中")).toBeVisible();
    else await expect(page.getByRole("button", { name: "檢視本機草稿", exact: true })).toBeVisible();
    if (reason === "還原版本")
      await expect(page.getByRole("button", { name: "載入目前版本", exact: true })).toBeVisible();
    if (reason === "撤銷且本機保存失敗")
      await expect(page.getByRole("alert").first()).toContainText("本機儲存失敗");
    if (reason !== "登入到期")
      await page.getByRole("button", { name: "檢視本機草稿", exact: true }).click();
    await expect(page.locator(".tiptap")).toContainText("驗證期間的新字");
    await expect(page.locator(".tiptap")).toHaveAttribute("contenteditable", "false");
    expect(await sockets()).toBe(0);
    if (reason === "撤銷且本機保存失敗") return;
    if (reason === "登入到期") {
      await gate(page, [{ pattern: "^/api/", hold: true }], true);
      await page.reload();
      await page.waitForTimeout(1000);
      await expect(page.locator(".tiptap")).toHaveCount(0);
      await release(page, "^/api/");
      await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
      return;
    }
    if (reason !== "刪頁") expect(await cloudText(page, browser, id)).not.toContain("驗證期間的新字");
    await gate(
      page,
      reason === "撤銷權限"
        ? [{ pattern: PAGE_API, result: 403 }]
        : reason === "擁有者改變"
          ? [{ pattern: PAGE_API, result: { json: { owner_id: "other-owner" } } }]
          : [],
      true,
    );
    await page.reload();
    await page.getByRole("button", { name: "檢視本機草稿", exact: true }).click();
    await expect(page.locator(".tiptap")).toContainText("驗證期間的新字");
  });

for (const failure of ["reject", 500] as const)
  test(`LFN-06：背景驗證${failure === "reject" ? "斷線" : " 500"} 後恢復，原編輯器完成同步`, async ({
    page,
    browser,
  }) => {
    await openPrivate(page);
    const id = await createNote(page, "暫時失敗頁");
    await openPage(page, id);
    await setText(page, "原本內容");
    await gate(page, [{ pattern: PAGE_API, result: failure }], true);
    await page.reload();
    await expect(page.getByTestId("ready")).toHaveText("可編輯");
    expect(
      (await page.request.post(`/api/pages/${id}/title`, { headers, data: { title: "遠端新標題" } })).ok(),
    ).toBe(true);
    await page.evaluate(() => {
      const editor = window.probe!.editor;
      editor.setTextCursorPosition(editor.document.at(-1)!, "end");
      editor.focus();
      (document.querySelector(".tiptap") as HTMLElement & { marker?: number }).marker = 1;
    });
    await page.keyboard.type("失敗期間的字");
    await expect(page.getByTestId("local-status")).toHaveText("本機已儲存");
    await expect(page.locator(".cloud-indicator")).toHaveAttribute("data-state", "failed");
    await expect(page.getByTestId("ready")).toHaveText("可編輯");
    await setRule(page, { pattern: PAGE_API, result: "pass" });
    await expect(page.getByTestId("cloud-status")).toHaveText("雲端已儲存", { timeout: 15000 });
    await expect(page.getByLabel("文件標題", { exact: true })).toHaveValue("遠端新標題");
    expect(
      await page.evaluate(() => {
        const element = document.querySelector(".tiptap") as HTMLElement & { marker?: number };
        const selection = getSelection();
        return (
          element.marker === 1 &&
          element.contains(document.activeElement) &&
          !!selection?.anchorNode &&
          element.contains(selection.anchorNode) &&
          (selection.anchorNode.textContent ?? "").includes("失敗期間的字")
        );
      }),
    ).toBe(true);
    expect(await cloudText(page, browser, id)).toContain("失敗期間的字");
  });
