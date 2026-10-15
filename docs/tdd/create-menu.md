# 頂端新增選單驗證

## 範圍

側欄與手機導覽不再常駐「新增筆記／新增資料庫」，改由頂端「新增」選單建立最上層項目。對應 workspace-experience 的 UI-02，以及 UI-CREATE-01～04。驗證只使用本機假資料，不保留登入資訊、原始 API 回應或正式筆記。

## Red／Green／Refactor

- Red，規格提交 `0c68305`：`npm run test:e2e:fast -- tests/e2e/create-menu.spec.ts`，退出碼 1，4 個案例失敗；桌面及手機導覽皆斷言新增按鈕預期 0、實際 2，其他案例等待不存在的頂端「新增」入口。環境依賴與瀏覽器安裝完成後才計入此 Red。
- Green：移除列表按鈕、加入頂端選單，調整鍵盤初始焦點與換頁等待，`npm run test:e2e:fast -- tests/e2e/create-menu.spec.ts tests/e2e/notion-redesign.spec.ts --grep 'UI-CREATE|UI-02：手機'`，退出碼 0，5/5 通過。
- Refactor／整合：整理共用 openCreateMenu，沿用既有保存與導覽流程，整合 `origin/master` 的最新頁面選單、圖片與版本歷史；同一組 Chromium 桌面測試再次退出碼 0，5/5 通過。
- 前置回歸曾執行七個受影響 spec，51 個既有案例通過；另外兩個案例經鍵盤初始焦點及換頁等待修正後，上述 5/5 已涵蓋。此結果不宣稱為完整產品覆蓋。

## 重現環境

- `XDG_CONFIG_HOME=/tmp/p-note-config`，讓 Wrangler 的非機密日誌使用可寫目錄。
- `PLAYWRIGHT_BROWSERS_PATH=/tmp/p-note-browsers`，使用本次 Playwright 配套 Chromium／WebKit。
- 系統缺少的 WebKit 動態函式庫從 Debian 套件解壓至 `/tmp/p-note-browser-libs` 並連結到該瀏覽器的 sys/lib；已實際啟動 WebKit 並讀取測試 DOM。
- `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1` 僅略過依系統 ldconfig 快取判斷的前置檢查；瀏覽器仍實際執行全部斷言，無略過或修改產品測試。
- 手機為瀏覽器模擬，非實體裝置驗收。

## 三瀏覽器驗收與靜態檢查

`npm run test:e2e -- tests/e2e/create-menu.spec.ts tests/e2e/notion-redesign.spec.ts tests/e2e/workspace-ui.spec.ts tests/e2e/pages.spec.ts tests/e2e/workspace-usability.spec.ts tests/e2e/databases.spec.ts tests/e2e/backup.spec.ts tests/e2e/page-menus.spec.ts --grep 'UI-CREATE|UI-02|UI-04|UX-05|PAGE-04|DB-01|BACKUP-UI-LOCK'`

- 首輪 63 個案例中 59 個通過；側欄子頁面測試在新文件掛載前重開抽屜，以及 WebKit 抽屜轉場與多步驟總時限，導致 4 個案例失敗。
- 測試明確等待新文件與抽屜轉場完成，多步驟案例總時限改為 45 秒，單步斷言仍為 5 秒；產品程式未因這些等待問題修改。
- Chromium 桌面針對三個測試 `--grep '側欄新增子|側欄點擊與右鍵'` 退出碼 0，3/3 通過；同一組測試三瀏覽器驗收退出碼 0，9/9 通過。
- 程式以「測試標題＋browser project」合併兩次驗收的最新結果，斷言 63 個唯一案例全部通過：Chromium 桌面 21、Chromium 手機 21、WebKit 手機 21；無未通過、略過或自動重試。這是相關功能驗收，不宣稱為整套產品測試。
- `npm run check`、`npm run check:spec`、`npm run check:production`、`openspec validate compact-create-menu --strict` 皆退出碼 0。
- `npm run test:build` 建置與 smoke 退出碼 0，2/2 通過；整合 master 後，E2E 再次產生最新 dist，執行 `node scripts/test-build.mjs` 退出碼 0，2/2 通過（HTTPS 登入、wss 保存、離線刷新與分析 POST 邊界）。
