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

私人發布輸入只在 git 忽略的 `.dev.vars.release`，四個設定以 Cloudflare `secret_text` 上傳；版本控制與報告不含密鑰、登入 token 或 session cookie。平台紀錄已啟用 query string 遮蔽。資源與 secret 名稱證據見 [雲端設定](tdd/production-cloud.json)、[私人 R2](tdd/production-r2.json)。

## 發布與重跑

CLI 使用固定版本的既有 Wrangler。登入若遇到 localhost 回呼問題，使用 `--device`；Cloudflare OAuth 固定回到 8976，修改 callback port 並不改變平台 redirect URI。

```sh
node node_modules/@cloudflare/vitest-plugin/node_modules/wrangler/bin/wrangler.js login --device --scopes account:read user:read workers:write workers_scripts:write workers_routes:write d1:write zone:read ssl_certs:write email_sending:write
npm run check:production -- --cloud
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
