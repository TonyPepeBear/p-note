# PWA 換頁自動更新驗證

日期：2026-10-16。情境：PWA-06、UX-20、LFN-01；相關回歸包含安裝、離線外殼、站內導覽與舊版資源快取。

工具版本：Node 24.19.0、npm 11.9.0、Playwright 1.64.0、Vitest 4.1.11。

## Red

- `npm run test:unit -- tests/unit/service-worker.test.ts`：退出碼 1，3 通過、1 失敗。完整預快取後預期 skipWaiting 1 次，舊程式實際 0 次。
- `npm run test:e2e:fast -- tests/e2e/pwa.spec.ts --grep PWA-06`：退出碼 1，2 失敗。舊程式仍顯示更新按鈕（預期 0、實際 1）；真實新版持續等待而無法取得控制權。
- 首次執行發現依賴與瀏覽器缺漏，補齊後重跑；環境失敗不列為 Red。

## Green 與整理

- 移除更新按鈕、更新 busy／error、waiting 狀態、applyPwaUpdate 與 controllerchange 監聽；保留原生安裝提示的狀態及錯誤處理。
- 預快取成功才自動 skipWaiting，失敗則不啟用；保留 activate 的 clients.claim 與所有舊版快取。
- `npm run test:unit -- tests/unit/service-worker.test.ts`：退出碼 0，4 通過，涵蓋自動啟用順序、下載失敗、舊訊息無作用、不刪快取及私人端點隔離。
- `npm run test:e2e:fast -- tests/e2e/pwa.spec.ts tests/e2e/spa-navigation.spec.ts`：退出碼 0，14 通過。包含真實更新不重載兩個分頁、續寫、舊版資源讀取、UX-20 草稿保存重載與 LFN-01 保存失敗保護。
- `npm run check`：退出碼 0。
- `npm run test:build`：退出碼 0，建置成功，HTTPS／wss／離線與分析請求 smoke 2 通過。

## 驗收

OpenSpec change 嚴格驗證、封存與主規格嚴格驗證均退出碼 0；`npm run check:spec`、`git diff --check` 退出碼 0。

`E2E_WORKERS=2 npm run test:e2e -- tests/e2e/pwa.spec.ts tests/e2e/spa-navigation.spec.ts --timeout=45000`：退出碼 0，42 通過、0 失敗、0 跳過。PWA-01～06、UX-20、LFN-01 的 23 個必要環境結果比對全部通過。三瀏覽器相關 E2E 摘要見 [機器摘要](pwa-navigation-update-results.json)。本次沿用 UX-20 與 LFN-01 的保存成功／失敗案例，不重複建立手動更新流程。

首次三瀏覽器驗收使用預設四 worker，UX-16／UX-17 在桌面與手機 Chromium 超過 20 秒案例上限；8 通過、4 失敗、4 中止、26 未執行，退出碼 130。停止該組服務後，改以 `E2E_WORKERS=2`、`--timeout=45000` 重跑；不更改產品程式與測試斷言，保留失敗摘要。

執行環境以 `PLAYWRIGHT_BROWSERS_PATH=/tmp/p-note-browsers`、`XDG_CONFIG_HOME=/tmp/p-note-config`、`WRANGLER_LOG_PATH=/tmp/p-note-wrangler-logs` 指定暫存目錄。WebKit 所需系統函式庫下載並解壓至暫存瀏覽器的 sys/lib；因系統 ldconfig 不含暫存函式庫，設定 `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1`，並以真實 WebKit 啟動與 E2E 斷言驗證可用性。未修改產品的瀏覽器檢查或測試斷言。
