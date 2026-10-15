import { test, expect } from "@playwright/test";
import { openPrivate, showNavigation } from "./helpers";

test.beforeEach(async ({ request }) => {
  await request.post("/__test/reset");
  await request.post("/__test/control", { data: { now: Date.now() + 86400000 } });
});

for (const settings of ["備份設定", "API key 設定"]) {
  for (const action of ["登出", "今天"]) {
    test(`UI-06-ERROR：${settings}期間${action}失敗仍顯示可關閉提示`, async ({ page }) => {
      await openPrivate(page);
      const currentUrl = page.url();
      await showNavigation(page);
      await page.getByRole("button", { name: settings === "備份設定" ? settings : "設定", exact: true }).click();
      const heading = page.getByRole("heading", { name: settings, exact: true });
      await expect(heading).toBeVisible();
      if (action === "登出") {
        await page.evaluate(() => {
          const original = window.fetch;
          window.fetch = (input, init) => {
            const url = new URL(input instanceof Request ? input.url : String(input), location.href);
            if (url.pathname === "/api/logout")
              return Promise.resolve(Response.json({ message: "測試登出失敗" }, { status: 503 }));
            return original(input, init);
          };
        });
      } else {
        // 今天切換前必須保存草稿；注入容量不足，讓操作保留設定並回報錯誤。
        await page.evaluate(() => {
          IDBDatabase.prototype.transaction = function () {
            throw new DOMException("測試容量不足", "QuotaExceededError");
          };
        });
      }
      await showNavigation(page);
      await page.getByRole("button", { name: action, exact: true }).click();
      const closeNavigation = page.getByRole("button", { name: "關閉導覽", exact: true });
      if (await closeNavigation.isVisible()) await closeNavigation.click();
      const alert = page.getByRole("alert").filter({ hasText: action === "登出" ? "登出失敗，請重試" : "本機儲存失敗" });
      await expect(alert).toBeVisible();
      await expect(heading).toBeVisible();
      await expect(page.locator(".tiptap")).toBeHidden();
      await expect(page).toHaveURL(currentUrl);
      await alert.getByRole("button", { name: "關閉提示", exact: true }).click();
      await expect(alert).toHaveCount(0);
      await expect(heading).toBeVisible();
    });
  }
}
