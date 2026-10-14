# Design

## Context

BlockNote 使用原生 link inline content，Yjs 正文既有同步、API 與備份均支援此格式。站內導航由 navigate 保存草稿並切換頁面；page_search 已以世代與 checkpoint 防止舊內容覆蓋索引。

## Decisions

- 使用原生 `link`，href 固定為 `/?page=<id>`；顯示文字是插入時標題，可用原生連結工具編輯，改名不改寫其他筆記正文。
- BlockNote SuggestionMenuController 的 `[[` 觸發選單依標題搜尋；同名結果以日記日期／頁面 ID 區別，不建立未存在頁面。離線只搜尋本帳號已快取 metadata。
- 原生站內連結點擊沿用 navigate；保留修改鍵的新分頁操作與外部連結行為。缺失或垃圾桶目標沿用既有錯誤與還原介面。
- page_search 新增 linked_pages JSON 欄位。同步房間從 XmlText 的 link mark 擷取固定站內 href，與正文搜尋、世代、checkpoint 同一 upsert 原子更新；不將普通文字或外部網址誤認為引用。
- GET `/api/pages/:id/backlinks` 僅允許登入擁有者查詢可見目標；來源經 VISIBLE、owner 及 indexed_generation 檢查，去重並排除自我引用。來源改名直接顯示最新標題；刪除／隱藏後立即排除，還原重新顯示。
- 清單每三秒、視窗 focus 與 online 刷新，錯誤保留可重試狀態；離線不宣稱反向索引完整。反向索引失敗不影響已落盤正文，後續同步／重啟重建。
- 備份沿用正文版本，不備份衍生索引；restore 的既有 reindex 從新世代正文重建。JSON API 使用同一原生 link 格式並經相同索引流程。

## Risks / Trade-offs

反向索引為最終一致，雲端保存確認不代表清單立即刷新。插入時文字不自動跟隨改名，避免修改其他筆記的使用者文字。首次提供反向連結前，既有正文若已手動插入站內連結，於房間同步／重啟後納入。
