import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } from "@zip.js/zip.js";
import * as Y from "yjs";
import { openPrivate, saved, openImageUpload, moveToTrash, showNavigation, openCreateMenu } from "./helpers";
import type { BackupManifest } from "../../src/shared/backup";
import { images } from "../fixtures/images";

test.beforeEach(async ({ request }) => {
  await request.post("/__test/reset");
  await request.post("/__test/control", {
    data: { now: Date.now() + 86400000 },
  });
});
test("BACKUP-06：設定頁建立成功備份並下載完整 ZIP，正文與圖片可解析且憑證不在匯出", async ({
  page,
}, info) => {
  const id = await openPrivate(page);
  await page.evaluate(() => {
    const editor = window.probe!.editor;
    editor.replaceBlocks(editor.document, [
      { type: "paragraph", content: "匯出中文日記與程式碼" },
      {
        type: "codeBlock",
        props: { language: "javascript" },
        content: 'const note = "日記";\n  note;',
      },
    ]);
  });
  await saved(page);
  await openImageUpload(page);
  await page.getByLabel("圖片原檔", { exact: true }).setInputFiles({
    name: "原圖.png",
    mimeType: "image/png",
    buffer: Buffer.from(images.png),
  });
  await page.getByRole("button", { name: "上傳圖片", exact: true }).click();
  await expect(
    page.locator('.bn-block-content[data-content-type="image"]'),
  ).toHaveCount(1);
  await saved(page);
  await expect(
    page.getByRole("button", { name: "備份設定", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "備份設定", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "備份設定", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".tiptap")).toBeHidden();
  await page.getByRole("button", { name: "建立備份", exact: true }).click();
  const link = page.getByRole("link", { name: "下載 ZIP", exact: true });
  await expect(link).toHaveCount(1);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    link.click(),
  ]);
  const path = info.outputPath("complete-backup.zip");
  await download.saveAs(path);
  expect(await download.failure()).toBeNull();
  const bytes = await readFile(path);
  const reader = new ZipReader(new Uint8ArrayReader(bytes), {
    useWebWorkers: false,
  });
  const files = new Map<string, Uint8Array>();
  for (const entry of await reader.getEntries())
    if (!entry.directory)
      files.set(
        entry.filename,
        await entry.getData(new Uint8ArrayWriter(), { checkSignature: true }),
      );
  await reader.close();
  const manifest = JSON.parse(
    new TextDecoder().decode(files.get("manifest.json")),
  ) as BackupManifest;
  expect([...files.keys()].sort()).toEqual(
    [
      "manifest.json",
      ...manifest.pages.map((item) => item.file.path),
      ...manifest.assets.map((item) => item.file.path),
    ].sort(),
  );
  const row = manifest.pages.find((item) => item.metadata.id === id)!;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, files.get(row.file.path)!);
  expect(doc.getXmlFragment("body").toString()).toContain(
    "匯出中文日記與程式碼",
  );
  expect(doc.getXmlFragment("body").toString()).toContain("const note");
  doc.destroy();
  for (const item of [...manifest.pages, ...manifest.assets])
    expect(
      createHash("sha256").update(files.get(item.file.path)!).digest("hex"),
    ).toBe(item.file.checksum);
  expect(files.get(manifest.assets[0].file.path)).toEqual(images.png);
  expect(bytes.toString()).not.toMatch(
    /test-only-secret|verification|accessToken|refreshToken/,
  );
  const owner = await (await page.request.get("/api/session")).json();
  expect(manifest.owner.id).toBe(owner.user.id);
  await page.getByRole("button", { name: "返回編輯", exact: true }).click();
  await expect(page.getByTestId("ready")).toHaveText("可編輯");
  await saved(page);
});

test("BACKUP-08：設定頁在清空產品儲存後恢復日記正文／原圖與索引", async ({
  page,
}) => {
  const id = await openPrivate(page);
  await page.evaluate(() => {
    const editor = window.probe!.editor;
    editor.replaceBlocks(editor.document, [
      { type: "paragraph", content: "從完整備份恢復的日記" },
    ]);
  });
  await saved(page);
  await openImageUpload(page);
  await page.getByLabel("圖片原檔", { exact: true }).setInputFiles({
    name: "原圖.png",
    mimeType: "image/png",
    buffer: Buffer.from(images.png),
  });
  await page.getByRole("button", { name: "上傳圖片", exact: true }).click();
  await expect(
    page.locator('.bn-block-content[data-content-type="image"]'),
  ).toHaveCount(1);
  await saved(page);
  await page.getByRole("button", { name: "備份設定", exact: true }).click();
  await page.getByRole("button", { name: "建立備份", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "選擇還原", exact: true }),
  ).toHaveCount(1);
  // 清空會刻意中止 Durable Object；連線重設時重送這個冪等的測試請求。
  expect((await page.request.post("/__test/clear-product", { maxRetries: 2 })).status()).toBe(200);
  await page.getByRole("button", { name: "選擇還原", exact: true }).click();
  await page.getByLabel("我知道將以備份覆蓋目前頁面", { exact: true }).check();
  await page.getByRole("button", { name: "覆蓋還原", exact: true }).click();
  await expect(page.getByTestId("ready")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("ready")).toHaveText("可編輯", {
    timeout: 15000,
  });
  await saved(page);
  expect(new URL(page.url()).searchParams.get("page")).toBe(id);
  await expect(page.locator(".tiptap")).toContainText("從完整備份恢復的日記");
  const image = await page.evaluate(() =>
    window.probe!.editor.document.find((block) => block.type === "image")!,
  );
  const response = await page.request.get(image.props.url);
  expect(response.status()).toBe(200);
  expect(new Uint8Array(await response.body())).toEqual(images.png);
  const search = await (
    await page.request.get(
      "/api/search?q=" + encodeURIComponent("完整備份恢復"),
    )
  ).json();
  expect(search.map((row: { id: string }) => row.id)).toContain(id);
});

