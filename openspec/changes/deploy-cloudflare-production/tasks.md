# Tasks

## 1. 正式資源與發布設定

- [x] 1.1 以 DEPLOY-01 設定斷言留下缺少正式設定的 Red，佈建專用 D1／私有 R2，建立正式設定取得 Green，文件記錄資源與密鑰輸入方式。
- [x] 1.2 套用正式 D1 migrations，建置、型別、Worker dry-run 通過後部署 Custom Domain，記錄版本 ID 與雲端 bindings／密鑰名稱檢查。

## 2. 正式環境自動化驗證

- [x] 2.1 實作並執行 DEPLOY-02 HTTPS 與私人入口檢查，記錄 TLS／建置／拒絕未授權／封鎖測試入口結果。
- [x] 2.2 執行 DEPLOY-03 真實登入郵件送達與確認登入；Gmail 與 Playwright 自動斷言，不保存 token 或 cookie 到報告。
- [x] 2.3 執行 DEPLOY-04 獨立瀏覽器雙向 wss 保存與全新 context 載入，正常移入驗證筆記垃圾桶；記錄結果與限制。

## 3. 完成整合

- [x] 3.1 OpenSpec 嚴格驗證、git diff --check、密鑰未追蹤檢查及所有正式情境通過，更新部署文件並自動 commit。
