# 筆記連結開發驗收

日期：2026-10-14。OpenSpec change：`note-links`。

## TDD

相關命令：`PLAYWRIGHT_BROWSERS_PATH=/tmp/p-note-browsers E2E_WORKERS=1 E2E_PORT_OFFSET=200 npm run test:e2e:fast -- tests/e2e/note-links.spec.ts`。

- 首次執行因環境缺少 Chromium 失敗，不列為有效 Red；瀏覽器安裝後重新執行。
- 有效 Red：LINK-01 搜尋中文目標時預期兩個選項，實際為零；尚未實作連結選單，退出碼 1。
- Green：五個相關 Chromium 桌面案例全部通過，含搜尋／導航、去重與移除、改名與垃圾桶、離線與另一端同步、錯誤重試與保存保護。
- Workers 相關三個案例通過，含跨帳號／舊世代排除、巢狀與表格 link、JSON API 及覆蓋還原。

## 環境與完整驗收

WebKit 所需公開 Debian 套件僅下載並解壓至 /tmp，未修改系統。其 bundle 啟動器覆寫 LD_LIBRARY_PATH，故將程式庫放入暫存 bundle 的 sys/lib；以真實 WebKit 空白頁讀取斷言確認啟動成功。ldconfig 預檢看不到 /tmp 程式庫，實際確認後僅於暫存 bundle 記錄 DEPENDENCIES_VALIDATED。

型別、規格契約（111 個唯一情境）、六個單元測試及完整 107 個 Workers 測試通過。

完整三瀏覽器命令：`PLAYWRIGHT_BROWSERS_PATH=/tmp/p-note-browsers LD_LIBRARY_PATH=/tmp/p-note-webkit-libs/usr/lib/x86_64-linux-gnu E2E_WORKERS=2 E2E_PORT_OFFSET=200 npm run test:e2e`。348 個全部通過，沒有失敗、重試、skip 或未執行；執行時間約 15 分鐘。此輪包含五個連結案例的三瀏覽器結果。

其後增加沒有結果／程式碼區塊、垃圾桶目標與搜尋失敗選項保留原查詢的斷言，並限制反向查詢不得清除登出標記。最終相關命令：`PLAYWRIGHT_BROWSERS_PATH=/tmp/p-note-browsers E2E_WORKERS=2 E2E_PORT_OFFSET=200 npm run test:e2e -- tests/e2e/note-links.spec.ts tests/e2e/local-first.spec.ts --grep 'LINK-|LFN-04：已知登出'`。21 個全部通過，含 18 個連結案例與三個登出保護案例；此為針對新增斷言及最終建置的驗證，不宣稱新增案例已納入前一輪 348 項執行。

`npm run test:spec-coverage -- --links` 的 18 個必需環境結果全數通過；使用前輪完整 E2E 報告驗證既有產品覆蓋，135 個必需環境結果全數通過。

`PLAYWRIGHT_BROWSERS_PATH=/tmp/p-note-browsers E2E_PORT_OFFSET=400 npm run test:build` 通過兩個真實 dist／HTTPS Worker 案例，包含登入、wss 保存、離線刷新與分析 POST。最後型別、正式設定、文件契約與 `git diff --check` 全部通過。

## 規格同步與封存

依遠端最新 AGENTS.md 的先封存再合併規則，將六個情境合入 [note-links 主規格](../../openspec/specs/note-links/spec.md)，全部開發任務完成後封存至 [2026-10-14-note-links](../../openspec/changes/archive/2026-10-14-note-links/tasks.md)。新主規格補上用途描述；12 份主規格嚴格驗證與 111 個唯一情境契約通過，進行中 changes 為空。封存結果與功能一併納入 PR，Actions 發布結果於合併後補記。

## 正式發布

[PR #4](https://github.com/TonyPepeBear/p-note/pull/4) 已合併，master 提交為 `d7daa4f`，自動觸發 [GitHub Actions 發布](https://github.com/TonyPepeBear/p-note/actions/runs/38579627460)。run 的 status 為 `completed`、conclusion 為 `success`；型別、正式設定、建置、部署預檢、D1 migrations、Worker 發布及正式 HTTPS smoke 步驟全數通過。最小證據：`migrationExecuted: true`、`smokePassed: true`。

正式 smoke 確認本次建置資源、私人 API 的未登入限制及測試入口封鎖；本輪未重新執行正式郵件登入或修改私人筆記。此文件補記使用 `[skip ci]`，避免重複發布。
