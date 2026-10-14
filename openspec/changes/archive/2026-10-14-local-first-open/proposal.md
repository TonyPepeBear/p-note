# Proposal

## Why

開啟頁面時，即使裝置已下載過該頁，`start()` 仍會在線上狀態等待雲端同步完成（最多 10 秒）才顯示編輯器。站內換頁後，這段等待成為換頁慢的主要來源。Yjs 可以合併稍後到達的雲端更新，已下載頁面不需要等同步就能安全編輯。

## What Changes

- 已下載的頁面在取得頁面資訊後立即顯示並可編輯，雲端同步在背景接上，狀態列顯示同步中，完成後照常取得持久保存確認。
- 未下載的頁面仍等待雲端同步，維持不會顯示空白內容的保證。
- 背景連線開始前不顯示短暫的連線失敗狀態。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `workspace-usability`：新增本機優先開啟需求（ADDED）。

## Impact

`src/client/editor.tsx` 的 `start()` 與連線啟動順序。後端、保存確認協定與隔離檢查不變。
