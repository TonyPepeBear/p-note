## Why

p-note 已有離線筆記同步，但沒有可安裝的應用程式資訊，且登入前不會下載啟動資源。補齊 PWA，讓桌面與手機可加入主畫面並可靠地離線啟動。

## What Changes

- 加入繁體中文 manifest、一般／遮罩圖示及 Apple touch icon。
- 登入前即註冊 Service Worker，建置時產生版本化啟動快取。
- 提供安裝按鈕與不支援安裝事件時的瀏覽器操作說明。
- 新版等待使用者套用；保存草稿失敗時不更新，不自動重新載入其他分頁。
- 限制 HTTP 快取為公開靜態資源，保留既有 IndexedDB 筆記同步與登入隔離。

## Capabilities

### New Capabilities
- `progressive-web-app`: 安裝、離線啟動、快取隔離及安全更新。

### Modified Capabilities

無。

## Impact

影響 Vite 建置、靜態檔案、前端啟動與安裝介面；不變更資料庫 schema、私人 API 或筆記格式。沿用 Cloudflare 靜態資源部署。
