## 設計
從 workflow 移除最後的 HTTP smoke，保留既有型別、正式設定、建置、dry-run、D1 migrations 與 Cloudflare 發布。部署契約 CICD-03 改為檢查發布步驟是最後的執行步驟且沒有自動網站檢查。

## 驗證
部署契約僅讀取 workflow，不需瀏覽器或測試服務；以 Chromium 桌面專案的暫存無 webServer 設定執行同一 deployment.spec.ts，先確認新增契約 Red，再移除步驟達成 Green。完成規格同步與封存後合併，確認新版 Actions 在發布步驟完成後成功結束。
