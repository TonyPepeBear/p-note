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
    page.getByRole("dialog", { name: "頁面操作", exact: true }),
  ).toBeVisible();
}

export async function moveToTrash(page: Page) {
  await openPageActions(page);
  await page.getByRole("button", { name: "移到垃圾桶", exact: true }).click();
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
  const trigger = page.getByRole("button", { name: "區塊操作", exact: true });
  if (
    new URL(page.url()).pathname !== "/probe" &&
    (await trigger.getAttribute("aria-expanded")) !== "true"
  )
    await trigger.click();
  await page.getByRole("button", { name: "複製程式碼", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "區塊操作", exact: true }),
  ).toBeHidden();
}

export async function blockAction(page: Page, label: string) {
  const trigger = page.getByRole("button", { name: "區塊操作", exact: true });
  if ((await trigger.getAttribute("aria-expanded")) !== "true")
    await trigger.click();
  await page.getByRole("button", { name: label, exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "區塊操作", exact: true }),
  ).toBeHidden();
}
