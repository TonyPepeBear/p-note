# Proposal

## Why

讓使用者從設定頁建立可再次查看的 API key，供自己的程式讀寫私人筆記與日記，免除依賴瀏覽器 cookie 與 Yjs 協定。

## What Changes

- 新增設定頁的 API key 管理：命名、建立、遮罩、再次顯示、複製及撤銷；預設無到期日，撤銷立即停止後續請求。
- 新增 Bearer 驗證的版本化 API，開放自己的頁面／日記列表、搜尋、建立、標題／階層修改與 JSON 正文讀寫。
- 正文更新要求版本條件，避免覆蓋讀取後的其他修改，並沿用即時同步、持久保存與世代隔離。
- Key 只允許內容操作，不允許刪除、備份、還原、圖片上傳、key 管理或 WebSocket 登入。
- 新增自動化驗收、API 使用說明與正式部署驗證。

## Capabilities

### New Capabilities

- `api-key-access`：可重複顯示的個人 API key 管理與受限內容 API。

### Modified Capabilities

無。既有 cookie 入口維持原契約；新 API 是獨立授權入口。

## Impact

React 設定介面、Worker 路由、D1 新增憑證表、SyncRoom 正文 RPC、測試與部署設定。新增獨立加密 secret；憑證不納入產品備份。從已提交的 030b37c 建立獨立 worktree，測試使用獨立埠與狀態，不讀取或修改另一個 agent 的未提交內容。
