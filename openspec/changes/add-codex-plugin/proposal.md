# Proposal

## Why

讓使用者直接在 Codex 搜尋、讀取與整理 p-note，沿用現有私人 API 與 Cloudflare 服務。

## What Changes

- 提供可安裝的 Codex plugin、本機 MCP stdio 服務與使用技能。
- 對應現有筆記列表、搜尋、資訊、建立、改名、移動、日記與正文 API。
- 使用私人本機設定或環境變數提供 API key，保留正文 ETag 與錯誤狀態。
- 提供安裝文件、repo marketplace 與不含憑證的封裝。

## Capabilities

### New Capabilities

- `codex-plugin`: Codex 可發現並呼叫私人筆記工具，安全處理設定及版本衝突。

### Modified Capabilities

無；沿用 `api-key-access` 既有介面與權限。

## Impact

新增 plugins/p-note、marketplace、E2E 與文件。既有 Worker、資料庫與部署配置無變更；無新執行期套件。
