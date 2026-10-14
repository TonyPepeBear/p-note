# Tasks

## 1. 部署流程與契約

- [x] 1.1 建立 CICD-01／02 Playwright 契約測試並記錄缺少 workflow 的 Red；使用相關 Chromium spec 驗證。
- [x] 1.2 新增 master workflow、失敗阻擋與憑證隔離，讓相關測試 Green，更新部署文件並記錄 Refactor 驗證。

## 2. 正式入口 smoke

- [x] 2.1 建立 CICD-03 HTTP fixture 的成功與建置錯誤／授權錯誤 Red，再實作 smoke 並通過同組測試；文件說明驗證範圍。

## 3. 整合與啟用

- [x] 3.1 執行部署契約、型別、正式設定與建置驗收，記錄命令與結果；產品完整回歸的歷史失敗保留，不作為本次部署門檻。
- [x] 3.2 設定專用 Cloudflare GitHub secret，查詢 secret 名稱驗證；憑證不可輸出或提交。
- [x] 3.3 檢查本次提交的內容與 noreply 作者，推送 master，確認 GitHub Actions 自動部署成功及 HTTPS smoke 通過；記錄 run 連結與狀態。
