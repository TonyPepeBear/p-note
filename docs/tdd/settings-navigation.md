# 設定頁導覽與錯誤提示修復

## Red
- 基準：`6740609`，只新增 E2E，尚未修改產品程式。
- 命令：`npm run test:e2e:fast -- tests/e2e/backup.spec.ts tests/e2e/settings-navigation.spec.ts --grep 'BACKUP-UI-LOCK-01|UI-06-ERROR'`
- 結果：退出碼 1，6 個案例全數因預期缺陷失敗。
- `BACKUP-UI-LOCK-01`：還原進行中與中斷後，真正 `page.goBack()` 導致備份設定 heading 消失，違反保留還原流程的斷言（2 個案例）。
- `UI-06-ERROR`：備份及 API key 設定期間，登出 503 或今天切換前 IndexedDB 儲存失敗，錯誤 Alert 不可見（4 個案例）。
- 測試環境使用 `XDG_CONFIG_HOME=/tmp/p-note-config` 與 `PLAYWRIGHT_BROWSERS_PATH=/tmp/p-note-browsers`；最初 Wrangler 目錄不可寫的啟動失敗不算 Red。

## Green 與回歸
- 實作：`main.tsx` 以 ref 保存鎖定期間的原網址與 history state；popstate 被鎖定時 pushState 回原文件，不卸載還原元件。全域錯誤提示移至 hidden 文件區塊外，也保留初始載入時的提示。
- 同一 Red 命令重新執行：退出碼 0，6／6 通過（10.9 秒）。
- 第一次 Green 為 5 通過、1 個案例在初始化載入時失敗；trace 顯示建置清空 dist 期間根路徑回應 404。改為先完成建置再執行 E2E；沒有放寬斷言或增加重試。
- Refactor：整理提示及參數化測試縮排，鎖定期間連續按兩次返回，斷言每次原網址／history state 與設定仍保留。
- 命令：`npm run test:e2e:fast -- tests/e2e/backup.spec.ts tests/e2e/settings-navigation.spec.ts tests/e2e/spa-navigation.spec.ts tests/e2e/notion-redesign.spec.ts tests/e2e/api-keys.spec.ts`
- 結果：退出碼 0，24／24 通過（49.7 秒），包括一般前進／返回與捲動、設定切換、背景 401、備份建立／下載／還原及相同 request ID 重試。
- `npm run check`、`npm run build`、`npm run check:spec`、`openspec validate fix-settings-navigation --strict` 與 `git diff --check`：退出碼 0。

## 完整驗收
- `npm run test:e2e`：完整執行 429 個案例，首輪 417 通過、12 失敗，退出碼 1，13.7 分鐘。
- 首輪 8 個新增手機案例因「備份設定」同時存在於工具列及抽屜而定位不唯一；2 個新增手機案例點擊正在自動關閉的抽屜而逾時。修正測試為側欄範圍定位，今天操作等待抽屜關閉，登出操作才主動關閉抽屜。
- 另外 2 個既有 WebKit 案例（PAGE-07、SYNC-11）超過 20 秒總時間；保留首輪失敗紀錄，不改產品邏輯或時間上限。
- 命令：`npm run test:e2e -- tests/e2e/backup.spec.ts tests/e2e/settings-navigation.spec.ts tests/e2e/recovery.spec.ts tests/e2e/pages.spec.ts --grep 'BACKUP-UI-LOCK-01|UI-06-ERROR|SYNC-11|PAGE-07'`
- 修正測試後三瀏覽器回歸：22 通過、2 個 WebKit 長流程仍超過總時間（還原中返回與 SYNC-11），退出碼 1。
- 命令：`E2E_WORKERS=1 npm run test:e2e -- tests/e2e/backup.spec.ts tests/e2e/recovery.spec.ts --project=webkit-mobile --last-failed`
- 單一 worker 重跑剩餘案例：2／2 通過，退出碼 0；耗時各 10.1／8.4 秒，未增加重試或放寬斷言／20 秒上限。
- 以 `(檔案、測試名稱、瀏覽器專案)` 合併三輪實際 JSON 報告的最新結果，程式斷言完整覆蓋 429 個案例、全部通過、沒有 skip；每個瀏覽器專案各 143 個。這是完整首輪加針對失敗的修正與回歸，不宣稱單輪全綠。


## 環境
- WebKit 缺少的系統函式庫從環境既有 Debian 套件來源下載至 `/tmp`，解開後放入本次 Playwright 瀏覽器安裝的本機函式庫目錄。
- 系統 ldconfig cache 不包含本機解開的函式庫，因此設定 `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1` 跳過 cache 預檢；已以實際啟動、渲染及後續 E2E 驗證。所有產品斷言及三個瀏覽器專案保持執行。
- 未修改專案測試設定或系統套件，瀏覽器及函式庫均位於 `/tmp`。
