import { expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

export async function open(
  page: Page,
  room: string = randomUUID(),
  owner = "owner",
  generation = "g1",
) {
  await page.goto(
    `/probe?page=${room}&owner=${owner}&generation=${generation}`,
  );
  await expect(
    page.locator('.tiptap[contenteditable="true"]'),
    "須建立真正 BlockNote 編輯器",
  ).toHaveCount(1);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(page.getByTestId("ready")).toHaveText("可編輯");
  return room;
}

export async function saved(page: Page) {
  await expect(page.getByTestId("cloud-status")).toHaveText("雲端已儲存");
  await expect(page.getByTestId("local-status")).toHaveText("本機已儲存");
}

export async function blocks(page: Page) {
  return page.evaluate(() => window.probe!.editor.document);
}

export async function openPrivate(page: Page, id?: string) {
  await page.goto(id ? "/?page=" + encodeURIComponent(id) : "/");
  await expect(
    page
      .getByLabel("Email", { exact: true })
      .or(page.getByTestId("ready"))
      .first(),
  ).toBeVisible();
  if (await page.getByLabel("Email", { exact: true }).isVisible()) {
    await page.getByLabel("Email", { exact: true }).fill("owner@example.test");
    await page
      .getByRole("button", { name: "寄送登入連結", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("查看登入郵件");
    const mails = (await (
      await page.request.get("/__test/mailbox")
    ).json()) as { url: string }[];
    await page.goto(mails.at(-1)!.url);
    await page.getByRole("button", { name: "確認登入", exact: true }).click();
  }
  await expect(page.getByTestId("ready")).toHaveText("可編輯", {
    timeout: 15000,
  });
  await saved(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  return new URL(page.url()).searchParams.get("page")!;
}

export async function showNavigation(page: Page) {
  const trigger = page.getByRole("button", { name: "導覽", exact: true });
  if (
    (await trigger.isVisible()) &&
    (await trigger.getAttribute("aria-expanded")) !== "true"
  )
    await trigger.click();
}

export async function openCreateMenu(page: Page) {
  const close = page.getByRole("button", { name: "關閉導覽", exact: true });
  if (await close.isVisible()) await close.click();
  await page.getByRole("button", { name: "新增", exact: true }).click();
  await expect(page.getByRole("menu", { name: "新增", exact: true })).toBeVisible();
}

export async function openJournal(page: Page) {
  await showNavigation(page);
  await page.getByRole("button", { name: "日記", exact: true }).click();
}

export async function openPageActions(page: Page) {
  const drawerTrigger = page.getByRole("button", { name: "導覽", exact: true });
  if (
    (await drawerTrigger.isVisible()) &&
    (await drawerTrigger.getAttribute("aria-expanded")) === "true"
  )
    await page.getByRole("button", { name: "關閉導覽", exact: true }).click();
  const trigger = page.getByRole("button", { name: "頁面操作", exact: true });
  if ((await trigger.getAttribute("aria-expanded")) !== "true")
    await trigger.click();
  await expect(
    page.getByRole("menu", { name: "頁面操作", exact: true }),
  ).toBeVisible();
}

export async function moveToTrash(page: Page) {
  await openPageActions(page);
  await page.getByRole("menuitem", { name: "移到垃圾桶", exact: true }).click();
  await page
    .getByRole("button", { name: "確認移到垃圾桶", exact: true })
    .click();
}

export async function openImageUpload(page: Page) {
  const trigger = page.getByRole("button", { name: "插入圖片", exact: true });
  if ((await trigger.getAttribute("aria-expanded")) !== "true")
    await trigger.click();
}

export async function copyCode(page: Page) {
  if (new URL(page.url()).pathname === "/probe") {
    await page.getByRole("button", { name: "複製程式碼", exact: true }).click();
    return;
  }
  await blockAction(page, "複製程式碼");
}

export async function blockAction(page: Page, label: string) {
  const trigger = page.getByRole("button", { name: "區塊操作", exact: true });
  if ((await trigger.getAttribute("aria-expanded")) !== "true")
    await trigger.click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
  const menu = page.getByRole("menu", { name: "區塊操作" });
  if (await menu.isVisible()) await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
}

type GateRule = {
  pattern: string;
  hold?: boolean;
  result?: "pass" | "reject" | "newbuild" | number | { json: object };
};

// 在頁面內包住 fetch：可把符合路徑的請求攔住、改成失敗或替換回應，並在測試中逐一釋放。
function installGate(initial: GateRule[]) {
  const w = window as unknown as {
    gate?: {
      rules: GateRule[];
      held: { path: string; go: () => void }[];
    };
  };
  if (w.gate) {
    w.gate.rules = initial;
    return;
  }
  const gate = (w.gate = { rules: initial, held: [] as { path: string; go: () => void }[] });
  const original = window.fetch;
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const path = url.pathname + url.search;
    const match = () => method === "GET" ? [...gate.rules].reverse().find((rule) => new RegExp(rule.pattern).test(path)) : undefined;
    const held = !!match()?.hold;
    if (held) await new Promise<void>((go) => gate.held.push({ path, go }));
    const result = match()?.result ?? "pass";
    if (result === "reject") throw new TypeError("測試網路中斷");
    if (typeof result === "number")
      return Response.json({ message: "測試錯誤" }, { status: result });
    // 攔住的請求改為慢但成功的回應，不受呼叫端原本的逾時中止。
    const response = await original(input, held ? { ...init, signal: undefined } : init);
    if (result === "newbuild")
      return new Response(
        (await response.text()).replace(/src="[^"]*\/(index|main)[^"]*"/, 'src="/assets/index-NEWBUILD.js"'),
        { headers: { "Content-Type": "text/html" } },
      );
    if (typeof result === "object") {
      const body = { ...((await response.json()) as object), ...result.json };
      return Response.json(body, { status: response.status });
    }
    return response;
  };
}

export async function gate(page: Page, rules: GateRule[], beforeLoad = false) {
  if (beforeLoad) await page.addInitScript(installGate, rules);
  else await page.evaluate(installGate, rules);
}

export async function setRule(page: Page, rule: GateRule) {
  await page.evaluate((rule) => {
    (window as unknown as { gate: { rules: GateRule[] } }).gate.rules.push(rule);
  }, rule);
}

export async function release(page: Page, pattern: string) {
  await page.evaluate((pattern) => {
    const gate = (window as unknown as {
      gate: { rules: GateRule[]; held: { path: string; go: () => void }[] };
    }).gate;
    const re = new RegExp(pattern);
    for (const rule of gate.rules) if (rule.pattern === pattern) rule.hold = false;
    for (const item of gate.held.filter((item) => re.test(item.path))) item.go();
    gate.held = gate.held.filter((item) => !re.test(item.path));
  }, pattern);
}

export const heldCount = (page: Page, pattern: string) =>
  page.evaluate(
    (pattern) =>
      (window as unknown as { gate: { held: { path: string }[] } }).gate.held.filter((item) =>
        new RegExp(pattern).test(item.path),
      ).length,
    pattern,
  );

// 在頁面內記錄同步連線，直接以 readyState 判斷目前文件仍開著幾條。
export async function trackSockets(page: Page) {
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
