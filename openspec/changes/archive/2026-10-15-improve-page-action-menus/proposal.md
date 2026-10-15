# Proposal

## Why

頁面操作目前集中在彈窗，無法像 Notion 一樣快速選擇動作；側欄也缺少直接管理特定頁面的入口。

## What Changes

- 右上角「⋯」改為精簡動作列表，重新命名、移動各自開啟表單，刪除保留確認。
- 側欄每個筆記及資料庫加入「⋯」，右鍵開啟同一列表，開啟選單不切換正文。
- 操作明確綁定選定頁面，保留鍵盤、觸控、還原鎖定及錯誤回饋。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `workspace-experience`：頁面操作採用列表及側欄右鍵入口。

## Impact

影響 Navigation、側欄樣式及頁面操作 E2E／共用測試 helper；沿用既有 API，不新增依賴或資料遷移。
