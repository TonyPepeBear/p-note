# progressive-web-app Specification

## Purpose
定義 p-note 在桌面與手機的安裝、登入前離線外殼、已下載筆記續寫，以及不遺失草稿的應用程式更新行為，維持私人資料與公開快取的隔離。

## Requirements

### Requirement: 可安裝的私人筆記應用程式

系統 SHALL 提供繁體中文名稱、固定應用程式識別、根啟動網址、standalone 顯示、主題色及有效 PNG 一般／遮罩圖示。安裝資訊 MUST 不含私人頁面或登入參數。

#### Scenario: 安裝中繼資料
- **自動化驗證**: `PWA-01`；Playwright：解析 manifest 與 head，斷言 id、start_url、scope 為根路徑，display 為 standalone、lang 為 zh-TW；下載並解碼 192／512 PNG、遮罩圖示及 Apple 圖示尺寸。
- **WHEN** 瀏覽器讀取應用程式入口
- **THEN** 取得完整安裝資訊與可解碼圖示

### Requirement: 安裝操作與瀏覽器說明

系統 SHALL 提供安裝操作，有原生安裝事件時呼叫 prompt；取消後可繼續使用。沒有事件時 SHALL 顯示瀏覽器加入主畫面的說明，獨立模式 MUST 隱藏安裝操作。

#### Scenario: 安裝提示與替代說明
- **自動化驗證**: `PWA-02`；Playwright：派送假的 beforeinstallprompt，點安裝後斷言 prompt 呼叫一次、取消後仍可使用；沒有事件時點安裝斷言說明可見，模擬 standalone 斷言安裝按鈕不存在。
- **WHEN** 使用者要求安裝
- **THEN** 開啟原生提示或提供對應說明

### Requirement: 登入前與筆記離線啟動

系統 SHALL 在未登入時準備應用程式外殼；離線時可重開登入介面，已下載筆記可離線刷新與續寫，未下載筆記 MUST 顯示明確訊息。

#### Scenario: 登入前離線刷新
- **自動化驗證**: `PWA-03`；Playwright：清空 context 後開啟登入頁，等 Service Worker 控制，設為離線後刷新，斷言登入欄位與安裝說明可用，manifest 與圖示亦可讀取。
- **WHEN** 裝置下載外殼後於離線重新開啟
- **THEN** 顯示可用外殼，登入仍須連線

#### Scenario: 從啟動網址回到已下載筆記
- **自動化驗證**: `PWA-04`；Playwright：登入並保存筆記，離線修改後刷新並以不同查詢參數開啟同筆記，斷言正文保留；未下載 ID 顯示尚未下載，恢復網路後可保存。
- **WHEN** 使用者離線重新開啟已下載筆記
- **THEN** 保留本機內容並可繼續編輯

### Requirement: 公開外殼快取隔離

系統 MUST 只快取公開外殼與靜態資源，不快取私人 API、同步連線、登入確認、分析或第三方內容；快取失敗不得阻擋成功網路回應。

#### Scenario: 敏感入口略過快取
- **自動化驗證**: `PWA-05`；Vitest：對 fetch 與 cache-resources 傳入私人端點、登入參數、非 GET、第三方及合法靜態資源，斷言只攔截公開資源、導覽快取鍵不含查詢；模擬快取寫入失敗仍回傳網路成功。
- **WHEN** Service Worker 處理請求或資源清單
- **THEN** 僅保存公開內容，私人端點維持原權限檢查

### Requirement: 更新保護編輯中的草稿

系統 SHALL 在新版 Service Worker 完整預快取後自動啟用，且 MUST 保留舊版快取供原分頁讀取雜湊資源。系統 MUST 不提供手動更新按鈕，也不得因 Service Worker 控制權變更自動重新載入分頁。應用程式更新 SHALL 由 UX-20 的換頁新版偵測負責：重新載入前保存草稿，保存失敗時保留可編輯畫面，其他開啟中的分頁不得被強制重新載入。

#### Scenario: 套用更新與保存失敗
- **自動化驗證**: `PWA-06`；Playwright：安裝真實新版 Service Worker，斷言自動啟用、無更新按鈕、原分頁與其他分頁不重載且可續寫，舊版快取及雜湊資源仍可讀；草稿保存後的換頁重載與保存失敗保護沿用 UX-20、LFN-01。Vitest：斷言預快取完成後才 skipWaiting、預快取失敗不啟用、舊啟用訊息無作用且 activate 不刪快取。
- **WHEN** 使用者編輯期間下載完成新版
- **THEN** Service Worker 自動啟用而不重載畫面，後續換頁依 UX-20 保存草稿後載入新版，舊分頁仍可使用原本資源
