# Design

## Context

使用者已決定同一個 Cloudflare Worker 提供遠端 MCP、沿用現有 Email 登入，保留既有 10 個工具。此決定取代尚未交付的本機 stdio 設計。

## Goals / Non-Goals

雲端可透過 HTTPS 完成 OAuth 並呼叫工具；不新增登入供應商、VM、刪除或圖片上傳能力。

## Decisions

- 使用官方 MCP SDK 的 Web Standard Streamable HTTP transport，逐請求建立無狀態 server；使用 Cloudflare OAuthProvider 同時擔任授權與資源伺服器。
- `/mcp` 為唯一資源 audience；OAuth discovery、CIMD、DCR、S256 PKCE、code／refresh token 生命週期由套件處理。啟用 global_fetch_strictly_public 保護 CIMD 解析；未授權請求回傳 discovery challenge。
- `/oauth/authorize` 驗證請求，未登入時前往 `/oauth/login`，沿用 Login 元件。登入郵件帶僅限同站 OAuth authorize 的 returnTo，跨分頁確認登入也可回到同意畫面。回呼與 client metadata 嚴格驗證、轉義，授權 form 使用套件的一次性 browser-bound handle 與同源 POST。
- 同意頁顯示 client 名稱、可信網域／自行註冊提示、回呼主機、唯讀／讀寫權限與本機回呼警示。授權不自動同意；拒絕不建立連線。
- scopes 使用 notes:read、notes:write 與 offline_access。讀取皆需 read，寫入另需 write；access token 1 小時，grant／refresh 最長 30 天。網站設定可撤銷連線。
- OAuth token／code 由 OAUTH_KV 保存；D1 mcp_grants 保存 owner、連線名稱、scope、到期與撤銷狀態，每次請求及 Durable Object 保存前重新檢查。D1 撤銷作為立即拒絕資料存取的邊界，不依賴 KV 跨區快取失效速度。token refresh callback 也檢查連線仍有效。
- 抽出既有 handleContentApi 的已驗證身分內容處理；API key 與 OAuth 使用不同憑證分支，均保留正文 ETag、帳號所有權、還原鎖及即時同步，不模擬 cookie 或將私人 key 固定在 Worker。
- plugin 改為遠端 HTTP OAuth 設定並移除本機執行旗標與 stdio 程式；技能保留筆記為資料、問句不寫入及衝突合併規則。

## Risks / Trade-offs

- OAuth 為外部授權邊界 → 使用官方套件，E2E 驗證錯誤 PKCE、code 重用、回呼竄改、CSRF、scope、token 更新與撤銷。
- 網路失敗可能發生於寫入後 → 不自動重送，先重新讀取確認。
- 既有 WebKit UI-10 焦點測試失敗 → 完整驗收保留其實際結果，不宣稱全套通過；本次 MCP 相關案例必須在三種瀏覽器通過。

## Migration Plan

新增 OAuth KV binding 及 mcp_grants D1 migration，測試資料與正式資料隔離。先驗證並封存同步主規格，再合併 PR；Actions 套用 migration 並發布同一 Worker。發布後只確認 workflow 結果，不執行額外正式 HTTP 檢查。
