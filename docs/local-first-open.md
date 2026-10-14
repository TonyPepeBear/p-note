# 本機優先開啟

已下載的頁面不再等待雲端同步即可編輯。規格與任務見 [OpenSpec change](../openspec/changes/archive/2026-10-14-local-first-open/proposal.md)。

## 行為

- `start()` 只在正式頁面尚未下載時等待雲端同步；已下載時直接以本機內容建立 session，由 `Editor` 在背景執行權限檢查並連線，同步後照常送出提交並等待持久回條。
- `/probe` 原型頁沒有權限檢查，`Editor` 不會替它背景連線，因此仍維持先同步。
- `Editor` 掛載時先啟動連線再保存，`flush()` 在連線進行中顯示同步中，不出現短暫的「連線失敗，可重試」。
- 尚未下載的頁面仍等待雲端內容，不會先顯示空白可編輯內容。

## 站內換頁的焦點修正

站內換頁後，頁面操作對話框因頁面改變才關閉，關閉動畫結束時把焦點還給觸發按鈕，搶走新子頁面標題的焦點；整頁載入時代不會發生。對話框關閉後改為只在焦點停在 `body` 時才還原。

## 自動化驗收

[UX-21／22 測試](../tests/e2e/local-first.spec.ts)以 `routeWebSocket` 延後同步連線，連上前暫存頁面訊息再轉送。

- [有效 Red](tdd/red-local-first.log)：UX-21 因等待同步，2 秒內無法編輯；UX-22 在舊版已通過，屬保護既有行為的回歸情境。
- 第一次完整回歸 232 個通過、2 個失敗（chromium 桌面與 webkit 手機的 UX-05，新子頁標題焦點被對話框關閉搶走）；修正後焦點相關三組測試重複兩輪 168 個通過。
- 最終：[完整瀏覽器回歸](tdd/local-first-final-e2e.log) 234 個全部通過；[單元](tdd/local-first-unit.log) 6、[Workers](tdd/local-first-integration.log) 92 個通過（焦點修正只改前端導覽元件，沿用修正前結果）；[建置 smoke](tdd/local-first-build-smoke.log) 2 個通過；情境覆蓋 [UX](tdd/local-first-coverage.log) 66／66、[UI](tdd/local-first-ui-coverage.log) 18／18、[產品](tdd/local-first-product-coverage.log) 129／129；[型別](tdd/local-first-types.log)、[文件契約](tdd/local-first-contract.log)、[OpenSpec](tdd/local-first-openspec.log) 通過。
