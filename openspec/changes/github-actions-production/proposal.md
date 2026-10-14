# Proposal

## Why

正式發布目前依賴本機操作，推送程式後無法自動確認及更新正式站。使用 GitHub Actions 將已驗證的 master 提交部署至既有 Cloudflare 資源。

## What Changes

- 依使用者決定沿用 master，推送或手動執行後先測試與建置，再依序執行資料遷移、部署與公開入口 smoke。
- 正式部署序列化，失敗停止；部署憑證存於 GitHub Actions Secrets。
- 補上自動化契約測試、操作文件與實際執行證據。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `production-deployment`：新增 master 分支自動部署、失敗阻擋與憑證隔離契約。

## Impact

新增 `.github/workflows/deploy-production.yml`、相關測試及部署後檢查腳本；更新正式部署文件。沿用正式 Worker、D1、R2、DO 與現存 Worker secrets。GitHub 須提供部署 API token。
