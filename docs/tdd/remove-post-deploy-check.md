# 取消發布後網站檢查

## 變更
依使用者指示，Actions 移除「確認正式建置與私人入口」。發布工作最後一步為 D1 migrations 與 Cloudflare deploy；成功後結束，不自動抓取正式首頁、比對資源版本或探測私人／測試入口。

同步 production-deployment 主規格、部署說明與 AGENTS.md；不自動要求代理在發布後補跑網站 HTTP 檢查。既有 smoke 腳本僅保留供歷史紀錄引用。

## TDD 與驗證
- Red：原 workflow 最後一步為網站檢查，新的 CICD-03 最後步驟斷言失敗；CICD-01／02 通過。
- Green：移除該步驟後 CICD-01／02／03 三個部署契約全部通過。
- 相關 Playwright 桌面專案使用暫存無 webServer 設定；測試只讀 workflow，不啟動瀏覽器、測試 Worker 或產品服務。
- 主規格已同步，change 在合併 PR 前封存至 2026-10-14-remove-post-deploy-check。
- 不執行產品 E2E；合併後確認 Actions 的資料遷移與發布成功，且無發布後網站檢查步驟。
