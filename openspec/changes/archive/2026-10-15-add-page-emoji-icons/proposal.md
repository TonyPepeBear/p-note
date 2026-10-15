## Why
筆記目前只能顯示固定文件圖示，無法以 emoji 辨識內容。圖示需要作為頁面資料保存，讓其他裝置、備份與 MCP 都能取得相同設定。

## What Changes
- 每頁可設定一個 emoji icon，支援新增、更換、移除及複合 emoji。
- 頁面標題上方、側邊欄、筆記連結與資料庫列顯示並可點擊編輯圖示。
- `pages.icon` 保存 nullable emoji，沿用 metadata 權限、同步、離線快取與失敗處理。
- 備份匯出與還原保留 icon，舊備份缺值視為未設定；MCP 可讀寫 icon。

## Impact
- 新增 page-icons 能力及 D1 nullable 欄位遷移，不改正文格式。
- 擴充頁面 API、MCP、metadata 快取及現有備份 manifest。
- 以 Workers 整合測試及三瀏覽器 E2E 自動驗收。
