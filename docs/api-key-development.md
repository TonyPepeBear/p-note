# API key 開發與驗收

本次使用獨立 worktree 與 `codex/api-key-settings`，起點為已提交的 `030b37c`。原工作區的未提交修改未被複製、暫存、重設或合併。產品範圍與 HTTP 使用方法見 [API 說明](api.md)。

## TDD 證據

- [憑證 Red](tdd/red-api-keys.log)：管理入口尚不存在而回傳 404；加入加密保存、重複顯示、撤銷與受限 Bearer 路由。
- [正文 Red](tdd/red-content-api.log)：正文入口尚未開放；此輪亦發現備份測試讀取欄位錯誤，已依實際 manifest 修正 fixture，未修改產品備份格式。
- [自動整理 Red](tdd/red-api-compaction.log)：65 次 API 更新未整理，新增與既有同步相同的整理門檻。
- [設定頁 Red](tdd/red-api-settings-ui.log)：設定入口尚不存在；[三種瀏覽器 Green](tdd/green-api-settings-ui.log) 驗證重複顯示、複製、離開重入、撤銷與網站／API 正文雙向同步。
- [完整 Workers](tdd/api-full-workers.log)：含新 API 與既有登入、同步、圖片、備份、還原故障驗證；[API 覆蓋檢查](tdd/api-coverage.log) 對應六項規格的 15 個情境環境。

## 測試隔離

[首次完整 E2E](tdd/api-first-e2e-isolation.log) 發現原型前端寫死 8787，雖然測試服務已改埠，原型 WebSocket 仍連向預設埠。已中止該輪，修正隔離腳本使前端原型同步埠一併切換。正式 API 原本即透過同源 proxy 使用專屬埠。

隔離腳本僅在本 worktree 暫改埠，結束後以原始內容還原；沒有修改主工作區檔案或停止其服務。完整回歸以修正後的報告為準，不將中斷或失敗的結果計入成功。

## 正式驗收方式

使用發布管理權限建立十分鐘專用 session，接著透過真正的網站 API 建立、兩次顯示與撤銷 key；Bearer API 建立專用筆記、正文讀寫、搜尋與 ETag 衝突；真實 Chromium 讀取正式內容並開啟設定。憑證只留在記憶體及短暫 0600 SQL 檔，檔案執行後刪除，截圖先隱藏完整 key。

最後將專用筆記移入垃圾桶、撤銷 key 並刪除專用 session。不修改既有筆記；本次不重新驗證真實郵件登入。發布結果與版本完成後記錄於正式部署文件。
