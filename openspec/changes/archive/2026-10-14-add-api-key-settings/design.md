# Design

## Context

既有 cookie API 只允許同源寫入，正文保存在每頁 SyncRoom 的 Yjs body，必須先持久保存再廣播。另一 agent 在主工作區開發 SPA；本 change 使用獨立分支、依賴、測試埠和本機儲存。

## Goals / Non-Goals

Goals：提供可重複查看且可撤銷的帳號專屬憑證，以及可被一般 HTTP 程式呼叫的 JSON 正文 API。
Non-Goals：OAuth、細分 scope、圖片上傳、刪除／還原、API key WebSocket、Notion 資料庫。沿用產品只允許擁有者 Email 的限制。

## Decisions

- D1 `api_keys` 保存 id、owner_id、名稱、SHA-256 驗證摘要、AES-GCM 密文／隨機 IV、建立／最後使用時間。Key 使用 256-bit 隨機值及 `pn_` 前綴；獨立 `API_KEY_ENCRYPTION_SECRET`（32 bytes hex）由 Workers secret 注入。AAD 綁定 id 與 owner。只存 hash 無法再次顯示，因此採加密而非明文；驗證走 hash 查詢，不需解密。
- 網站 cookie 管理 `/api/keys`、`/:id/reveal`、`/:id/revoke`；列表只含摘要資訊。再次顯示用同源 POST、no-store，離開設定頁清除畫面狀態，不寫入本機儲存。撤銷刪除憑證，無到期日，上限 20 把。
- 外部程式用 `/api/v1/` 與 Authorization Bearer；明確 allowlist：GET pages、pages/:id、journals、search；POST pages、journal、pages/:id/title、pages/:id/move；GET/PUT pages/:id/content。網站 cookie 不能替代 Bearer，Bearer 不能通過舊 API。外部 API 不授予 CORS；browser cross-origin 請求拒絕。沿用伺服器 owner 過濾、垃圾桶與還原鎖。
- JSON 正文採 BlockNote 區塊格式；使用現有套件的無 UI schema／Yjs 轉換。GET 回傳 blocks 及 ETag；PUT 必須 If-Match，版本使用完整持久 Yjs update 的 SHA-256（包含刪除）加世代。單次正文 JSON 最多 256 KiB，限制區塊／巢狀深度，未知型別或屬性拒絕，圖片只能引用本人的既有資產。
- SyncRoom 在同一 permissionTail 內檢查有效 key、頁面、世代、還原鎖、ETag；在候選 Y.Doc 上轉換，落盤成功後才 apply 到活躍文件與廣播。檢查與提交間避免非必要 await；房間 pause 操作仍透過同一序列。重建索引失敗不否定已持久保存，後续讀取／房間啟動可修復。
- 設定頁採独立元件，側欄增加「設定」入口，既有「備份設定」入口保留。初期只提供 API key，附上 API 路徑、授權範圍和使用說明。
- 憑證不納入產品備份／匯出，不會隨內容還原復活。修改為加法 migration，不碰既有資料。

## Risks / Trade-offs

- [可再次顯示需要伺服器解密] → 獨立 secret、不回傳密文、列表遮罩；不得將 secret 放入 git、URL、日誌或測試報告。
- [JSON 整篇覆寫與在線編輯競爭] → 必須匹配完整狀態 ETag，過時回應 412；不在 D1 維護第二份正文。
- [部署與另一 agent 競爭] → 部署前查看目前正式版本及最新已提交紀錄；若另一已完成部署需先整合完成的提交並驗證，不能覆蓋其成果。只修改本 worktree。

## Migration Plan

自動化 Red→Green；規格先提交，實作與驗證再提交。新增 D1 表、配置加密 secret、build／dry-run、發布正式 Worker；自動化確認匿名拒絕、頁面資產與新 API。正式功能驗證使用短期專用 key／測試頁面並清理，憑證不寫入報告。失敗時保留相容的加法表，回退本次 Worker 版本而不碰其他 agent 的後續部署。
