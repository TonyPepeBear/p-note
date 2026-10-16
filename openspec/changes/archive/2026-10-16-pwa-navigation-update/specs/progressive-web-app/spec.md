## MODIFIED Requirements

### Requirement: 更新保護編輯中的草稿

系統 SHALL 在新版 Service Worker 完整預快取後自動啟用，且 MUST 保留舊版快取供原分頁讀取雜湊資源。系統 MUST 不提供手動更新按鈕，也不得因 Service Worker 控制權變更自動重新載入分頁。應用程式更新 SHALL 由 UX-20 的換頁新版偵測負責：重新載入前保存草稿，保存失敗時保留可編輯畫面，其他開啟中的分頁不得被強制重新載入。

#### Scenario: 套用更新與保存失敗
- **自動化驗證**: `PWA-06`；Playwright：安裝真實新版 Service Worker，斷言自動啟用、無更新按鈕、原分頁與其他分頁不重載且可續寫，舊版快取及雜湊資源仍可讀；草稿保存後的換頁重載與保存失敗保護沿用 UX-20、LFN-01。Vitest：斷言預快取完成後才 skipWaiting、預快取失敗不啟用、舊啟用訊息無作用且 activate 不刪快取。
- **WHEN** 使用者編輯期間下載完成新版
- **THEN** Service Worker 自動啟用而不重載畫面，後續換頁依 UX-20 保存草稿後載入新版，舊分頁仍可使用原本資源
