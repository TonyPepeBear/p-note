# Design

## Context

見 [proposal](proposal.md)。第一版 248 個本機驗證已通過；`wrangler.app.jsonc` 仍使用本機 placeholder。正式登入設定在 git 忽略且 0600 的 `.dev.vars.release`，帳號資訊在 `.env.release`。已確認 `tonypepe.com` 與寄件網域屬相同 Cloudflare 帳號，正式網站名稱尚未被占用。

## Goals / Non-Goals

**Goals:** 正式設定獨立於本機測試，使用既有 build 與 Worker，不新增依賴；發布紀錄含資源識別與自動化結果。

**Non-Goals:** 不遷移其他應用資料，不封存既有變更，不建立雲端測試後門，不在報告或 git 保存授權憑證。

## Decisions

- 新增 `wrangler.production.jsonc`，從應用範本沿用 bindings、DO migrations 與 cron；選專用 `p-note-production`、`p-note-production-assets`、`p-note-production-backups`，避免修改既有其他應用。相較直接替換本機範本，獨立設定保留本機可重跑驗證。
- 優先 Wrangler 發布與 migrations；資源佈建可使用已連接 Cloudflare API。設定 Custom Domain 讓平台管理 DNS 與憑證，不手寫 IP。
- 密鑰由忽略的檔案輸入 `--secrets-file` 或 `secret bulk`；不作為 shell 參數，也不將內容傳給模型輸出。
- 正式驗證使用 Playwright、實際 Email Service 與 Gmail 唯讀連接器。登入 token 只放短暫 0600 檔／記憶體，報告只包含布林斷言與時間。獨立 context 使用本次取得的 session，專用驗證筆記完成後移入垃圾桶。
- CLI 回呼失敗時使用 `login --device`，不開 localhost callback；使用者自行完成身份驗證，產品驗收仍由自動斷言完成。

## Risks / Trade-offs

- [TLS／DNS 傳播] → 有界重試 HTTPS 檢查，未成功不得宣稱發布驗收完成。
- [Email 接受不代表送達] → Gmail 查詢實際訊息，明確區分寄信失敗、尚未送達與登入成功。
- [驗證修改正式資料] → 僅建立具唯一標記的筆記，正常移入垃圾桶，不清空資料庫或刪除其他頁面。
- [部署失敗] → 保存實際失敗結果，不將未驗證情境勾選完成；已有資源保留供重試，不刪除資料。

## Migration Plan

確認資源不存在後佈建；正式設定檢查 Red → 綁定真實 ID 與網域 Green；套用所有 D1 migrations；建置及 dry-run；上傳私有設定並部署；HTTPS、實際郵件登入、雙向同步與全新載入自動驗證；提交設定與報告。後續版本可使用 Wrangler rollback 回復 Worker，資料遷移與儲存不自動反向刪除。
