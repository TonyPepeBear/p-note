import { test, expect, type Page } from "@playwright/test";
import { openPrivate, showNavigation } from "./helpers";

test.beforeEach(async ({ request, page }) => {
  await request.post("/__test/reset");
  await page.addInitScript(() => {
    // 保留原生包裝物件，避免 WebKit 回收後重新建立物件而遺失測試替身。
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: navigator.storage,
    });
  });
});

async function openSettings(page: Page) {
  await showNavigation(page);
  await page.getByRole("navigation", { name: "工作區管理", exact: true })
    .getByRole("button", { name: "設定", exact: true }).click();
  const section = page.getByRole("region", { name: "本地快取", exact: true });
  await expect(section).toBeVisible();
  return section;
}

for (const details of ["完整", "無分項", "部分", "零用量"] as const) {
  test(`UI-11：本地快取顯示總量與${details}`, async ({ page }) => {
    await openPrivate(page);
    await page.evaluate((mode) => {
      Object.defineProperty(navigator.storage, "estimate", {
        configurable: true,
        value: async () => ({
          usage: mode === "零用量" ? 0 : 12_300_000,
          quota: 2_100_000_000,
          ...(mode === "無分項" ? {} : {
            usageDetails: mode === "部分" ? { indexedDB: 4_200_000 } : {
              indexedDB: mode === "零用量" ? 0 : 4_200_000,
              caches: mode === "零用量" ? 0 : 8_100_000,
            },
          }),
        }),
      });
    }, details);
    const section = await openSettings(page);
    await expect(section.getByText(details === "零用量" ? "0 B／2.1 GB" : "12.3 MB／2.1 GB", { exact: true })).toBeVisible();
    if (details === "無分項") {
      await expect(section.getByText("IndexedDB", { exact: true })).toHaveCount(0);
    } else {
      await expect(section.getByText("IndexedDB", { exact: true })).toBeVisible();
      await expect(section.getByText(details === "零用量" ? "0 B" : "4.2 MB", { exact: true }).first()).toBeVisible();
    }
    if (details === "無分項" || details === "部分") {
      await expect(section.getByText("Cache Storage", { exact: true })).toHaveCount(0);
    } else {
      await expect(section.getByText("Cache Storage", { exact: true })).toBeVisible();
      await expect(section.getByText(details === "零用量" ? "0 B" : "8.1 MB", { exact: true }).last()).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: "API key 設定", exact: true })).toBeVisible();
  });
}

for (const failure of ["不支援 estimate", "不支援 storage", "拒絕", "缺少總量"] as const) {
  test(`UI-11：本地快取${failure}時顯示提示`, async ({ page }) => {
    await openPrivate(page);
    await page.evaluate((mode) => {
      if (mode === "不支援 storage") {
        Object.defineProperty(navigator, "storage", { configurable: true, value: undefined });
      } else {
        Object.defineProperty(navigator.storage, "estimate", {
          configurable: true,
          value: mode === "不支援 estimate" ? undefined : async () => {
            if (mode === "拒絕") throw new Error("測試讀取失敗");
            return { quota: 2_100_000_000 };
          },
        });
      }
    }, failure);
    const section = await openSettings(page);
    await expect(section.getByText("此瀏覽器無法取得快取用量", { exact: true })).toBeVisible();
    await expect(section.getByText("IndexedDB", { exact: true })).toHaveCount(0);
    await expect(section.getByText("Cache Storage", { exact: true })).toHaveCount(0);
  });
}

test("UI-11：本地快取載入與重新進入設定更新用量", async ({ page }) => {
  await openPrivate(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator.storage, "estimate", {
      configurable: true,
      value: () => new Promise(() => {}),
    });
  });
  let section = await openSettings(page);
  await expect(section.getByRole("status")).toHaveText("正在取得快取用量…");
  await page.getByRole("button", { name: "返回筆記", exact: true }).click();
  await page.evaluate(() => {
    let reads = 0;
    Object.defineProperty(navigator.storage, "estimate", {
      configurable: true,
      value: async () => ({ usage: ++reads * 1_000, quota: 1_000_000 }),
    });
  });
  section = await openSettings(page);
  await expect(section.getByText("1.0 KB／1.0 MB", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回筆記", exact: true }).click();
  section = await openSettings(page);
  await expect(section.getByText("2.0 KB／1.0 MB", { exact: true })).toBeVisible();
});
