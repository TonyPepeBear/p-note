# 正式編輯器整合

完成 OpenSpec 5.5／5.6。正式頁面與原型共用同一組區塊／格式、程式碼、觸控／鍵盤、中文 composition 與延遲確認測試；正式組使用真正登入、D1 頁面與 SYNC 房間，沒有把原型前綴結果改名當成驗收。

正式頁面提供程式碼複製入口，保留語言、縮排、換行；只複製文字，不執行程式碼。圖片使用既有 [私有圖片服務](assets-development.md)。縮小 viewport 或 visual viewport 時，沿用 ProseMirror 的 selection 滾動，保持正在編輯的段落可見與焦點不變。正式入口使用 session／頁面權限，可供後續部署包使用；原型入口仍限本機。

## 驗證

- [有效 Red](tdd/red-formal-editor.log)：正式程式碼複製入口不存在；其餘四個既有功能直接通過，只記回歸。
- [焦點 Red](tdd/red-formal-focus.log)：三種瀏覽器縮小 viewport 後段落不可見；[Green](tdd/green-formal-focus.log) 證明修正。
- [編輯 Green](tdd/green-formal-editor-e2e.log)：33 個正式／原型結果通過。
- [頁面／圖片／編輯回歸](tdd/refactor-formal-editor-e2e.log)：72 個結果通過，無重試或 skip。
- [Workers 回歸](tdd/refactor-formal-editor-integration.log)：51 個結果通過，包含正式程式碼持久往返與有權限房間的同步測試。
- [正式 EDIT 追蹤](tdd/formal-editor-coverage.log)：17／17。

先執行完整 `npm test`，再以 `npm run test:spec-coverage -- --editor` 比對正式 EDIT-01～05。首次登入等待允許應用既有的 10 秒同步初始化界線；測試不使用 retry。測試 fixture 的初始化／abort 後清理錯誤不計產品 Red。

手機與中文仍採瀏覽器／composition 模擬；Clipboard API 斷言比對複製的原始字串，不要求人類操作 OS 剪貼簿。正式離線啟動、舊世代檢視／另存及備份／還原仍由後續任務完成。沒有部署或雲端變更。
