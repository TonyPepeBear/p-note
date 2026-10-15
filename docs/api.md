# 個人 API key

在側欄「設定」建立具名 API key，點選「顯示」或「複製」。離開再進入仍可查看同一把 key。每個帳號最多 20 把，名稱 1～80 字元，沒有到期日；撤銷後新請求立即失效。設定頁只接受網站登入，API key 不能管理 key。

所有操作只限 key 所屬帳號；不接受請求自行指定 owner。API 不開放刪除、備份、還原、圖片上傳或 WebSocket。既有網站 API 仍需 cookie；程式使用下列獨立入口。

Codex／ChatGPT 雲端可改用 [遠端 MCP plugin](../plugins/p-note/README.md)，網址為 `https://note.tonypepe.com/mcp`，使用 Email 登入後的 OAuth 授權；此入口不接受 API key 或網站 cookie 取代 OAuth token。

## 請求

Base URL：`https://note.tonypepe.com/api/v1`

標頭：`Authorization: Bearer YOUR_API_KEY`。JSON 寫入另帶 `Content-Type: application/json`。Key 不得放在 URL。主要提供伺服器程式使用，不授予跨來源瀏覽器 CORS。

| 方法 | 路徑 | 用途與輸入 |
| --- | --- | --- |
| GET | `/pages` | 列出自己的可見筆記與日記 |
| GET | `/pages/:id` | 頁面資訊，正文使用下一個入口 |
| POST | `/pages` | 建立筆記，`{"title":"新筆記","parent_id":null,"icon":"📝"}`；icon 可省略 |
| POST | `/pages/:id/title` | 改名，`{"title":"新標題"}` |
| POST | `/pages/:id/icon` | 設定單一 emoji，`{"icon":"👩🏽‍💻"}`；傳 `{"icon":null}` 移除 |
| POST | `/pages/:id/move` | 移動，`{"parent_id":null}` 或上層 ID |
| POST | `/journal` | 開啟或建立每日唯一日記，`{"date":"2026-10-14"}` |
| GET | `/journals?month=2026-10` | 月份日記 |
| GET | `/search?q=關鍵字` | 中文標題與正文搜尋，排除垃圾桶 |
| GET | `/pages/:id/content` | 回傳 `{"blocks":[...]}` 及 ETag |
| PUT | `/pages/:id/content` | 以 `{"blocks":[...]}` 更新正文，必須提供 `If-Match` |
| GET | `/pages/:id/content?expandSyncedBlocks=true` | 保留頁面引用節點，另回傳 `syncedBlocks` 正文與各自 ETag |
| GET | `/synced-blocks/:id/content` | 讀取單一同步區塊，回傳 `{"blocks":[...]}` 及該區塊 ETag |
| PUT | `/synced-blocks/:id/content` | 以 `{"blocks":[...]}` 更新共用正文，必須提供該區塊的 `If-Match` |

頁面 metadata 的 `icon` 為單一完整 emoji 或 null，列表、搜尋及日記皆會回傳。支援複合 emoji、膚色及旗幟；一般文字、多個 emoji 或空字串會回應 400。圖示變更會更新 metadata revision、同步至開啟的網頁並納入備份。MCP 的 `create_page` 同樣接受 `icon`，既有頁面可用 `set_page_icon` 更換或傳 null 移除；寫入需要 `notes:write` 權限。

## 正文範例

正文採 BlockNote JSON，沿用網站區塊格式，包含巢狀 children、props 與 inline content。讀取後先保留 ETag，PUT 以原值傳入 If-Match（包含雙引號）。

```json
{
  "blocks": [
    {"type":"heading","props":{"level":2},"content":"今天的紀錄"},
    {"type":"paragraph","content":[{"type":"text","text":"完成 API 串接","styles":{"bold":true}}]},
    {"type":"checkListItem","props":{"checked":true},"content":"驗證同步"}
  ]
}
```

API 更新會通知正在開啟的網頁。PUT 是有版本保護的正文替換；網站自上次讀取後已修改時回應 412，程式應重新讀取並決定如何合併，不要盲目重送覆蓋。尚未同步的離線編輯仍依既有 Yjs 合併規則處理。

單次 JSON 最多 256 KiB、1,000 區塊、20 層 children。空 blocks 轉為空白段落。圖片等資產區塊只能使用帳號內已上傳的 `/api/assets/:id`，不支援用 API 上傳新圖。一般連結允許 HTTP(S)、mailto、站內路徑及錨點。

## 同步區塊正文與引用

頁面正文的同步區塊只保存引用節點。同一個同步 ID 可在同頁出現多次，各引用節點使用不同的節點 ID：

