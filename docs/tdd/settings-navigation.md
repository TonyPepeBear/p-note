# 設定頁導覽與錯誤提示修復

## Red
- 基準：`6740609`，只新增 E2E，尚未修改產品程式。
- 命令：`npm run test:e2e:fast -- tests/e2e/backup.spec.ts tests/e2e/settings-navigation.spec.ts --grep 'BACKUP-UI-LOCK-01|UI-06-ERROR'`
- 結果：退出碼 1，6 個案例全數因預期缺陷失敗。
- `BACKUP-UI-LOCK-01`：還原進行中與中斷後，真正 `page.goBack()` 導致備份設定 heading 消失，違反保留還原流程的斷言（2 個案例）。
- `UI-06-ERROR`：備份及 API key 設定期間，登出 503 或今天切換前 IndexedDB 儲存失敗，錯誤 Alert 不可見（4 個案例）。
- 測試環境使用 `XDG_CONFIG_HOME=/tmp/p-note-config` 與 `PLAYWRIGHT_BROWSERS_PATH=/tmp/p-note-browsers`；最初 Wrangler 目錄不可寫的啟動失敗不算 Red。

## Green 與驗收
待完成。
