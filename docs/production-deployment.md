# Cloudflare 正式發布

正式網站為 [note.tonypepe.com](https://note.tonypepe.com)，發布設定為 `wrangler.production.jsonc`；本機 `wrangler.app.jsonc`、測試設定與其他應用資源保留原狀。

| 資源 | 正式設定 |
| --- | --- |
| Worker | `p-note-production` |
| D1 | `p-note-production`，`5a1ead73-a776-4e75-824c-387e0f9bd5c6`，APAC |
| 私人圖片 R2 | `p-note-production-assets`，APAC，無公開網域 |
| 私人備份 R2 | `p-note-production-backups`，APAC，無公開網域 |
| DO | `ProbeRoom`、`SyncRoom`、`RestoreCoordinator`，SQLite migrations v1／v2 |
| 備份 cron | `0 19 * * *`，台北每日 03:00 |
| Custom Domain | `note.tonypepe.com`，由 Cloudflare 管理 DNS／TLS |

私人發布輸入只在 git 忽略的 `.dev.vars.release`，最初四個設定以 Cloudflare `secret_text` 上傳；本次另由忽略的 0600 `.env.api-key-secrets.json` 新增 `API_KEY_ENCRYPTION_SECRET`，目前共五個 secrets；版本控制與報告不含密鑰、登入 token 或 session cookie。平台紀錄已啟用 query string 遮蔽。資源與 secret 名稱證據見 [雲端設定](tdd/production-cloud.json)、[私人 R2](tdd/production-r2.json)。

## 發布與重跑

CLI 使用固定版本的既有 Wrangler。登入若遇到 localhost 回呼問題，使用 `--device`；Cloudflare OAuth 固定回到 8976，修改 callback port 並不改變平台 redirect URI。

```sh
node node_modules/@cloudflare/vitest-plugin/node_modules/wrangler/bin/wrangler.js login --device --scopes account:read user:read workers:write workers_scripts:write workers_routes:write d1:write zone:read ssl_certs:write email_sending:write
npm run check:production -- --cloud --secrets-report=docs/tdd/api-production-secrets.json
npm run check
npm run test:build
node node_modules/@cloudflare/vitest-plugin/node_modules/wrangler/bin/wrangler.js d1 migrations apply p-note-production --config wrangler.production.jsonc --remote
node node_modules/@cloudflare/vitest-plugin/node_modules/wrangler/bin/wrangler.js deploy --config wrangler.production.jsonc --dry-run
node node_modules/@cloudflare/vitest-plugin/node_modules/wrangler/bin/wrangler.js deploy --config wrangler.production.jsonc --secrets-file .dev.vars.release
```

首次四個 migrations 全部成功，見 [正式遷移](tdd/production-migrations.log)。初次發布版本為 `f71cfeea-9540-4652-8330-95f5cecb47dd`；啟動快取修正後發布版本為 `bbcc5e44-64ea-4a8f-8388-682a653d0b26`，見 [修正版發布](tdd/production-fixed-deploy.log)。後續不需變更密鑰時可省略 `--secrets-file`，Wrangler 保留已上傳的 secrets。

`npm run test:production` 使用有效正式 TLS 與實際郵件申請；Gmail 唯讀連接器自動比對寄件者、收件者、時間窗、標題與同網域連結，將本次 token 放入忽略的 0600 `.env.production-login`。腳本讀取後立即刪除檔案，session 只在記憶體，禁止輸出郵件本文、登入連結或 cookie。一次申請等待最多三分鐘，不以重試繞過速率限制。

## 自動化驗證

- DEPLOY-01：[設定 Red](tdd/red-production-config.log) → [正式設定 Green](tdd/green-production-config.log)；雲端資源與 secrets 類型由 API 檢查。
- DEPLOY-02～04：[正式結果](tdd/production-results.json)、[執行紀錄](tdd/production-smoke.log)。涵蓋 HTTPS、私人 API／測試入口、真實郵件、一次性確認登入、獨立 context 的雙向 wss 保存、全新 context 無本機正文快取的雲端載入與正常垃圾桶清理。
- 實際 Gmail 郵件：[寄件／時間／SPF／DKIM／DMARC 斷言](tdd/production-mail.json)，不保存本文。
- 正式快取故障：[真實失敗](tdd/red-production-startup.log)顯示分析 POST 被轉為 GET 快取，阻擋編輯器；[單元 Red](tdd/red-platform-cache.log) → [6 個單元 Green](tdd/green-platform-cache.log)；排除 `/cdn-cgi/` 後 [2 個 HTTPS 建置測試](tdd/green-platform-build.log)通過。
- [24 個三種瀏覽器快取／離線／重連回歸](tdd/production-cache-regression.log)通過；[文件契約 Red](tdd/red-deployment-contract.log) → [51 個情境契約 Green](tdd/green-deployment-contract.log)。第一版 248 個部署前結果保留為歷史證據，不將本輪針對性回歸宣稱為全套重新執行。

首次 HTTPS 檢查碰到 DNS／TLS 生效中的短暫連線錯誤，見 [初次結果](tdd/production-first-tls-results.json)，後續未略過正式憑證驗證。正式驗證只編輯唯一標記的專用筆記，完成後透過正常垃圾桶流程清理；登入首頁可能建立當日日記，不修改當日日記正文。

本輪不宣稱每日排程已經歷實際隔夜執行或長期負載驗證。備份、圖片與還原功能的本機故障驗收仍見 [部署前證據](predeployment.md)，本輪正式驗收範圍以部署、登入寄信與同步為主。

## Mantine 介面發布：2026-10-14

依使用者部署指示發布程式提交 `af44c33`，正式 Worker 版本為 `56d44ed5-bf03-4942-afe9-55b2a1929392`，見 [部署紀錄](tdd/ui-production-deploy.log)。沿用既有 D1、R2、DO、寄信設定與排程，沒有資料遷移。

[正式驗證結果](tdd/ui-production-results.json)及 [執行紀錄](tdd/ui-production-smoke.log)顯示新版 Mantine 登入、HTTPS／私人 API／測試入口、實際郵件、一次性登入、兩個獨立 context 雙向 wss 保存及全新 context 載入全部通過，驗證筆記已移入垃圾桶。[郵件驗證](tdd/ui-production-mail.json)顯示 SPF、DKIM 與 DMARC 通過；[正式登入畫面](screenshots/ui/production-login.png)保存實際渲染結果。

本機完整 UI 回歸仍待完成，歷史失敗與高負載證據保留於 [介面改版驗收](ui-redesign.md)；本次上線成功不代表該驗收已完成。

## 工作區可用性修正發布：2026-10-14

依使用者部署指示發布程式提交 `e82c35b`（[可用性修正](ux-polish.md)，本機完整回歸 213 個通過），正式 Worker 版本為 `0aec1a7b-b791-4f0f-8385-f2e1126e0203`，見 [部署紀錄](tdd/ux-production-deploy.log)。沿用既有 D1、R2、DO、寄信設定與排程，沒有資料遷移或密鑰變更；發布前 [雲端設定](tdd/ux-release-cloud.log)、[建置](tdd/ux-release-build.log) 與 [預檢](tdd/ux-release-dry-run.log) 通過。

[正式驗證結果](tdd/ux-production-results.json)與 [執行紀錄](tdd/ux-production-smoke.log)：DEPLOY-02（HTTPS、新版建置資源、私人 API、測試入口封鎖）與新版登入畫面無溢出通過，[正式登入截圖](screenshots/ui/production-login-ux.png)。DEPLOY-03／04 未完成：本次可用的 Gmail 連接器不是擁有者信箱，無法讀取實際登入郵件，腳本在三分鐘後判定未取得郵件；登入、雙向 wss 保存與全新 context 載入尚待以擁有者信箱重跑 `npm run test:production -- --ui`。上一版的正式證據保留於 `ui-production-*`，未被本次結果覆蓋。

## 站內換頁與本機優先開啟發布：2026-10-14

依使用者部署指示發布程式提交 `752076e`（[站內換頁](spa-navigation.md)、[本機優先開啟](local-first-open.md)，本機完整回歸 234 個通過），正式 Worker 版本為 `8b781f4f-8c25-44fc-8b4d-18cc1d2e4c0a`，見 [部署紀錄](tdd/spa-production-deploy.log)。沿用既有 D1、R2、DO、寄信設定與排程，沒有資料遷移或密鑰變更；發布前 [雲端設定](tdd/spa-release-cloud.log)、[建置](tdd/spa-release-build.log) 與 [預檢](tdd/spa-release-dry-run.log) 通過。

發布後確認正式入口提供的 module script 與本機建置相同（[`index-DncQOMWj.js`](tdd/spa-production-entry.log)）。依使用者指示，本次不執行正式登入、寄信與同步驗證，驗收以本機完整回歸為準。

## 個人 API key 發布：2026-10-14

於獨立 `codex/api-key-settings` worktree 完成規格與 TDD，並合入另一 agent 已提交的站內換頁、本機優先與封存紀錄；未修改主工作區或取用其未提交程式。發布程式提交 `986d838`，正式 Worker 版本為 `81abdcc4-d8fb-416e-9eda-c9ec46d07e21`，見 [發布紀錄](tdd/api-production-deploy.log)。發布前核對當時正式版本為已整合的 `8b781f4f-8c25-44fc-8b4d-18cc1d2e4c0a`。

[唯一資料遷移](tdd/api-production-migrations.log)新增 `api_keys`；新增加密 secret 並保留原四個 secrets，[名稱與類型](tdd/api-production-secrets.json)、[設定檢查](tdd/api-production-config.log)通過。設定檢查的 bindings／網域／R2 使用既有設定證據，secret 名稱為本次重新讀取。[最終部署預檢](tdd/api-merged-dry-run.log)通過。

整合後 [240 個瀏覽器測試](tdd/api-merged-e2e.log)、[2 個 HTTPS smoke](tdd/api-merged-smoke.log)通過；本輪另有 101 個 Workers 與 6 個單元測試，詳見 [開發驗收](api-key-development.md)。

[正式結果](tdd/api-production-results.json)與 [執行紀錄](tdd/api-production-smoke.log)驗證正式 JS 與本機 build 一致、未登入拒絕、key 建立／重複顯示／撤銷、正文讀寫／搜尋／ETag 衝突、範圍限制、Chromium 正文及設定頁。使用管理員建立的十分鐘 session，不重新驗證寄信登入；[正式畫面](screenshots/ui/production-api-settings.png)已隱藏 key。[清理查詢](tdd/api-production-cleanup.json)確認臨時 session、key、未刪除測試頁皆為零，測試筆記已依產品流程移入垃圾桶。

[首次驗收](tdd/api-production-first-results.json)因 Wrangler `--json` 前仍輸出上傳進度，腳本誤判 SQL 成功輸出為解析錯誤；修正驗證腳本後重跑通過，未改動部署程式。首次清理欄位為誤判，最後遠端查詢已確認沒有留下測試憑證。使用方法見 [API 文件](api.md)。

本功能分支與提交保留於獨立 worktree，未回寫主工作區；下次從其他分支發布前須先合入本分支，以免移除已上線功能。

## 已下載頁面本機優先導覽發布：2026-10-14

依專案流程發布程式提交 `4ba7a6a`（[TDD 報告](tdd/local-first-page-navigation.md)，三瀏覽器 291 個通過），正式 Worker 版本為 `017df0d7-c063-4ae6-bbab-71cf2b1d9389`，見 [部署紀錄](tdd/lfn-production-deploy.log)。發布前正式版本為 `81abdcc4-d8fb-416e-9eda-c9ec46d07e21`（API key），本提交已包含。只改前端，沿用既有 D1、R2、DO、寄信設定與排程，沒有資料遷移或密鑰變更；[雲端設定](tdd/lfn-release-cloud.log)（以即時 [secret 名稱](tdd/lfn-production-secrets.json)比對）、[建置](tdd/lfn-release-build.log)與[預檢](tdd/lfn-release-dry-run.log)通過。

[正式 smoke](tdd/lfn-production-smoke.log)：入口 module script 與本機建置相同、未登入頁面 API 回 401、測試入口 404。未執行需實際郵件登入的 `npm run test:production`，驗收以本機完整回歸為準。
