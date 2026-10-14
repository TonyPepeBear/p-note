# Design

## Context

見 proposal.md。既有正式設定與部署命令可沿用；遠端預設分支是 master，使用者確認沿用。GitHub 有管理權限，目前沒有 Actions secrets；本機 OAuth 不適合無人值守 CI。

## Goals / Non-Goals

**Goals:** 推送 master 即自動驗證與發布，失敗阻擋，發布憑證限正式工作使用。

**Non-Goals:** 不改動產品、不新增 preview 環境，也不在 CI 讀取私人筆記或申請登入郵件。

## Decisions

- GitHub Actions 使用 Node 22.22 以上與 npm ci；沿用 lockfile 中 Wrangler，不另安裝漂移版本。
- validate 工作執行型別、正式設定、單元、Workers、完整三瀏覽器 E2E 與建置 smoke；deploy 依賴 validate。正式工作以 master ref 限制，手動也受相同限制。
- workflow 使用固定 production concurrency 群組，cancel-in-progress=false，避免中斷資料遷移或並行發布。對應提交 checkout 後重建，部署前檢查必要 secret。
- Cloudflare API token 存於 GitHub Actions Secrets；Account ID 使用既有正式設定。僅 deploy 工作的遠端步驟注入 token。保留 Cloudflare 上既有 Worker secrets，不上傳本機秘密檔。
- 依序執行 dry-run、D1 migrations、deploy，再以無登入 HTTP smoke 比對本次 dist script、401 與 404。smoke 抽出小型可測函式，使用本機 HTTP fixture 測試失敗行為，正式執行強制 HTTPS。
- 憑證優先透過既有 Cloudflare 連接器建立限本帳號的專用 token；若權限不足，保留已完成 workflow 並明確回報尚待設定 secret，不能宣稱已部署。

## Risks / Trade-offs

- [D1 遷移後部署失敗] → 自動停止並回報，遷移須向前相容；不自動回滾資料庫。
- [完整瀏覽器回歸耗時或揭露既有問題] → 使用兩組獨立測試服務，保留原始失敗，不略過失敗部署。
- [公開 smoke 不涵蓋寄信登入與同步] → 只宣稱 HTTPS、建置與未登入限制；完整產品行為由本機隔離測試驗證。
- [部署 token 無法自動建立] → 不以短效 OAuth token 代替長期部署憑證。

## Migration Plan

先提交規格，執行針對性 Red／Green；完成 workflow、文件與本機驗收後檢查提交隱私並推送 master，監看實際 Actions 結果。失敗保留可查詢狀態，修正後重跑；需要緊急復原程式時沿用 Cloudflare rollback，不倒退 D1。
