# Proposal

狀態：第一版規格草案；本次授權規格更新與提交，尚未授權應用程式、測試或原型實作。決策狀態見 [需求整理](../../../docs/v1-scope.md)。

## Why

使用者需要能在電腦與手機書寫、整理及找回私人筆記與日記的系統，並希望跨裝置編輯自動同步。專案尚無應用程式，先建立第一版可驗收規格，釐清保存、離線與備份承諾，再決定如何開始開發。

## What Changes

- 個人階層頁面、選單建立子頁面與電腦／手機可用的區塊編輯。
- 首頁開今天的日記，每天一篇自由書寫並允許補寫。
- 第一版提供圖片與程式碼區塊。
- Email magic link 登入，登入保持 30 天；不使用 Cloudflare Access。
- Yjs 即時內文同步，以 Durable Objects＋y-partyserver 為後端方向。
- 提案區分本機保存、同步與持久確認，處理重連及刪除／還原世代。
- 備份保留 90 天；每日排程、完整匯出與還原流程仍屬提案。
- 基本區塊、搜尋、垃圾桶與離線範圍等見待確認事項；資料庫視圖延後。
- 依新 AGENTS.md 採 TDD；全部驗收改為有 ID、可重現輸入／故障與機器斷言的自動化方法。
- 規格變更與開發完成後自動提交相關檔案，不把產品決策當成人工測試門檻。

## Capabilities

### New Capabilities

- `personal-auth`: 個人 magic link、30 天登入與私人資料／同步入口權限驗證。
- `pages-and-journal`: 階層頁面、每日一篇日記、補寫、首頁與搜尋／垃圾桶提案。
- `block-editing`: 響應式區塊編輯、中文輸入與圖片／程式碼操作。
- `realtime-sync`: 即時內文同步、持久確認、離線重連與世代隔離。
- `private-assets`: 私有圖片上傳／讀取、穩定引用與失敗處理。
- `backup-restore`: 90 天備份、完整性與還原後舊裝置隔離。

### Modified Capabilities

無。`openspec list --specs` 尚無既有能力規格。

## Impact

本次只新增規劃文件與 OpenSpec 設定。後續若獲授權，將涉及 React／Vite、Better Auth、D1、Durable Objects、y-partyserver、IndexedDB、私有 R2 與寄信服務。

六份能力規格皆為審閱草案，Q 編號追蹤產品輸入，V 編號追蹤自動化技術驗證。47 個情境皆有自動化方法；測試工具、故障與 TDD 證據見 [自動化驗證計畫](../../../docs/automated-validation.md)。本次初始化本機 Git 並提交指示／規格文件；未新增依賴、編寫測試或應用程式、建立雲端服務或部署，文件齊備不代表開始 apply。
