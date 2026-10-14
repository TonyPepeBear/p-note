# Proposal

## Why

第一版已完成本機自動化驗收，但尚未對正式網域提供服務。使用者已授權發布至 Cloudflare，並要求驗證實際登入郵件與同步。

## What Changes

- 佈建專用正式 D1 與兩個私有 R2，套用 migrations 與私有設定。
- 以 Workers Custom Domain 發布至 `note.tonypepe.com`，保留本機測試設定。
- 自動驗證正式 HTTPS、私人入口、實際登入郵件、登入兌換及兩個獨立瀏覽器的持久同步。
- 保留不含密鑰、登入 token 或 session cookie 的發布與驗證紀錄，自動 commit。

## Capabilities

### New Capabilities

- `production-deployment`：正式網域、隔離資源、私有設定與自動化發布驗收。

### Modified Capabilities

無；沿用第一版既有登入、編輯與同步行為。

## Impact

Cloudflare Workers／D1／R2／Email Service、正式 Wrangler 設定、部署驗證腳本與文件。不修改其他應用或既有筆記資料，不新增套件。
