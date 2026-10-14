# 個人 API key

在側欄「設定」建立具名 API key，點選「顯示」或「複製」。離開再進入仍可查看同一把 key。每個帳號最多 20 把，名稱 1～80 字元，沒有到期日；撤銷後新請求立即失效。設定頁只接受網站登入，API key 不能管理 key。

所有操作只限 key 所屬帳號；不接受請求自行指定 owner。API 不開放刪除、備份、還原、圖片上傳或 WebSocket。既有網站 API 仍需 cookie；程式使用下列獨立入口。

## 請求

Base URL：`https://note.tonypepe.com/api/v1`

標頭：`Authorization: Bearer YOUR_API_KEY`。JSON 寫入另帶 `Content-Type: application/json`。Key 不得放在 URL。主要提供伺服器程式使用，不授予跨來源瀏覽器 CORS。

| 方法 | 路徑 | 用途與輸入 |
| --- | --- | --- |
| GET | `/pages` | 列出自己的可見筆記與日記 |
| GET | `/pages/:id` | 頁面資訊，正文使用下一個入口 |
| POST | `/pages` | 建立筆記，`{"title":"新筆記","parent_id":null}` |
| POST | `/pages/:id/title` | 改名，`{"title":"新標題"}` |
| POST | `/pages/:id/move` | 移動，`{"parent_id":null}` 或上層 ID |
| POST | `/journal` | 開啟或建立每日唯一日記，`{"date":"2026-10-14"}` |
| GET | `/journals?month=2026-10` | 月份日記 |
| GET | `/search?q=關鍵字` | 中文標題與正文搜尋，排除垃圾桶 |
| GET | `/pages/:id/content` | 回傳 `{"blocks":[...]}` 及 ETag |
| PUT | `/pages/:id/content` | 以 `{"blocks":[...]}` 更新正文，必須提供 `If-Match` |

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

- 400：格式、日期、區塊或大小不符。
- 401：缺少、無效或已撤銷 key。
- 403：不允許的路由或來源。
- 404：頁面不存在、不屬於自己或已刪除。
- 409：頁面結構／世代處理中，或 key 已達上限。
- 412：正文版本已改變。
- 428：缺少 If-Match。
- 503：還原處理中或服務暫時不可用。

## 維運

D1 migration `0005_api_keys.sql` 只新增憑證表。Key 以 SHA-256 驗證摘要與 AES-GCM 密文保存；`API_KEY_ENCRYPTION_SECRET` 為獨立 32-byte hex Workers secret，不納入 Git。任意更換此 secret 將使舊 key 無法再次顯示，維運輪替需另做重加密，不能直接覆寫。

產品備份與 ZIP 不含 API key 或加密密鑰；內容還原不復活撤銷 key。資料庫及 secret 需由平台的權限和備份機制保護。

在其他 worktree 同時執行 E2E 或建置 smoke 時設定 `E2E_PORT_OFFSET`（例如 100，即 5273／8887／5284 起算），避免與這裡的測試服務互相重用；詳見 [自動化驗證](automated-validation.md#e2e-執行與加速)。
