# Tasks

## 1. OAuth 與登入

- [ ] 1.1 新增 PLUGIN-05／06 Chromium E2E 取得正確 Red，實作同 Worker discovery、PKCE、Email 登入返回及明確同意，相關測試通過。
- [ ] 1.2 加入隔離 OAuth KV 與 mcp_grants migration，實作連線 scope／到期／撤銷及網站設定，PLUGIN-07／08 通過並更新文件。

## 2. 遠端 MCP 與封裝

- [ ] 2.1 改寫 PLUGIN-01／02／03 為 HTTP MCP，保留 10 個工具，與 API key 共用正文處理及保存前權限驗證；相關 Chromium 與 Workers 測試通過。
- [ ] 2.2 plugin 改為遠端 OAuth、移除本機執行組件，更新安裝及技能文件；PLUGIN-04 與封裝檢查通過。

## 3. 整體驗收

- [ ] 3.1 MCP 的三瀏覽器案例、型別、規格與整合檢查通過；完整 E2E 執行並如實記錄既有 UI-10 結果與本次 TDD 證據。

完成後依 AGENTS.md 封存同步主規格並提交，推送、建立及立即合併 PR，再確認 Actions migration 與發布結果。不能預先宣稱雲端平台已完成實際連線。
