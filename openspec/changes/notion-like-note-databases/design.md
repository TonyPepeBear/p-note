# Design

## Context

現有 pages.kind 限制為 note／journal，階層、全文搜尋、刪除子樹與世代隔離均圍繞 pages。正文放在個別 Yjs room；metadata 由 D1 HTTP API 保存。備份 version 1 對頁面欄位採嚴格白名單。

## Goals / Non-Goals

**Goals:** 最小相容 migration，沿用頁面 ID、生命週期及正文；以穩定欄位 ID 保持重新命名後的值；所有入口驗證同一套設定。

**Non-Goals:** 不重建同步協定、不提供離線 metadata 寫入；本次一個資料庫對應一份資料來源，表格／清單為其儲存檢視，後續內嵌與連結檢視不需複製筆記。

## Decisions

- pages 新增 nullable database_config TEXT 與 property_values TEXT DEFAULT '{}'。有 config 的 note 是資料庫容器，其直接 note 子頁為資料列。不擴充 kind，避免 SQLite 重建以及既有 API／快取歧義；獨立資料表會增加備份、生命週期及查詢協調，本次沒有必要。
- config JSON 包含 properties 與 views，欄位為穩定 UUID；view 包含 layout、columns、filters、filterMode、sorts。內建 title／created_at／updated_at 不加入可刪自訂欄位。屬性最多 50、檢視最多 20、每檢視最多 20 條件／排序，單一值文字最多 2000 字元，設定本體上限 64 KiB，設定請求含 previous 上限 256 KiB，屬性請求上限 16 KiB；一般表單保留 4 KiB。
- 屬性更新以 SQLite json_set 修改單一欄，條件包含 owner、有效頁面、parent/config 與 sync_generation；避免整包覆蓋其他欄。config 更新比對原始 JSON，拒絕過期寫入；已有值的欄位禁止更換型別，改以新增欄位。已使用選項不允許移除，改名保留選項 ID。
- 刪除欄位及移出筆記保留隱藏的穩定 ID 值，不在新資料庫顯示或重映射；回原資料庫仍保有值。避免移動默默破壞資料。前端清楚說明，備份保留此資料。
- 資料庫容器直接讀取 metadata，不啟動空正文 room 或套用正文草稿隔離；筆記資料列維持既有正文世代隔離。
- 表格／清單用 Mantine，局部橫向捲動；新增／修改欄位和檢視使用 Modal。欄位輸入先保留本地草稿，成功才更新已保存值，失敗維持輸入。其他裝置每三秒及視窗 focus 背景重新讀取，草稿期間不覆蓋輸入；正文不受影響。
- 保存 metadata 必須連線，UI 單獨標示連線限制與保存狀態。既有 title／move／create 行為照舊；禁止資料庫直接嵌套於資料庫的建立及移動。
- version 1 清單白名單擴充為 optional database_config／property_values，舊備份缺欄位取 null／'{}'。校驗 JSON 結構、關係及值型別；restore INSERT 同時恢復兩欄，避免拆開發布。

## Risks / Trade-offs

- [metadata 非即時 CRDT] → 保留本次連線保存邊界，逐欄原子更新與設定衝突拒絕，三秒刷新讓裝置收斂。
- [大量筆記列表] → 沿用私人工作區既有完整列表規模，不引入無需求的伺服器查詢語言；限制設定尺寸，列內容僅 metadata，不載入全部正文。
- [舊程式不識別新欄位] → migration 只新增欄位，發布 migration 後再發布程式；回退保留欄位，避免刪除新資料。部署前完整三瀏覽器回歸與 build/check。

## Migration Plan

先跑相關 E2E 的 Red／Green／Refactor，再執行完整三瀏覽器、單元／Workers 整合、型別、建置與規格校驗。提交程式後以正式設定套用 0006 migration、dry-run、deploy，利用短期管理 session 自動建立專用資料庫驗證正式功能，完成後刪除 session 並移測試資料庫到垃圾桶。成功後同步主規格與封存 change，提交封存紀錄。
