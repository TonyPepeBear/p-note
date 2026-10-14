## Context

目前 Service Worker 由編輯器啟動註冊，逐一快取已載入資源，並於安裝時直接 skipWaiting。保留筆記的 Yjs／IndexedDB 機制，將公開應用程式外殼獨立管理。

## Goals / Non-Goals

- 可安裝、登入前即可準備離線啟動、已下載筆記離線續寫。
- 更新前保存正文及中繼資料，錯誤時留在原畫面。
- 不加入推播、背景寫入 API、離線登入或未下載筆記的下載承諾。

## Decisions

- 使用原生 manifest 與 Service Worker，不新增套件。Vite 建置插件將 JS／CSS 與公開圖示加入預快取，依資源內容及 Service Worker 產生版本。
- 導覽使用網路優先、斷線時回到該版根入口；只儲存公開外殼的根路徑，不把筆記 ID 或登入參數寫入 HTTP 快取鍵。私人 API、同步、登入確認及分析端點完全略過。
- 新版預快取完整成功後進入 waiting；使用者按更新才保存草稿、要求啟用並重新載入該分頁。其他分頁不強制重新載入。
- 保留舊版外殼快取，雜湊靜態資源優先使用快取，供仍開啟的分頁在伺服器移除舊檔後繼續載入；瀏覽器可依儲存政策清除。快取寫入失敗不可把成功網路回應變成錯誤。IndexedDB 不受 Service Worker 更新刪除。
- 安裝控制項放在側欄及登入頁。瀏覽器提供 beforeinstallprompt 時使用原生 prompt；其餘提供 Safari／瀏覽器選單說明。獨立模式隱藏安裝按鈕。

## Risks / Trade-offs

瀏覽器決定是否提供安裝提示；自動化驗證 manifest 與安裝事件流程，不宣稱可控制作業系統安裝 UI。離線只涵蓋已下載筆記；瀏覽器清除網站儲存後須重新下載。保留舊版本快取會增加本機用量。

## Validation

依 PWA-01～06 執行 Chromium Red／Green，再執行三種瀏覽器驗收、相關離線與站內換頁回歸、型別、建置 HTTPS smoke、OpenSpec 與文件契約。
