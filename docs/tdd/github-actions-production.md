# master 自動部署驗證

日期：2026-10-14。使用者確認沿用 `master`，不建立 `main`。OpenSpec change：`github-actions-production`。

## TDD

命令：`E2E_PORT_OFFSET=200 E2E_WORKERS=2 npm run test:e2e:fast -- tests/e2e/deployment.spec.ts`。

- Red：退出碼 1，3 個失敗；CICD-01／02 因缺少 workflow、CICD-03 因缺少部署後檢查腳本失敗。
- 首次 Green 嘗試：退出碼 1，2 個通過、1 個失敗。順序測試誤將 dry-run 的 deploy 字樣當作真正部署；修正斷言為完整發布命令。
- Green：退出碼 0，3 個通過。HTTP fixture 確認正確建置通過，舊版 script、私人 API 回 200、測試入口回 200 均拒絕。
- 初次 sandbox 啟動本機連接埠被拒絕，未視為有效 Red；上述 Red／Green 是允許本機服務後的結果。

## 靜態驗證

- OpenSpec 嚴格驗證通過。
- 官方 actionlint v1.7.12 執行成功；下載後先以官方 checksum 驗證 SHA256，工具僅存於暫存目錄。
- 型別、正式設定與 6 個單元測試通過。

## 整合與啟用狀態

完整 E2E、Workers 整合及建置驗收執行中；實際結果完成後補記。

GitHub Actions 已啟用，帳號有 repository 管理權。尚無 `CLOUDFLARE_API_TOKEN` secret。Cloudflare 連接器的 token 管理 API 回覆未授權，本機 OAuth 亦無法作為 CI 部署憑證；已請使用者直接在 GitHub Secrets 設定專用 token，對話及版本控制不接收其值。

尚未宣稱實際 Actions 發布成功。公開 smoke 只驗證 HTTPS、建置 script、私人 API 與測試入口限制，不涵蓋正式寄信或登入後同步。
