## Why
使用者需要在設定頁查看瀏覽器本地儲存用量與上限，了解離線資料使用的空間。

## What Changes
- 設定頁新增「本地快取」，顯示已用空間／可用上限。
- 瀏覽器提供分項時顯示 IndexedDB 與 Cache Storage 用量。
- 不支援或讀取失敗時顯示無法取得用量的提示。

## Capabilities
### New Capabilities
無。

### Modified Capabilities
- `workspace-experience`：新增本地快取用量呈現。

## Impact
僅影響設定頁與其瀏覽器 E2E；不新增依賴或資料遷移。
