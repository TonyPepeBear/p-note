## Why

手動「更新 p-note」會鎖住整頁並等待草稿保存與 controllerchange，未完成時可能持續無法操作。UX-20 已在換頁時偵測新版並保存草稿，手動更新入口重複且增加風險。

## What Changes

- 移除手動更新按鈕、更新狀態與 controllerchange 重載流程。
- Service Worker 完整預快取後自動 skipWaiting，不再處理手動啟用訊息。
- 更新草稿保護改由 UX-20 的換頁自動更新負責，保存失敗仍保留編輯畫面。
- 保留舊版快取，讓原分頁繼續讀取原本的雜湊資源。
- 更新 PWA-06、使用文件與相關 E2E／Vitest 驗證。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `progressive-web-app`：自動啟用新版 Service Worker，由換頁流程保護草稿並重新載入。

## Impact

影響前端 PWA 控制項、Service Worker 安裝生命週期與對應測試；沿用 UX-20，無資料遷移。
