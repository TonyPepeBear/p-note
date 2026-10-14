# Proposal

## Why

完整 E2E 串行執行約 529 秒（234 個測試、三個瀏覽器專案、`workers: 1`），每次還要重新建置並啟動 wrangler，拖慢 TDD 的 Red／Green 迴圈。無法平行的原因是所有測試共用同一個測試 Worker 的全域狀態（`/__test/reset`、`/__test/control` 時鐘、寄件匣與單一擁有者）。

## What Changes

- 每個 Playwright worker 使用自己的一組 preview＋測試 Worker（各自的 port 與本機儲存目錄），預設 4 個 worker 平行執行。
- 由一支服務腳本啟動全部測試服務，可用 `--watch` 常駐，本機執行時重用已啟動的服務，省去每輪建置與啟動。
- 測試與設定中寫死的 5173／8787 改由同一個 port 計算模組提供；`E2E_PORT_OFFSET` 取代 `scripts/test-isolated.mjs` 的改檔換埠。
- probe 編輯器的同步連線改走同源 proxy，不再直連 8787。
- 新增只跑 Chromium 桌面的快速指令，並在 AGENTS.md 規範 TDD 迴圈先跑相關 spec，完整三瀏覽器留到驗收。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

無（僅測試工具與開發流程，產品行為不變）。

## Impact

`playwright.config.ts`、`playwright.smoke.config.ts`、`vite.config.ts`、`package.json`、`scripts/`、`tests/e2e/`、`src/client/editor.tsx`（probe 連線位址）、AGENTS.md 與相關文件。產品 API、資料格式與部署設定不變。
