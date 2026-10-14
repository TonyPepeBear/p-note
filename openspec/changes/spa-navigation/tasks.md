# Tasks

## 1. 規格工具

- [x] 1.1 規格檢查接受 UX-16～20 並更新情境總數；`npm run check:spec` 與 `openspec validate spa-navigation --strict` 通過。

## 2. 站內換頁

- [x] 2.1 新增 UX-16～20 Playwright 測試並取得正確原因的 Red（整頁載入、無捲動還原、無版本偵測）。
- [x] 2.2 實作 History 路由、頁面 effect 依路由重跑與每頁狀態重設、`Editor` 依 room 重建、Service Worker 啟動一次；UX-16、UX-18、UX-19 通過。
- [x] 2.3 外框保持掛載：換頁重抓側欄、關閉面板與抽屜、展開目前頁祖先；捲動還原與新版本偵測；UX-17、UX-20 通過。
- [x] 2.4 調整依賴整頁導覽的 e2e helper，相關頁面、編輯、離線、復原與 UX／UI 測試通過。

## 3. 驗收

- [x] 3.1 完整單元、Workers、e2e、建置 smoke、型別、文件契約、情境覆蓋與 OpenSpec 嚴格驗證通過，更新文件並自動提交。
