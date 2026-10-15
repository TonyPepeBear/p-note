## Purpose

讓使用者在 Codex 以可安裝的 plugin 連接自己的 p-note，搜尋、讀取與整理筆記日記，同時延續既有 API 的帳號權限、正文版本保護及本機憑證隱私。

## ADDED Requirements

### Requirement: Codex 工具與筆記操作

plugin SHALL 以 MCP 提供列表、搜尋、頁面資訊、建立、改名、移動、日期日記、月份日記及區塊正文讀寫。工具 MUST 對應既有帳號權限，拒絕未知工具與無效輸入。

#### Scenario: 工具發現與讀寫

- **WHEN** Codex 啟動 plugin 並使用有效測試 key 呼叫工具
- **THEN** 可完成握手及工具發現，建立／搜尋／改名／移動／日記及正文讀寫結果與網站一致
- **自動化驗證**: `PLUGIN-01`；Playwright 啟動真實 stdio 子行程，斷言工具清單、API 結果、網站正文及日記唯一性。

### Requirement: 版本與憑證保護

正文更新 MUST 要求讀取時的 ETag，衝突或 key 撤銷時回報工具錯誤與狀態碼，不自動重試覆寫。憑證 MUST 從私人設定或環境讀取，不放入工具參數、輸出或封裝。連線 MUST 拒絕非 loopback 的明文 HTTP 與重新導向。

#### Scenario: 衝突與撤銷

- **WHEN** 使用過時 ETag、撤銷 key、無效輸入或未知工具
- **THEN** 回報可辨識錯誤，拒絕寫入並保留既有正文，不洩漏 key
- **自動化驗證**: `PLUGIN-02`；Playwright 真實 MCP 請求，斷言 412／401、無效參數與未知工具錯誤及正文保留。

#### Scenario: 本機設定與安全入口

- **WHEN** 啟動時缺少 key、設定網址不安全，或服務回應重新導向／含憑證的錯誤
- **THEN** 拒絕連線或回報固定錯誤，stdout 只含協定回應，設定與錯誤輸出不洩漏 key
- **自動化驗證**: `PLUGIN-03`；Playwright 中以子行程和 loopback 故障伺服器自動斷言。

### Requirement: 可安裝封裝

plugin SHALL 提供 Codex manifest、工具配置、技能、安裝文件及 marketplace。獨立封裝 MUST 包含實際啟動程式與所有引用檔案，排除密鑰、私人設定與無關內容。

#### Scenario: 封裝驗證

- **WHEN** 執行封裝命令
- **THEN** 生成可解析的 plugin ZIP，manifest 版本一致、引用完整，且不含私人設定或依賴目錄
- **自動化驗證**: `PLUGIN-04`；Playwright 解析 manifest 與 ZIP，從解壓後目錄啟動 MCP 並斷言工具發現。
