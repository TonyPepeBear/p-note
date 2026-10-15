## Context
頁面 metadata 位於 D1 `pages`，正文透過 Yjs 同步。頁面讀取與 metadata 輪詢、頁面快取、備份 manifest 已各自攜帶 metadata。

## Decisions
- 新增 `pages.icon TEXT DEFAULT NULL`；單一完整 emoji 為有效設定，null 表示移除。接受 ZWJ、膚色、旗幟、keycap 等複合序列，拒絕多個 emoji、一般文字及非字串值。
- 新增 `POST /api/pages/:id/icon`，沿用現有登入、可見頁面及寫入權限，增加 metadata revision 並更新時間。
- MCP `create_page` 可提供 icon；`set_page_icon` 可更換或移除。讀取、列表、搜尋、資料庫列及 backlinks 回傳最新 icon。
- 可重用 picker 提供常用 emoji、自訂輸入、清除、鍵盤與觸控操作。icon 與連結導覽分開處理，避免點 icon 同時切頁。
- 本機成功更新立即通知其他元件；既有 metadata refresh 接收遠端變更。離線可讀已快取 icon，圖示變更須連線；寫入失敗保持原設定並顯示錯誤。
- 備份 manifest 保持既有版本，metadata 新增 icon；讀取舊備份時缺值補 null，無效值在任何破壞性還原前拒絕。

## Validation
先以相關 Chromium 桌面 E2E 與 Workers 整合測試確認功能缺失，再實作並執行相關回歸、型別與建置檢查；最後執行完整三瀏覽器產品 E2E。所有測試使用固定假資料。