for (const backDuring of ["還原中", "中斷後"]) {
  test(`BACKUP-UI-LOCK-01：${backDuring}返回仍鎖定導覽，保留原備份並以相同請求重試`, async ({ page }) => {
    // 多次瀏覽器返回、手機導覽與真實備份還原需完整流程時間；個別斷言仍保留原本逾時。
    test.setTimeout(40000);
    const previous = await openPrivate(page);
    await openCreateMenu(page);
    await page.getByRole("menuitem", { name: "新增筆記", exact: true }).click();
    await expect(page).not.toHaveURL(new RegExp(`page=${previous}$`));
    await expect(page.getByTestId("ready")).toHaveText("可編輯");
    await saved(page);
    const currentUrl = page.url();
    const currentHistory = await page.evaluate(() => history.state);
    await showNavigation(page);
    await page.getByRole("navigation", { name: "工作區管理", exact: true }).getByRole("button", { name: "備份設定", exact: true }).click();
    await page.getByRole("button", { name: "建立備份", exact: true }).click();
    await expect(page.getByRole("button", { name: "選擇還原", exact: true })).toHaveCount(1);

    // 故障注入只攔首次還原與其後的狀態讀取；重試交給真正的還原 API。
    await page.evaluate(() => {
      const original = window.fetch;
      const state = {
        requests: [] as string[],
        release: () => {},
        interrupted: false,
        pending: undefined as { id: string; backup_id: string } | undefined,
      };
      (window as unknown as { backupFailure: typeof state }).backupFailure = state;
      window.fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input), location.href);
        const method = init?.method ?? (input instanceof Request ? input.method : "GET");
        if (method === "POST" && /^\/api\/backups\/[^/]+\/restore$/.test(url.pathname)) {
          const body = JSON.parse(String(init?.body)) as { request_id: string };
          state.requests.push(body.request_id);
          if (state.requests.length === 1) {
            state.pending = { id: body.request_id, backup_id: url.pathname.split("/")[3] };
            await new Promise<void>((resolve) => { state.release = resolve; });
            state.interrupted = true;
            return Response.json({ message: "測試還原中斷，請重試原備份" }, { status: 503 });
          }
          state.interrupted = false;
        }
        const response = await original(input, init);
        if (method === "GET" && url.pathname === "/api/backups" && state.interrupted) {
          return Response.json({ ...await response.json(), restore: state.pending });
        }
        return response;
      };
    });

    await page.getByRole("button", { name: "選擇還原", exact: true }).click();
    await page.getByLabel("我知道將以備份覆蓋目前頁面", { exact: true }).check();
    await page.getByRole("button", { name: "覆蓋還原", exact: true }).click();
    const assertNavigationLocked = async () => {
      await expect(page.getByRole("button", { name: "新增", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "返回編輯", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "返回目前文件", exact: true })).toBeDisabled();
      await showNavigation(page);
      await expect(page.getByRole("button", { name: "新增私人頁面", exact: true })).toBeDisabled();
      for (const name of ["設定", "今天", "登出", "安裝 p-note"])
        await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "頁面操作：未命名", exact: true })).toBeDisabled();
      const note = page.getByRole("navigation", { name: "筆記頁面" }).getByRole("link", { name: "未命名", exact: true });
      await expect(note).toBeInViewport({ ratio: 1 });
      await note.click({ button: "right", force: true });
      await expect(page.getByRole("menu", { name: /^頁面操作/ })).toHaveCount(0);
      const close = page.getByRole("button", { name: "關閉導覽", exact: true });
      if (await close.isVisible()) await close.click();
    };
    const assertBackLocked = async () => {
      // 真正走瀏覽器歷史，確保不是只測側欄或合成 popstate。
      for (let attempt = 0; attempt < 2; attempt++) {
        await page.goBack();
        await expect(page.getByRole("heading", { name: "備份設定", exact: true })).toBeVisible();
        await expect(page).toHaveURL(currentUrl);
        expect(await page.evaluate(() => history.state)).toEqual(currentHistory);
        await expect(page.locator(".tiptap")).toBeHidden();
        await assertNavigationLocked();
      }
    };
    await assertNavigationLocked();
    if (backDuring === "還原中") await assertBackLocked();

    await page.evaluate(() => {
      (window as unknown as { backupFailure: { release: () => void } }).backupFailure.release();
    });
    await expect(page.getByRole("status")).toContainText("還原尚未完成，請重試相同備份");
    await expect(page.getByRole("alert")).toContainText("測試還原中斷");
    await assertNavigationLocked();
    if (backDuring === "中斷後") await assertBackLocked();
    await expect(page.getByRole("heading", { name: "備份設定", exact: true })).toBeVisible();
    await expect(page.locator('.backup-card[aria-current="true"]')).toHaveCount(1);
    await expect(page.locator(".tiptap")).toBeHidden();

    const retried = page.waitForRequest((request) =>
      request.method() === "POST" && /\/api\/backups\/[^/]+\/restore$/.test(request.url()));
    const originalId = await page.evaluate(() =>
      (window as unknown as { backupFailure: { requests: string[] } }).backupFailure.requests[0]);
    await page.getByRole("button", { name: "覆蓋還原", exact: true }).click();
    expect((await retried).postDataJSON()).toEqual({ request_id: originalId });
    await expect(page.getByTestId("ready")).toHaveText("可編輯", { timeout: 15000 });
    await expect(page.getByTestId("ready")).toBeVisible();
    await saved(page);
    await showNavigation(page);
    await expect(page.getByRole("button", { name: "設定", exact: true })).toBeEnabled();
  });
}
