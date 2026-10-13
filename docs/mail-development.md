# 正式登入寄信 adapter

應用預設使用 Cloudflare Email Service 的原生 `EMAIL.send`，以結構化內容寄出繁體中文純文字與 HTML 登入郵件，不新增 MIME 套件。收件人只能是 `OWNER_EMAIL`，寄件人由 `SENDER_EMAIL` 私有設定提供；連結必須同網站 origin、確認路徑與有效 token 格式。郵件送出後仍需在網站按下確認，不由郵件掃描 GET 兌換。

必要設定為 `OWNER_EMAIL`、`BETTER_AUTH_URL`、`BETTER_AUTH_SECRET`、`SENDER_EMAIL` 與 `EMAIL` binding。缺值、非法地址、服務拒絕或缺少 messageId 都失敗，既有流程刪除這次登入連結並回傳一般 503；不輸出地址、憑證、密鑰或平台錯誤。messageId 只證明服務接受，不代表收件匣送達。

私人發布設定已收到並放在 git 忽略的 `.dev.vars.release`／`.env.release`，新密鑰只在本機產生；沒有上傳 secrets。Cloudflare 唯讀查詢確認所選寄件網域已啟用且 DNS 狀態 ready。沒有新增網域、修改 DNS 或寄送實際郵件。CLI 缺少非互動 API token，改用已連接的 Cloudflare API 完成唯讀確認。

| 驗證 | 證據 |
| --- | --- |
| 原 adapter 缺失：成功申請回 503、binding 未被呼叫 | [有效 Red，3 失敗／1 回歸通過](tdd/red-mail-adapter.log) |
| 原生 payload、可兌換憑證、故障清理與未知帳號 | [Green，4 個結果](tdd/green-mail-adapter.log) |
| 收件人／連結邊界與 HTML 編碼、完整 Workers 回歸 | [Refactor，56 個結果](tdd/refactor-mail-integration.log) |

型別、[build](tdd/mail-build.log)、設定契約與差異空白檢查通過。測試使用假的 Email binding 與隔離真實 D1，沒有 `remote: true`。尚未驗證實際郵件送達；應用靜態入口、備份／還原、世代復原與完整 47 情境仍需完成才具備部署條件。

API 與 binding 契約依 [Cloudflare Workers Email API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/) 與 [send bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/)，型別由固定版本 Wrangler 產生。
