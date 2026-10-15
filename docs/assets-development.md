# 私有圖片開發

圖片上傳與私有讀取涵蓋 ASSET-01～04 與 EDIT-03；「我的圖片」瀏覽涵蓋 ASSET-06～09。ASSET-05 的備份保留由備份驗收追蹤。登入測試使用 [本機測試寄件匣](auth-development.md)。

## 使用與介面

在正式筆記／日記編輯器選擇「圖片檔案」，按「上傳圖片」。BlockNote 原生檔案選取／貼上也沿用同一 uploadFile。支援 JPEG／PNG／WebP／GIF，每檔最多 **10 MiB（10 × 1024 × 1024 bytes）**，包含邊界；原檔不壓縮、不重新編碼。拒絕 SVG／HEIC、超限、偽造 MIME、截斷／無效容器及 PNG CRC 不符。

前端與後端共用實際容器驗證：PNG 的 chunk／CRC／IHDR／IDAT／IEND、JPEG 的 frame／scan／EOI、GIF 的影像資料子區塊／結尾、WebP 的 RIFF 長度／影像 chunk，動畫 GIF／WebP 也有固定原檔驗證。前端另以瀏覽器解碼確認可顯示；後端沒有新增完整像素解碼器或影像轉檔服務，容器驗證不等於對所有 codec 位元做重編碼校驗。檔名不決定內容格式，格式與宣告 MIME 必須一致。

上傳失敗保留檔案與「重試上傳」，不插入不存在原檔的正式引用。成功後才插入圖片，插入拋錯也保留錯誤與重試；重試可能產生另一未引用原檔，仍不永久清理。BlockNote 原生上傳若失敗，重試更新原圖片區塊。新增圖片需要連線；本文的圖片引用可隨 Yjs 同步，但未提供私人圖片離線快取。

## API 與資料保護

- `GET /api/assets?page=1&page_size=20`：有效 session，從 D1 assets 表查詢自己的全部圖片，包含未插入正文的成功上傳。回傳 `{ items, page, page_size, total, total_pages }`，每筆含 `{ id, original_name, mime_type, byte_size, created_at, url }`。`url` 是私有 `/api/assets/<id>`；不回傳 owner_id、object_key 或 checksum，不讀 R2。清單與總筆數在同一 D1 batch，以登入 owner 綁定並依 `created_at DESC, id DESC` 排序。page／page_size 必須為正整數，page_size 最多 100，offset 必須為安全整數；預設 1／20，空集合 total_pages=0，超過末頁回傳空 items。回應 no-store，不能由 owner_id 查詢參數切換擁有者。
- `POST /api/assets`：同源且有效 session，`Content-Type` 為支援 MIME、`X-File-Name` 為 URI 編碼檔名，body 為原始檔案。檔名限 1～255 字元且不含控制字元。無 Content-Length 也按串流累計限制；中斷／長度不符拒絕。
- 成功回 `201` 與 `{ id, url, mime_type, byte_size, checksum }`；SHA-256 同時寫入 R2 校驗與 D1。R2 原檔使用隨機 ID，conditional put 拒絕覆寫，R2 完成後才寫入 D1。任一失敗均不回傳可引用 URL。
- `GET /api/assets/:id`：每次檢查 session 與 D1 owner，再讀私有 R2。未登入 401、其他 owner／不存在 ID 404；缺原檔／大小不符 503。使用 `Cache-Control: no-store`、`X-Content-Type-Options: nosniff` 與原 MIME，不用公開 bucket、短期 URL 或前端宣告 owner 授權。Service Worker 沿用 `/api/` 排除規則。

沿用 [0001.sql](../migrations/0001.sql) assets 表與既有 ASSETS binding；[0011_asset_listing.sql](../migrations/0011_asset_listing.sql) 新增 owner／上傳時間／ID 複合索引。R2 與 D1 不共用交易：索引失敗或回應遺失可能留下未引用原檔；沒有永久清理，避免誤刪本機／共享／備份引用。移除圖片區塊、頁面垃圾桶與還原均保留原檔及穩定 ID。

## 我的圖片

從工作區管理選擇「我的圖片」，每頁 20 張，由新到舊顯示縮圖、原始檔名、格式、大小與台北時間的上傳時間。縮圖以 lazy loading 讀取既有私有原檔，不重新編碼或提供公開連結；大型原圖的傳輸量仍是原檔大小。清單需要連線，失敗可重試，縮圖失敗仍保留 metadata。

切換前保存本機草稿，保存失敗保留文件與錯誤提示；返回文件沿用原本編輯器。與現有設定頁相同，此畫面不另建 URL 路由，重新載入會回到目前文件。列表為唯讀，不提供圖片使用頁面或刪除；需要這兩項時，再另建「頁面 ↔ 圖片」關聯表。列表來自 assets，不掃描頁面正文；連續翻頁期間若有新上傳，各次查詢依當時資料重新排序。

## 自動化驗證

```sh
npm test
npm run test:spec-coverage -- --assets
npm run test:spec-coverage -- --pages
npm run test:spec-coverage -- --auth
npm run test:spec-coverage -- --probe
npm run check
npm run build
npm run check:spec
```

圖片追蹤要求 ASSET-01～04、06～09、EDIT-03 的八個 Workers 結果與六個瀏覽器情境 × 三種專案，共 26 個結果。`--assets` 排除由備份驗收追蹤的 ASSET-05。我的圖片 Red／Green 與驗收見 [證據](tdd/my-images.md)。

故障使用真正隔離 D1／R2、原始請求串流錯誤、R2 put 邊界注入與 D1 索引錯誤。瀏覽器故障由測試 Worker 的 R2 寫入注入提供，避免 WebKit Service Worker 繞過 Playwright route；該控制端點不在產品 Worker。跨 context／重開／DO abort 後比對持久引用與原檔位元組／SHA-256。手機是 Chromium／WebKit 模擬，未覆蓋原生 OS 的相簿選取器。
