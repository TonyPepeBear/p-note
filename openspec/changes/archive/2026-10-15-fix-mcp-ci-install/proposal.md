# Proposal

## Why

遠端 MCP 已合併，但 Actions 使用 Node 22 隨附 npm 10，將 Wrangler 可選 workers-types peer 判為 lockfile 缺漏而拒絕安裝。npm 11.21.0 的相同 lockfile 安裝檢查通過。

## What Changes

正式部署在 npm ci 前固定安裝 npm 11.21.0，與專案已驗證的依賴管理版本一致。不修改產品功能或 lockfile，不跳過 peer 檢查。

## Capabilities

無產品規格變更，僅固定部署工具版本，使用 skip_specs。

## Impact

Actions 部署 workflow、CICD-01 自動化斷言與發布證據。沿用 migration 及發布流程。
