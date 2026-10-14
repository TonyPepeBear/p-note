# Tasks

## 1. 規格

- [x] 1.1 建立 change 文件；`openspec validate speed-up-e2e --strict` 與 `npm run check:spec` 通過。

## 2. 平行隔離

- [ ] 2.1 Red：現有設定以 `--workers=4` 執行完整 E2E，記錄共用狀態造成的失敗。
- [ ] 2.2 新增 port 模組與服務腳本，設定與測試改用計算後的 port，probe 改走同源 proxy；完整 E2E 以 4 個 worker 通過並記錄耗時。
- [ ] 2.3 `E2E_PORT_OFFSET` 支援 E2E 與建置 smoke，移除 `scripts/test-isolated.mjs`。

## 3. 開發迴圈

- [ ] 3.1 新增 `test:e2e:fast`、`test:e2e:serve`，驗證常駐服務被重用（第二次執行不重新建置）。
- [ ] 3.2 更新 AGENTS.md 與文件。

## 4. 驗收

- [ ] 4.1 單元、Workers、完整 E2E、建置 smoke、型別、文件契約與 OpenSpec 嚴格驗證通過，提交。
