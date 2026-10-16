## MODIFIED Requirements

### Requirement: Email 登入授權

系統 SHALL 提供 OAuth 2.1 discovery、相容 client 註冊、PKCE 及 token 交換。授權 MUST 經既有 Email 登入與明確同意，顯示 client 與回呼主機、權限及本機回呼警示。登入連結跨分頁開啟後仍能回到原授權；只接受同站的授權返回路徑。 已註冊的跨來源 callback MUST 能在瀏覽器完成同意與拒絕重導，完成授權失敗不得留下連線紀錄。

#### Scenario: 登入與同意

- **WHEN** 未登入的使用者從 MCP client 開始授權，開啟 Email 登入連結並確認，再同意存取
- **THEN** 回到同一份授權並取得綁定 MCP 資源的 token，拒絕則回傳 access_denied 且無連線
- **自動化驗證**: `PLUGIN-05`；Playwright 自動操作登入信件 fixture、跨分頁確認、同意／拒絕，斷言 callback state、token 與連線結果。

#### Scenario: 授權竄改拒絕

- **WHEN** 請求使用錯誤 PKCE、重用 code、未註冊回呼、跨瀏覽器或跨來源提交同意、未知 scope 或外部 returnTo
- **THEN** 拒絕授權或 token 交換，不將授權碼送到未驗證的網址，不洩漏網站身分或憑證
- **自動化驗證**: `PLUGIN-06`；Playwright 參數化攻擊輸入，斷言錯誤狀態、無不安全重導向及無未授權連線。
