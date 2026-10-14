# Design

## Context

`App` 的頁面載入 effect 只依賴 `[confirm]`，讀 URL、查詢頁面、判斷隔離後以 `start()` 建立 session；`start()` 每次都註冊 Service Worker 並要求快取資源。`Editor` 以 `useCreateBlockNote` 綁定單一 Y.Doc，`Navigation` 掛載時抓頁面列表。隔離、載入目前版本與還原流程依賴 `sessionStorage` 旗標，於 effect 內讀取。

## Goals / Non-Goals

**Goals:** 站內頁面切換不重載文件；session 生命週期正確；上一頁／下一頁與捲動還原；部署新版後能在下一次換頁取得新版。

**Non-Goals:** 引入路由套件；改變雲端同步等待策略（另見 `local-first-open`）；把還原、舊版本檢視、登出改為站內切換。

## Decisions

- **路由**：只有 `/?page=` 一種路由，不引入 react-router。`navigate(id, fresh)` 先保存本機草稿，再 `pushState` 並發出 `p-note:navigate` 事件；`App` 監聽它與 `popstate`，以 `flushSync` 更新路由狀態並同步清空舊 session，確保同一個 JS task 內舊編輯器已卸載，不會被看到前一頁的保存狀態。路由狀態含遞增序號，導向同一網址（例如還原目前頁）也會重新載入。
- **頁面 effect**：依路由狀態重跑；開始時重設 session、隔離、復原、草稿版本與錯誤等每頁狀態。既有 `disposed` 清理會釋放舊 provider、IndexedDB 與 doc；快速換頁時舊流程在 `disposed` 後自行銷毀結果。
- **編輯器**：`<Editor key={room}>`，每份文件重新建立 BlockNote 與 Yjs 綁定，避免跨文件混用。
- **外框**：`Navigation` 保持掛載，`page.id` 改變時重抓頁面列表、關閉面板與抽屜、同步日期／月份並展開目前頁祖先。
- **捲動**：`history.scrollRestoration = "manual"`；離開前把 `scrollY` 寫入目前歷史項目的 state；`popstate` 進入時於 session 就緒、畫面繪製後還原，push 進入時捲到頂端。
- **新版本偵測**：換頁前以 `fetch("/", { cache: "no-store" })` 讀入口 HTML，比較 module script 的 `src` 與目前文件；不同則改用 `location.assign` 整頁載入。查詢逾時（1.5 秒）或失敗（離線）時照常站內切換。
- **啟動一次**：`start()` 內的 Service Worker 註冊與資源快取改為模組層級的單次 promise，失敗時清除以便重試。
- **保留整頁載入**：檢視舊版本（`draft`）、還原備份、登出與登入確認維持 `location.assign`／`location.replace`。

## Risks / Trade-offs

- [跨文件內容混用] → `key={room}` 重建編輯器，UX-18 斷言快速切換後內容與連線數。
- [舊 session 未釋放造成多條 WebSocket] → 斷言最終只有一條開啟中的同步連線。
- [測試依賴整頁導覽事件] → helper 改等網址與新頁就緒。
- [每次換頁多一個 HTML 請求] → 入口 HTML 很小且逾時即略過；換來部署後自動取得新版。
