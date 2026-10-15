# codex-plugin Specification

## Purpose

讓使用者從 Codex 或 ChatGPT 雲端，以可安裝的 plugin 連接私人 p-note，透過 Email 登入明確授權搜尋、讀取與整理筆記日記，同時延續帳號權限、正文版本保護與可撤銷的存取權限。

## Requirements

### Requirement: 遠端工具與筆記操作

plugin SHALL 透過公開 HTTPS 遠端 MCP 提供列表、搜尋、頁面資訊、建立、改名、圖示設定、移動、日期日記、月份日記、頁面區塊正文讀寫及同步區塊正文讀寫共 13 個工具。工具 MUST 限於授權帳號並拒絕未知工具與無效參數，不要求使用者電腦執行本機程式。同步正文更新 MUST 沿用 ETag，頁面正文可選擇展開同步引用但不可透過頁面更新間接改寫同步正文。

#### Scenario: 工具發現與讀寫

- **WHEN** 已授權的雲端相容 MCP client 連接服務並呼叫工具
- **THEN** 可完成握手與工具發現，13 個工具的結果與網站一致，日記同日唯一且頁面及同步區塊正文雙向同步
- **自動化驗證**: `PLUGIN-01`；Playwright 真實 HTTP MCP 請求，斷言 13 個工具列表、筆記操作、日記唯一性、同步引用展開、同步正文 ETag 往返及網站正文。

### Requirement: 版本與權限保護

正文更新 MUST 帶讀取時 ETag；衝突不得覆寫。所有請求 MUST 驗證憑證、帳號與 scope；還原、刪除與錯誤世代沿用既有保護，不自動重試寫入。

#### Scenario: 衝突與無效輸入

- **WHEN** 使用過時 ETag、無效／額外參數、未知工具或未授權身分
- **THEN** 回報可辨識錯誤並保留正文，Cookie 與 API key 不得取代 MCP OAuth 憑證
- **自動化驗證**: `PLUGIN-02`；Playwright 斷言 412、參數拒絕、401 與正文保留，既有 API key 正文整合測試維持通過。

#### Scenario: 安全入口與工具輸出

- **WHEN** 未提供 OAuth token、使用錯誤來源或無效 JSON 呼叫 MCP
- **THEN** 回應標準 challenge 或協定錯誤，拒絕不安全來源，不回傳 token、cookie 或內部錯誤資料
- **自動化驗證**: `PLUGIN-03`；Playwright 斷言 discovery、來源拒絕、JSON-RPC 錯誤與憑證未出現在工具回應。

### Requirement: 遠端 plugin 封裝

plugin SHALL 提供遠端 MCP OAuth 設定、Codex 相容 manifest、技能、marketplace 與安裝文件。封裝 MUST 排除本機執行需求、密鑰、私人設定與無關檔案。

#### Scenario: 封裝驗證

- **WHEN** 執行 plugin 封裝命令
- **THEN** ZIP 的 manifest 版本與遠端網址一致，OAuth 宣告完整，無 stdio 程式或本機執行旗標
- **自動化驗證**: `PLUGIN-04`；Playwright 解析 ZIP、JSON 與技能，斷言組件引用、遠端 transport 及 OAuth 設定。

### Requirement: Email 登入授權

系統 SHALL 提供 OAuth 2.1 discovery、相容 client 註冊、PKCE 及 token 交換。授權 MUST 經既有 Email 登入與明確同意，顯示 client 與回呼主機、權限及本機回呼警示。登入連結跨分頁開啟後仍能回到原授權；只接受同站的授權返回路徑。

#### Scenario: 登入與同意

- **WHEN** 未登入的使用者從 MCP client 開始授權，開啟 Email 登入連結並確認，再同意存取
- **THEN** 回到同一份授權並取得綁定 MCP 資源的 token，拒絕則回傳 access_denied 且無連線
- **自動化驗證**: `PLUGIN-05`；Playwright 自動操作登入信件 fixture、跨分頁確認、同意／拒絕，斷言 callback state、token 與連線結果。

#### Scenario: 授權竄改拒絕

- **WHEN** 請求使用錯誤 PKCE、重用 code、未註冊回呼、跨瀏覽器或跨來源提交同意、未知 scope 或外部 returnTo
- **THEN** 拒絕授權或 token 交換，不將授權碼送到未驗證的網址，不洩漏網站身分或憑證
- **自動化驗證**: `PLUGIN-06`；Playwright 參數化攻擊輸入，斷言錯誤狀態、無不安全重導向及無未授權連線。

### Requirement: scope 與可撤銷連線

系統 SHALL 區分筆記唯讀與寫入權限；已登入的使用者可在網站設定查看及撤銷自己的 MCP 連線。過期、撤銷或不屬於目前擁有者的授權 MUST 拒絕讀寫與更新 token；產品備份不包含授權憑證。

#### Scenario: token 更新與 scope

- **WHEN** client 更新 token 或以唯讀授權呼叫寫入工具
- **THEN** 有效連線可更新並維持原權限；唯讀 token 無法修改資料或藉更新擴大 scope
- **自動化驗證**: `PLUGIN-07`；Playwright 斷言 refresh、scope 提升拒絕及唯讀工具成功／寫入拒絕。

#### Scenario: 網站撤銷與到期

- **WHEN** 使用者在設定撤銷連線，或授權已到期、擁有者不符
- **THEN** 後續 MCP 請求與 refresh 拒絕，正文與既有網站登入不受影響，授權憑證不進入產品備份
- **自動化驗證**: `PLUGIN-08`；Playwright 網站撤銷與可控時鐘，斷言 401、refresh 失敗、正文保留及備份表格 allowlist。
