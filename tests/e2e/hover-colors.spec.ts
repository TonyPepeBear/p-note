import { expect, test, type Locator, type Page } from "@playwright/test";
import { openPrivate, saved, showNavigation } from "./helpers";
import { origin } from "./ports";

// 以瀏覽器實際合成的底色計算對比，避免只驗證 CSS 變數名稱。
async function appearance(target: Locator) {
  return target.evaluate((element) => {
    const rgb = (value: string) => value.match(/[\d.]+/g)!.map(Number);
    const blend = (front: number[], back: number[]) =>
      front.slice(0, 3).map((channel, i) => channel * (front[3] ?? 1) + back[i] * (1 - (front[3] ?? 1)));
    let background = [255, 255, 255];
    const ancestors: Element[] = [];
    for (let current: Element | null = element; current; current = current.parentElement) ancestors.unshift(current);
    for (const ancestor of ancestors) background = blend(rgb(getComputedStyle(ancestor).backgroundColor), background);
    const color = rgb(getComputedStyle(element).color);
    const luminance = (channels: number[]) => channels.slice(0, 3).map((value) => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }).reduce((total, value, i) => total + value * [0.2126, 0.7152, 0.0722][i], 0);
    const fg = luminance(blend(color, background));
    const bg = luminance(background);
    return { background, color, luminance: bg, contrast: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05) };
  });
}
async function hoverColor(page: Page, target: Locator) {
  await page.mouse.move(0, 0);
  const before = await appearance(target);
  await target.hover();
  const after = await appearance(target);
  expect(after.contrast).toBeGreaterThanOrEqual(4.5);
  if (await page.evaluate(() => matchMedia("(hover: hover)").matches)) {
    expect(after.background).not.toEqual(before.background);
  }
  return after;
}
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
test.beforeEach(async ({ request }) => {
  await request.post("/__test/reset");
  await request.post("/__test/control", { data: { now: Date.now() + 86400000 } });
});

test("UI-07：中性操作 hover 保持淺色一致，主操作可讀", async ({ page }) => {
  await page.goto("/");
  const primary = await hoverColor(page, button(page, "寄送登入連結"));
  expect(primary.color.slice(0, 3)).toEqual([255, 255, 255]);
  await openPrivate(page);
  let neutral: number[] | undefined;
  for (const name of ["備份設定", "插入圖片", "區塊操作"]) {
    const hovered = await hoverColor(page, button(page, name));
    expect(hovered.luminance).toBeGreaterThan(0.8);
    if (await page.evaluate(() => matchMedia("(hover: hover)").matches)) {
      neutral ??= hovered.background;
      expect(hovered.background).toEqual(neutral);
    }
  }
  await button(page, "備份設定").click();
  await expect(page.getByText("還沒有備份", { exact: true })).toBeVisible();
  await hoverColor(page, button(page, "返回編輯"));
  await hoverColor(page, button(page, "建立備份"));
  await button(page, "返回編輯").click();
  await showNavigation(page);
  await button(page, "設定").click();
  expect((await hoverColor(page, button(page, "返回筆記"))).luminance).toBeGreaterThan(0.8);
});

test("UI-08：側欄 hover 保留選取狀態，觸控不黏住", async ({ page, isMobile }) => {
  await openPrivate(page);
  const response = await page.request.post("/api/pages", { headers: { Origin: origin }, data: { title: "側欄互動測試", parent_id: null } });
  expect(response.ok()).toBe(true);
  await page.goto("/?page=" + (await response.json()).id);
  await saved(page);
  await showNavigation(page);
  const selected = page.locator('.pn-note-link[aria-current="page"]:visible');
  const idle = button(page, "日記");
  await page.mouse.move(0, 0);
  const selectedBefore = await appearance(selected);
  const idleBefore = await appearance(idle);
  if (isMobile) {
    await idle.tap();
    await expect(page.getByRole("dialog", { name: "日記回顧", exact: true })).toBeVisible();
    await button(page, "關閉日記回顧").click();
    await showNavigation(page);
    expect((await appearance(idle)).background).toEqual(idleBefore.background);
    await expect(selected).toHaveAttribute("aria-current", "page");
  } else {
    const idleHover = await hoverColor(page, idle);
    const selectedHover = await hoverColor(page, selected);
    expect(selectedHover.background).not.toEqual(idleHover.background);
    expect(selectedHover.background).not.toEqual(selectedBefore.background);
    await expect(selected).toHaveAttribute("aria-current", "page");
    await page.mouse.move(0, 0);
    expect((await appearance(selected)).background).toEqual(selectedBefore.background);
  }
});

test("UI-09：區塊選單與編輯器工具使用淺色，危險操作保留紅色", async ({ page, isMobile }) => {
  await openPrivate(page);
  await page.locator(".tiptap").fill("互動色測試文字");
  await saved(page);
  await button(page, "區塊操作").click();
  const insert = page.getByRole("menuitem", { name: "插入段落", exact: true });
  await insert.focus();
  const menuHover = await appearance(insert);
  expect(menuHover.luminance).toBeGreaterThan(0.8);
  expect(menuHover.contrast).toBeGreaterThanOrEqual(4.5);
  const danger = page.getByRole("menuitem", { name: "刪除區塊", exact: true });
  await danger.focus();
  const dangerColor = await appearance(danger);
  expect(dangerColor.color[0]).toBeGreaterThan(dangerColor.color[1] * 2);
  expect(dangerColor.contrast).toBeGreaterThanOrEqual(4.5);
  await page.keyboard.press("Escape");
  // 透過真實文字選取顯示 BlockNote 浮動工具列。
  await page.locator(".tiptap").click();
  await page.evaluate(() => {
    const text = document.querySelector('.tiptap [data-content-type="paragraph"]')!.firstChild!;
    const range = document.createRange();
    range.selectNodeContents(text);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  const format = page.locator('.bn-formatting-toolbar button').first();
  await expect(format).toBeVisible();
  if (!isMobile) {
    await format.hover();
    expect((await appearance(format)).background).toEqual(menuHover.background);
  }
  expect((await appearance(format)).contrast).toBeGreaterThanOrEqual(4.5);
});

test("UI-10：停用操作無 hover 回饋且鍵盤焦點可見", async ({ page }) => {
  await openPrivate(page);
  const trigger = button(page, "插入圖片");
  await trigger.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(trigger).toBeFocused();
  const outline = await trigger.evaluate(e => ({ style: getComputedStyle(e).outlineStyle, width: parseFloat(getComputedStyle(e).outlineWidth) }));
  expect(outline.style).not.toBe("none");
  expect(outline.width).toBeGreaterThan(0);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "圖片上傳", exact: true })).toBeVisible();
  const disabled = button(page, "上傳圖片");
  const before = await appearance(disabled);
  await disabled.hover({ force: true });
  expect((await appearance(disabled)).background).toEqual(before.background);
  await expect(disabled).toBeDisabled();
  await button(page, "關閉圖片上傳").click();
  await button(page, "備份設定").click();
  await button(page, "建立備份").click();
  await button(page, "選擇還原").click();
  const restore = button(page, "覆蓋還原");
  await expect(restore).toBeDisabled();
  const restoreBefore = await appearance(restore);
  await restore.hover({ force: true });
  expect((await appearance(restore)).background).toEqual(restoreBefore.background);
  await expect(restore).toBeDisabled();
  await page.getByRole("checkbox").check();
  await expect(restore).toBeEnabled();
  await hoverColor(page, restore);
});
