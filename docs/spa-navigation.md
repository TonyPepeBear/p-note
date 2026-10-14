# 站內換頁

站內切換頁面改以 History API 進行，不再整頁重新載入。規格與任務見 [OpenSpec change](../openspec/changes/spa-navigation/proposal.md)。

## 行為

- `navigate()` 保存本機草稿後 `pushState`，`App` 以 `flushSync` 同步卸載舊編輯器並依路由重新執行頁面載入；`Editor` 依 room 重建，舊 provider、IndexedDB 與 Y.Doc 由既有清理釋放。頁面載入流程在每個等待點檢查是否已被新導航取代，避免舊結果改寫網址或狀態。
- 導航以序號只保留最後一次，快速連點不會亂序。
- 外框保持掛載；換頁時側欄重抓列表、關閉面板與抽屜、同步日期／月份並展開目前頁祖先。
- `history.scrollRestoration = "manual"`；離開前把 `scrollY` 存入目前歷史項目，上一頁／下一頁於正文繪製後還原，新頁從頂端開始。
- 換頁前讀取入口 HTML 比對 module script；伺服器已部署新版時改為整頁載入，查詢逾時（1.5 秒）或失敗時照常站內切換。
- Service Worker 註冊與啟動資源快取只在應用啟動時執行一次。
- 檢視舊版本、還原備份、登出與登入確認維持整頁載入。

## 自動化驗收

[UX-16～20 測試](../tests/e2e/spa-navigation.spec.ts)以記憶體標記判斷是否整頁載入，並在頁面內包裝 `WebSocket` 以 `readyState` 計算目前仍開著的同步連線。Playwright 的 websocket 事件不保證在整頁載入丟棄 socket 時發出 close，最初以它計數會把前幾次整頁載入的連線算入，因此改為頁面內量測。

- [有效 Red](tdd/red-spa.log)：UX-16、17、18、20 因整頁載入失敗（標記消失、捲動歸零、執行環境被銷毀）。UX-19 在舊版已通過，屬保護既有「換頁前保存」行為的回歸情境。
- 最終：[完整瀏覽器回歸](tdd/spa-final-e2e.log) 228 個全部通過，既有 e2e helper 不需修改；[單元](tdd/spa-unit.log) 6、[Workers](tdd/spa-integration.log) 92、[建置 smoke](tdd/spa-build-smoke.log) 2 個通過；情境覆蓋 [UX](tdd/spa-coverage.log) 60／60、[UI](tdd/spa-ui-coverage.log) 18／18、[產品](tdd/spa-product-coverage.log) 129／129；[型別](tdd/spa-types.log)、[文件契約](tdd/spa-contract.log)、[OpenSpec](tdd/spa-openspec.log) 通過。
