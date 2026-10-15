# 自動化驗證紀錄

日期：2026-10-15。初始程式基準為 `118aef8`，驗收已整合主線 `1f1422b`。

- Red：`npm run test:e2e:fast -- tests/e2e/page-menus.spec.ts --max-failures=2` 退出碼 1；舊介面沒有 menu 角色及側欄頁面操作按鈕，前兩項依預期失敗。
- Green／Refactor：相關 Chromium 頁面、工作區、備份及歷史案例通過；右鍵快速重開的焦點競態修正後，以 `-g '長標題選單' --repeat-each=3` 確實執行三次且全部通過。
- 完整驗收：`npm run test:e2e` 執行 531 項，首次 517 通過、14 失敗、0 跳過。修正手機抽屜與選單的 Escape／焦點協調、抽屜滑入等待及外部點擊目標後，以 `--last-failed` 重驗，12 項通過、2 項未通過。
- 後續修正：移動故障在 fetch 邊界注入，避免 Service Worker 讓瀏覽器路由攔截失效；既有 WebKit 鍵盤測試改用完整控制項巡覽的 Option+Tab。
- 最終相關驗收：`npm run test:e2e -- tests/e2e/page-menus.spec.ts tests/e2e/backup.spec.ts tests/e2e/history.spec.ts tests/e2e/hover-colors.spec.ts` 退出碼 0；三種瀏覽器共 69 項全部通過。程式比對首次完整案例與後續通過紀錄，531 個案例沒有尚未通過的項目。
- `npm run check`、`npm run check:spec`、`git diff --check` 及 OpenSpec change 嚴格驗證通過；15 份主規格嚴格驗證全部通過。

報告及 trace 保留於 Git 忽略的本機測試目錄；此處只記錄必要命令、狀態與計數。手機驗證為瀏覽器模擬，未執行實機測試；未改動 Worker 或資料模型，因此未額外重跑單元及 Worker 整合測試。
