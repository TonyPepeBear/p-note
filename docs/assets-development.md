# 私有圖片開發

本輪完成 OpenSpec 5.3、5.4 的 ASSET-01～04 與 EDIT-03；使用者確認 ASSET-05 成功備份／清理的完整驗收留待 7.1。登入仍用 [本機測試寄件匣](auth-development.md)，沒有部署或建立雲端資源。

## 使用與介面

在正式筆記／日記編輯器選擇「圖片檔案」，按「上傳圖片」。BlockNote 原生檔案選取／貼上也沿用同一 uploadFile。支援 JPEG／PNG／WebP／GIF，每檔最多 **10 MiB（10 × 1024 × 1024 bytes）**，包含邊界；原檔不壓縮、不重新編碼。拒絕 SVG／HEIC、超限、偽造 MIME、截斷／無效容器及 PNG CRC 不符。

前端與後端共用實際容器驗證：PNG 的 chunk／CRC／IHDR／IDAT／IEND、JPEG 的 frame／scan／EOI、GIF 的影像資料子區塊／結尾、WebP 的 RIFF 長度／影像 chunk，動畫 GIF／WebP 也有固定原檔驗證。前端另以瀏覽器解碼確認可顯示；後端沒有新增完整像素解碼器或影像轉檔服務，容器驗證不等於對所有 codec 位元做重編碼校驗。檔名不決定內容格式，格式與宣告 MIME 必須一致。

上傳失敗保留檔案與「重試上傳」，不插入不存在原檔的正式引用。成功後才插入圖片，插入拋錯也保留錯誤與重試；重試可能產生另一未引用原檔，仍不永久清理。BlockNote 原生上傳若失敗，重試更新原圖片區塊。新增圖片需要連線；本文的圖片引用可隨 Yjs 同步，但未提供私人圖片離線快取。

## API 與資料保護

- `POST /api/assets`：同源且有效 session，`Content-Type` 為支援 MIME、`X-File-Name` 為 URI 編碼檔名，body 為原始檔案。檔名限 1～255 字元且不含控制字元。無 Content-Length 也按串流累計限制；中斷／長度不符拒絕。
- 成功回 `201` 與 `{ id, url, mime_type, byte_size, checksum }`；SHA-256 同時寫入 R2 校驗與 D1。R2 原檔使用隨機 ID，conditional put 拒絕覆寫，R2 完成後才寫入 D1。任一失敗均不回傳可引用 URL。
- `GET /api/assets/:id`：每次檢查 session 與 D1 owner，再讀私有 R2。未登入 401、其他 owner／不存在 ID 404；缺原檔／大小不符 503。使用 `Cache-Control: no-store`、`X-Content-Type-Options: nosniff` 與原 MIME，不用公開 bucket、短期 URL 或前端宣告 owner 授權。Service Worker 沿用 `/api/` 排除規則。

沿用 [0001.sql](../migrations/0001.sql) assets 表與既有 ASSETS binding，沒有產品 migration。R2 與 D1 不共用交易：索引失敗或回應遺失可能留下未引用原檔；本輪沒有永久清理，避免誤刪本機／共享／備份引用。移除圖片區塊、頁面垃圾桶與還原均保留原檔及穩定 ID。備份副本與到期清理仍須後續 ASSET-05／BACKUP 驗收。

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

圖片追蹤要求 ASSET-01～04、EDIT-03 的五個 Workers 結果與三個瀏覽器情境 × 三種專案，共 14 個結果。`--assets` 明確排除仍待備份驗收的 ASSET-05；完整產品檢查仍不得通過。TDD 與報告見 [證據](tdd/README.md)。

故障使用真正隔離 D1／R2、原始請求串流錯誤、R2 put 邊界注入與 D1 索引錯誤。瀏覽器故障由測試 Worker 的 R2 寫入注入提供，避免 WebKit Service Worker 繞過 Playwright route；該控制端點不在產品 Worker。跨 context／重開／DO abort 後比對持久引用與原檔位元組／SHA-256。手機是 Chromium／WebKit 模擬，未覆蓋原生 OS 的相簿選取器。
