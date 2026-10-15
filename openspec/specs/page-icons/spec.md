# page-icons Specification

## Purpose
讓筆記、日記與資料庫頁面擁有可編輯的單一 emoji 圖示，在所有頁面引用保持一致，並納入同步、離線顯示、備份還原及 API／MCP 存取。

## Requirements

### Requirement: 可編輯的頁面 emoji
系統 SHALL 讓每篇筆記、日記與資料庫頁面設定一個 emoji icon，於標題上方顯示。使用者 MUST 能以滑鼠、鍵盤與觸控新增、更換及移除，未設定時保留新增入口與適當的預設圖示。

#### Scenario: 新增、更換、移除及輸入錯誤
- **WHEN** 使用者於標題上方開啟圖示選擇器，選取 emoji、輸入複合 emoji、再移除
- **THEN** 標題上方顯示目前設定，重新載入仍一致；非單一 emoji 不得儲存
- **自動化驗證**: `ICON-01`；Playwright 三瀏覽器以鍵盤／觸控設定與移除，斷言 DOM、API、重新載入、輸入錯誤及手機無水平溢出。

### Requirement: 所有頁面引用顯示一致圖示
系統 SHALL 在側邊欄、麵包屑、筆記連結與選單、反向連結、搜尋及資料庫列顯示相同頁面 icon。點擊圖示 MUST 能編輯圖示，連結本體仍能導向正確頁面；圖示不得寫入正文文字。

#### Scenario: 引用與資料庫列同步更新
- **WHEN** 在側邊欄、筆記連結或資料庫列更換頁面 icon
- **THEN** 各引用顯示相同值，點圖示不切換頁面，點標題能開啟原頁面，正文資料保持原有連結格式
- **自動化驗證**: `ICON-02`；Playwright 三瀏覽器建立引用與資料庫列，斷言圖示變更、導覽網址、反向連結、連結選單、正文資料及資料庫列內容。

### Requirement: icon 持久化與程式存取
系統 SHALL 在 pages 資料表的新 icon 欄位保存 nullable emoji，沿用 metadata 同步與既有頁面權限，並提供 API 及 MCP 讀寫。已快取 icon MUST 可離線顯示，寫入失敗不得冒充成功。

#### Scenario: API、MCP、雙端與離線行為
- **WHEN** 透過 API 或 MCP 建立、讀取、更新或移除 icon，或另一用戶端更換設定
- **THEN** metadata revision 更新且所有讀取介面回傳目前設定；未授權與無效資料不能改值；其他開啟端最終顯示相同圖示，離線仍顯示已下載設定，寫入失敗提示並保留原圖示
- **自動化驗證**: `ICON-03`；Workers 整合測試斷言 D1、API、MCP、權限與複合 emoji 驗證；Playwright 三瀏覽器斷言雙分頁更新、離線快取、禁用編輯及注入寫入失敗。

### Requirement: 備份與還原保留圖示
系統 SHALL 於備份、匯出及還原保留每頁 icon，並相容沒有 icon 的舊備份。

#### Scenario: 新舊備份與無效資料
- **WHEN** 備份帶有 icon 的頁面並下載及還原，或還原缺 icon／含無效 icon 的 manifest
- **THEN** 有效設定完整保留，舊資料視為 null，無效備份在修改目前資料之前被拒絕
- **自動化驗證**: `ICON-04`；Workers 整合測試建立備份、匯出 ZIP、還原與垃圾桶還原，斷言 icon 相同、缺值為 null、無效 manifest 被拒及原資料未變。
