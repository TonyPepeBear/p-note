# Design

## Context

`start()` 在線上、非本機模式且非隔離時，連線並等待 `sync` 事件（逾時 10 秒）；已下載頁面逾時才退回本機。`Editor` 掛載時先 `flush()` 再於尚未連線時呼叫 `online()`；`online()` 先 `checkAccess()` 才 `provider.connect()`。頁面資訊與世代檢查在 `start()` 之前由 `App` 以 API 完成，不依賴 WebSocket。

## Goals / Non-Goals

**Goals:** 已下載頁面不等待雲端同步即可編輯；未下載頁面行為不變；保存確認與隔離檢查不變。

**Non-Goals:** 跳過頁面資訊 API 查詢（隔離與世代判斷依賴它）；預先下載其他頁面。

## Decisions

- `start()` 只在頁面尚未下載時等待同步；已下載時直接回傳未連線的 session，由 `Editor` 既有的 `online()` 在背景執行權限檢查並連線，`sync` 後照常 `flush()` 送出提交並等待回條。
- `Editor` 掛載時先呼叫 `online()` 再 `flush()`，且 `flush()` 在連線進行中（`connecting`）視為同步中，不顯示「連線失敗，可重試」。
- 雲端在背景同步完成前，本機編輯直接套用到 Y.Doc；同步到達後由 Yjs 合併，持久確認仍以最新提交識別判定。

## Risks / Trade-offs

- [其他裝置剛修改時，短暫看到舊內容] → 同步後自動合併；狀態列在確認前顯示同步中，不宣稱已儲存。
- [背景權限檢查失敗] → 沿用 `checkAccess` 的隔離與重新登入處理。
