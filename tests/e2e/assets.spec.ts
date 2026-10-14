import {
  expect,
  test,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { images } from "../fixtures/images";
import { saved, openImageUpload, moveToTrash } from "./helpers";
const file = {
  name: "中文原圖.png",
  mimeType: "image/png",
  buffer: Buffer.from(images.png),
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
const urls = (page: Page) =>
  page.evaluate(() =>
    window.probe!.editor.document.flatMap((block) =>
      block.type === "image" && block.props.url ? [block.props.url] : [],
    ),
  );
async function insert(page: Page) {
  await openImageUpload(page);
  await page.getByLabel("圖片原檔", { exact: true }).setInputFiles(file);
  await page.getByRole("button", { name: "上傳圖片", exact: true }).click();
  await expect.poll(() => urls(page)).toHaveLength(1);
  await saved(page);
  return (await urls(page))[0];
}
test.beforeEach(async ({ request }) => {
  await request.post("/__test/reset");
  await request.post("/__test/control", {
    data: { now: Date.now() + 86400000 },
  });
});

test("ASSET-02：中斷上傳顯示失敗／重試，不插入不存在原檔的正式引用", async ({
  page,
  request,
}) => {
  await login(page, request);
  await request.post("/__test/asset-failure", { data: { fail: true } });
  await openImageUpload(page);
  await page.getByLabel("圖片原檔", { exact: true }).setInputFiles(file);
  await page.getByRole("button", { name: "上傳圖片", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("請稍後重試");
  expect(await urls(page)).toEqual([]);
  await expect(
    page.getByRole("button", { name: "重試上傳", exact: true }),
  ).toBeVisible();
  await request.post("/__test/asset-failure", { data: { fail: false } });
  await page.getByRole("button", { name: "重試上傳", exact: true }).click();
  await expect.poll(() => urls(page)).toHaveLength(1);
  await saved(page);
  expect(await (await page.request.get((await urls(page))[0])).body()).toEqual(
    file.buffer,
  );
});

test("ASSET-04：含圖片頁面垃圾桶再還原，引用與原檔保持一致", async ({
  page,
  request,
}) => {
  await login(page, request);
  const url = await insert(page);
  const original = page.url();
  await Promise.all([
    page.waitForEvent("framenavigated", (frame) => frame === page.mainFrame()),
    moveToTrash(page),
  ]);
  await page.goto(original);
  await expect(page.getByRole("alert")).toContainText("垃圾桶");
  await Promise.all([
    page.waitForEvent("framenavigated", (frame) => frame === page.mainFrame()),
    page.getByRole("button", { name: "還原此頁", exact: true }).click(),
  ]);
  await saved(page);
  expect(await urls(page)).toEqual([url]);
  expect(await (await page.request.get(url)).body()).toEqual(file.buffer);
  await expect(page.locator(".tiptap img")).toBeVisible();
});

test("EDIT-03：上傳原圖後另一 context／重開讀到穩定引用與相同位元組", async ({
  page,
  request,
  browser,
}) => {
  await login(page, request);
  const url = await insert(page);
  expect(url).toMatch(/^\/api\/assets\/[\w-]+$/);
  const context = await browser.newContext({
    storageState: await page.context().storageState(),
  });
  try {
    const other = await context.newPage();
    await other.goto(page.url());
    await saved(other);
    expect(await urls(other)).toEqual([url]);
    expect(await (await other.request.get(url)).body()).toEqual(file.buffer);
    await expect(other.locator(".tiptap img")).toBeVisible();
    await page.reload();
    await saved(page);
    expect(await urls(page)).toEqual([url]);
    const denied = await request.get(url);
    expect(denied.status()).toBe(401);
    await expect
      .poll(() =>
        page
          .locator(".tiptap img")
          .evaluate(
            (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
          ),
      )
      .toBe(true);
  } finally {
    await context.close();
  }
});

test("ASSET-CLIENT-01：拒絕格式／超限，BlockNote 原生上傳入口沿用私有 API", async ({
  page,
  request,
}) => {
  await login(page, request);
  await openImageUpload(page);
  await page.getByLabel("圖片原檔", { exact: true }).setInputFiles({
    name: "偽造.png",
    mimeType: "image/png",
    buffer: Buffer.from("<svg/>"),
  });
  await page.getByRole("button", { name: "上傳圖片", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("圖片");
  expect(await urls(page)).toEqual([]);
  await openImageUpload(page);
  await page.getByLabel("圖片原檔", { exact: true }).setInputFiles({
    name: "超限.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
  });
  await page.getByRole("button", { name: "上傳圖片", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("10 MiB");
  expect(await urls(page)).toEqual([]);
  await page.evaluate(async (base64) => {
    const file = new File(
      [Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))],
      "原生上傳.png",
      { type: "image/png" },
    );
    const editor = window.probe!.editor;
    const url = await editor.uploadFile!(file);
    if (typeof url !== "string") throw new Error("上傳必須回傳穩定引用");
    editor.insertBlocks(
      [{ type: "image", props: { url, name: file.name, showPreview: true } }],
      editor.document[0],
      "after",
    );
  }, file.buffer.toString("base64"));
  await saved(page);
  await expect(
    page.getByRole("dialog", { name: "圖片上傳", exact: true }),
  ).toBeHidden();
  expect((await urls(page))[0]).toMatch(/^\/api\/assets\//);
  const known = new Set(await urls(page));
  for (const [format, bytes] of Object.entries(images).filter(
    ([format]) => format !== "png",
  )) {
    await openImageUpload(page);
    await page.getByLabel("圖片原檔", { exact: true }).setInputFiles({
      name: "原圖." + format,
      mimeType: "image/" + format,
      buffer: Buffer.from(bytes),
    });
    const before = (await urls(page)).length;
    await page.getByRole("button", { name: "上傳圖片", exact: true }).click();
    await expect.poll(async () => (await urls(page)).length).toBe(before + 1);
    await saved(page);
    await expect(
      page.getByRole("dialog", { name: "圖片上傳", exact: true }),
    ).toBeHidden();
    const url = (await urls(page)).find((url) => !known.has(url))!;
    known.add(url);
    expect(await (await page.request.get(url)).body()).toEqual(
      Buffer.from(bytes),
    );
  }
});

test("ASSET-INSERT-01：原檔上傳後區塊插入失敗，保留重試且不宣稱引用成功", async ({
  page,
  request,
}) => {
  await login(page, request);
  await page.evaluate(() => {
    const editor = window.probe!.editor;
    const insert = editor.insertBlocks.bind(editor);
    let fail = true;
    editor.insertBlocks = (...args) => {
      if (fail) {
        fail = false;
        throw new Error("測試區塊插入失敗");
      }
      return insert(...args);
    };
  });
  await openImageUpload(page);
  await page.getByLabel("圖片原檔", { exact: true }).setInputFiles(file);
  await page.getByRole("button", { name: "上傳圖片", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("插入失敗");
  expect(await urls(page)).toEqual([]);
  await page.getByRole("button", { name: "重試上傳", exact: true }).click();
  await expect.poll(() => urls(page)).toHaveLength(1);
  await saved(page);
  expect(await (await page.request.get((await urls(page))[0])).body()).toEqual(
    file.buffer,
  );
});
