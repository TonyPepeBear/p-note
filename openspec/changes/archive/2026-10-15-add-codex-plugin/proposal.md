# Proposal

## Why

使用者需要從 Codex／ChatGPT 雲端連接 p-note。本機 stdio plugin 無法滿足此情境，必須提供公開 HTTPS 的私人遠端 MCP 與 OAuth 授權。

## What Changes

- 在既有 Cloudflare Worker 新增 Streamable HTTP `/mcp`，保留 10 個筆記與日記工具。
- 沿用 Email magic link 登入，加入 OAuth 2.1、PKCE、明確同意、token 更新及網站撤銷連線。
- 保留既有帳號、ETag、還原與同步保護；OAuth 與 API key 共用內容處理。
- plugin 改連遠端服務，不再要求本機 Node.js 或私人設定檔。

## Capabilities

### New Capabilities

- `codex-plugin`: 透過遠端 MCP 與 Email 登入授權使用私人筆記工具。

### Modified Capabilities

無；API key 的既有對外行為維持不變。

## Impact

Worker 路由與內容權限、登入返回路徑、設定頁、OAuth KV 與 D1 撤銷紀錄、plugin manifests、E2E 與文件。採官方 OAuth／MCP 套件，沿用既有 Actions 發布流程。
