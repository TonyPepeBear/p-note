# Proposal

## Why

每次切換頁面都以 `location.assign` 整頁重新載入，會白屏、重新註冊 Service Worker、重抓側欄並重建同步連線，是與類 Notion 手感差距最大的地方。整頁重載也讓長時間開著的分頁不會察覺部署後的新版本。

## What Changes

- 站內換頁改以 History API 切換，外框（header、側欄）保持掛載，只替換文件區與該頁的同步 session。
- 上一頁／下一頁回到對應頁面並還原捲動位置；新開頁面捲到頂端。
- 快速連續換頁只保留最後一頁的 session，不混用內容，舊連線完整釋放。
- 換頁前沿用本機保存，離開前的修改不遺失。
- 換頁時比對伺服器入口程式版本，若已部署新版則改為整頁重載以取得新版。
- Service Worker 註冊與啟動資源快取只在應用啟動時做一次。
- 還原備份、檢視舊版本、登出與登入確認維持整頁載入。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `workspace-usability`：新增站內換頁、捲動還原、快速切換隔離、換頁保存與新版本偵測需求（ADDED）。

## Impact

前端 `src/client/main.tsx`、`api.ts`、`navigation.tsx`、`editor.tsx`；e2e 依賴整頁導覽的 helper。後端 API、資料格式與同步協定不變。
