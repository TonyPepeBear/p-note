## Why
修復使用者回報的同步停滯、欄位草稿阻塞、標題競態、OAuth callback 與備份資源洩漏，避免內容未能保存或操作失效。

## What Changes
- 對齊編輯器與 API 的合法媒體及連結格式。
- 序列化欄位與標題保存，隔離永久失敗，修正排序與篩選及檢視設定。
- 保護導覽草稿、釋放啟動失敗資源、恢復跨分頁登入。
- 修復 OAuth 跨來源回呼、寄信失敗資訊洩漏、備份錯誤處理與儲存清理；移除上傳圖片 EXIF。

## Capabilities
### Modified Capabilities
- `block-editing`: 補強既有手機可視編輯區契約，避免鍵盤佔位後工具列遮住游標區塊。
- `note-databases`: 欄位保存、檢視、篩選與排序。
- `realtime-sync`: 合法媒體與連結同步。
- `page-history`: 與其他頁面操作隔離及版本寫入清理。
- `workspace-usability`: 標題競態及換頁保存與狀態恢復。
- `codex-plugin`: OAuth 跨來源回呼與授權紀錄。
- `personal-auth`: 跨分頁登入及寄送失敗隱私。
- `private-assets`: EXIF 清理與附加資料 JPEG。
- `backup-restore`: 錯誤處理、資源清理與大份還原。

## Impact
前端 React、共用驗證與 Cloudflare Worker／D1／R2；新增清理工作紀錄 migration 與自動化回歸測試。
