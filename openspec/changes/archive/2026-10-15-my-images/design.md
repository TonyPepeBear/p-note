## Context

現有 `assets` 表保留 owner_id、原始檔名、MIME、byte_size 與毫秒 created_at。應用入口已驗證 session，`handleAssets` 接收登入使用者 ID；讀取原檔的路由另以 ID 與 owner_id 驗證。

## Goals / Non-Goals

目標是可在現有工作區瀏覽全部自己的圖片，包含未插入正文的成功上傳；保留原始檔案與既有私有路由。

範圍外是公開連結、圖片使用頁面查詢、刪除及「頁面 ↔ 圖片」關聯表。需要查詢使用位置與刪除時，再另立 change 設計關聯及保留規則。

## Decisions

- `GET /api/assets?page=1&page_size=20` 回傳 `items`、`page`、`page_size`、`total`、`total_pages`。每筆只含 id、original_name、mime_type、byte_size、created_at 與私有相對 url。
- owner 只取已驗證 session，不採用用戶端提供的 owner_id；count 與 list 都以 owner_id 綁定參數並在 D1 batch 同一交易執行。
- 排序固定 `created_at DESC, id DESC`，分頁以 LIMIT/OFFSET；新增 `(owner_id, created_at DESC, id DESC)` 索引。
- page/page_size 嚴格正整數，page_size 最大 100，offset 必須為安全整數。預設 1/20；空集合 total_pages 為 0，超出末頁回傳空 items。
- 清單回應使用 no-store，不查 R2、不輸出 object_key、checksum 或 owner_id。
- 前端沿用現有設定頁的工作區顯示模式，切換前保存草稿，文件編輯器保持掛載，圖片與設定畫面互斥；返回文件恢復原畫面。圖片載入遵循既有登入到期流程。
- 原檔以 lazy img 與 object-fit:contain 呈現縮圖，不增加圖片轉換服務；上傳時間以 Asia/Taipei 格式化。

## Risks / Trade-offs

原檔縮圖仍需讀取原始位元組，以 lazy loading 限制同時載入量。OFFSET 分頁在瀏覽期間有新上傳時會依當下資料重新排序；本版提供一致的單次查詢與確定排序，不提供跨請求快照。

## Validation

Workers 驗證擁有者隔離、分頁完整性、同時間排序、非法參數與資料庫故障。Playwright 以 Chromium 桌面執行 Red/Green，再完整三瀏覽器驗收；斷言受保護縮圖、metadata、唯讀範圍、返回保存、空集合、重試與登入到期。