```json
{
  "blocks": [
    {"id":"reference-example","type":"syncedBlock","props":{"syncedBlockId":"shared-example"},"children":[]}
  ]
}
```

`PUT /pages/:id/content` 只接受 `blocks`，能新增或移除自己已有同步區塊的引用；不能夾帶 `syncedBlocks`、在引用節點加上 `content` 或非空 `children`，也不能使用未知或其他擁有者的同步 ID。移除引用保留共用正文。

明確傳入 `expandSyncedBlocks=true` 時，回應仍保留原本的 `blocks`，並在 `syncedBlocks` 中按同步 ID 去重提供正文：

```json
{
  "blocks": [
    {"id":"reference-example","type":"syncedBlock","props":{"syncedBlockId":"shared-example"},"children":[]}
  ],
  "syncedBlocks": {
    "shared-example": {
      "blocks": [{"type":"paragraph","content":"共用內容"}],
      "etag": "\"generation:hash\""
    }
  }
}
```

HTTP `ETag` 標頭保護頁面正文與引用關係；展開項目的 `etag` 各自保護共用正文。共用正文應先以 `GET /synced-blocks/:id/content` 讀取，再使用該區塊的 ETag 呼叫相同路徑的 PUT。PUT 只接受 `{"blocks":[...]}`，不能巢狀同步區塊；成功後所有引用頁面都會同步更新。過時 ETag 回應 412，缺少 `If-Match` 回應 428。

無法讀取某一個共用正文時，頁面與其他展開項目仍可取得；該項目改為 `{"status":404,"message":"找不到同步區塊"}` 等明確錯誤，不包含 `blocks`。用戶端不能把它當成空正文寫回。

`syncedBlocks` 的 UTF-8 JSON 展開總量最多 8 MiB，包含同步 ID、ETag 與錯誤項目。第一個超出剩餘預算的項目及後續未讀取項目均回傳 `{"status":413,"message":"同步內容展開超過 8 MiB 限制，請分別讀取同步區塊"}`，不包含 `blocks`，並停止後續同步正文 RPC。頁面回應仍為 HTTP 200；需要這些內容時，分別使用單一同步區塊 GET 入口讀取。

## 遠端 MCP

遠端 MCP 共提供 13 個工具。同步區塊使用相同權限、JSON 驗證與版本保護：

| 工具 | 參數與結果 |
| --- | --- |
| `get_content` | `page_id`；可加 `expand_synced_blocks: true` 取得上述 `syncedBlocks` 對照表及各項目錯誤 |
| `update_content` | `page_id`、頁面 `etag`、完整 `blocks`；同步區塊只能增刪引用 |
| `get_synced_block_content` | `synced_block_id`；回傳共用 `blocks` 與該區塊的 `etag` |
| `update_synced_block_content` | `synced_block_id`、該區塊 `etag`、完整 `blocks`；更新所有引用處的共用內容 |

讀取需要 `notes:read`，更新另外需要 `notes:write`；token 與仍有效的授權紀錄都必須具備所需 scope。412 時重新讀取並合併，網路失敗時先讀取確認結果，不盲目重送寫入。其餘工具與 OAuth 連線方式見 [plugin 說明](../plugins/p-note/README.md)。

## 錯誤回應

- 400：格式、日期、區塊或大小不符。
- 401：缺少、無效或已撤銷 key。
- 403：不允許的路由或來源。
- 404：頁面或同步區塊不存在、不屬於自己，或頁面已刪除。
- 409：頁面結構／世代處理中，或 key 已達上限。
- 412：正文版本已改變。
- 413：展開項目超過總量限制，出現在 `syncedBlocks` 個別項目的 `status`。
- 428：缺少 If-Match。
- 503：還原處理中或服務暫時不可用。

## 維運

D1 migration `0005_api_keys.sql` 只新增憑證表。Key 以 SHA-256 驗證摘要與 AES-GCM 密文保存；`API_KEY_ENCRYPTION_SECRET` 為獨立 32-byte hex Workers secret，不納入 Git。任意更換此 secret 將使舊 key 無法再次顯示，維運輪替需另做重加密，不能直接覆寫。

產品備份與 ZIP 不含 API key 或加密密鑰；內容還原不復活撤銷 key。資料庫及 secret 需由平台的權限和備份機制保護。

在其他 worktree 同時執行 E2E 或建置 smoke 時設定 `E2E_PORT_OFFSET`（例如 100，即 5273／8887／5284 起算），避免與這裡的測試服務互相重用；詳見 [自動化驗證](automated-validation.md#e2e-執行與加速)。
