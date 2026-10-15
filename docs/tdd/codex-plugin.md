# 遠端 MCP 與 Email OAuth 自動化驗證

2026-10-15，change `add-codex-plugin`。

## TDD 與安全邊界

- 遠端 OAuth Red：先執行 PLUGIN-05 Chromium 案例，尚未實作的註冊入口回應 404；再實作同 Worker 的 discovery、登入返回與同意流程。舊 stdio 的 Red／Green 不作為遠端版本通過證據。
- Green／Refactor：PLUGIN-01 至 08 在 Chromium 桌面、Chromium 手機及 WebKit 手機共 24 個案例通過。透過真實 HTTP MCP 初始化、發現並執行 10 個工具，驗證網站與工具雙向同步。
- 授權案例涵蓋跨分頁 Email 登入返回、拒絕授權、client 名稱轉義、錯誤 PKCE、code 重用、回呼及 resource 竄改、browser-bound consent、CSRF、非法返回網址、唯讀及 refresh 不擴權、設定撤銷、到期及 owner 變更。
- 正文案例驗證 ETag 412 保留內容、缺少或萬用 ETag、額外參數、未知工具及錯誤憑證拒絕。API key 與網站 cookie 不能替代 MCP OAuth。
- 封裝斷言驗證兩組 manifest、一致版本、遠端 CIMD 設定及 ZIP 的 6 個白名單檔案，沒有本機執行需求或私人憑證。
- Workers 相關整合共 12 個案例通過，包含既有 API key／正文、OAuth owner／scope／撤銷／到期、保存前撤銷不寫入及備份不含授權資料；另以測試 client metadata 驗證 CIMD 同意畫面及 Secure／HttpOnly cookie。
- E2E 前後端以暫存憑證提供 HTTPS；新建瀏覽器 context 信任測試憑證，未放寬正式 cookie 或同源限制。HTTPS 首次回歸發現原型 WebSocket 使用 ws 的載入失敗；共用設定改為依頁面協定選擇 ws／wss 後，相關 editor／offline Chromium 17 個案例通過。

## 驗收與範圍

完整三瀏覽器結果見 [codex-plugin-results.json](codex-plugin-results.json)。另執行型別、規格、正式部署設定及單元檢查，並驗證正式 Worker dry-run 建置與 KV binding。

只使用隔離測試帳號及假資料。原始 Playwright／Vitest 報告與 trace 保留在 Git 忽略的 reports／test-results；提交摘要只保留案例、數量、狀態與布林斷言。沒有操作正式私人筆記。

正式發布由 master 的 Actions 套用 migration 0008 並部署同一 Worker。實際 Codex／ChatGPT 雲端帳號仍需以新版 [plugin](../../plugins/p-note/README.md) 發起一次 OAuth；自動測試不代表該帳號已完成連線。

完整回歸本輪為 434 通過、4 失敗：既有 WebKit UI-10，以及三種瀏覽器的 PWA-06。後者原本由測試 Worker fetch 本機 preview，改用 HTTPS 後該測試 fetch 失敗；fixture 已改由本機 preview 讀取建置檔提供，Chromium 先驗證通過。正式 Worker 不提供此測試 fixture。

整合最新 master（6f17c8d）後，plugin／PWA／settings-navigation／backup 共 72 個三瀏覽器案例全部通過，包含 24 個 MCP 結果與 3 個真實 PWA 更新結果。完整回歸與針對性重跑分開記錄；目前保留的既有失敗為 WebKit UI-10 鍵盤焦點斷言，沒有跳過或放寬其測試。
