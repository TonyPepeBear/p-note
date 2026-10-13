# 第一版需求、技術決策與待確認事項

整理日期：2026-10-13（Asia/Taipei）。

狀態：使用者已接受伺服器可讀內容與已下載內文離線範圍，其餘細節採本文預設。已授權先更新並提交規格，再建立自動化環境，以 TDD 驗證 BlockNote、Yjs 持久化及離線重連。此次不包含完整產品、備份原型、部署或雲端資源建立。

## 已確認的第一版範圍

| 項目 | 已確認內容 |
| --- | --- |
| 使用者／裝置 | 先以自己使用為主，電腦與手機都能使用 |
| 首頁 | 先開今天的日記 |
| 筆記 | Notion 式頁面階層與區塊編輯，從選單建立子頁面 |
| 日記 | 每天一篇自由書寫，可以補寫 |
| 區塊 | 第一版包含圖片與程式碼區塊 |
| 同步 | 第一版納入 Yjs 即時同步 |
| 登入 | Email magic link，登入保持 30 天 |
| 備份 | 保留 90 天 |
| 後續功能 | 資料庫表格、看板等視圖之後再做 |

## 已確認的技術方向

| 決策 | 狀態與界線 |
| --- | --- |
| React＋Vite | 已選定；TypeScript 為開發語言 |
| BlockNote | 0.55.0 已通過本機自動化技術驗證，採用為第一版編輯器；原生 OS 與正式服務仍在後續範圍 |
| Better Auth＋magic link | 已選定方向，不使用 Cloudflare Access |
| Yjs | 已納入第一版，不再以整篇 JSON 版本衝突作為內文同步主方案 |
| Durable Objects＋y-partyserver | 已選定同步後端方向，保存適配、確認、重啟及整理已通過本機測試；正式權限／世代操作仍待完成 |
| Cloudflare | 專案要求優先使用 Cloudflare，以 Workers Paid plan 為前提 |
| 開發與驗收 | 依新 AGENTS.md 使用 TDD、全自動驗收、規格修改及開發完成後自動提交 |

## 已採用操作流程

使用者已授權採用以下預設。

1. 首次登入後開今天的日記；重新登入後回到原本編輯的頁面。
2. 電腦使用左側導覽與右側編輯區；手機優先呈現內容，從選單開啟導覽。
3. 筆記頁面能寫內容，也能包含子頁面；以路徑導覽返回上層。
4. 日記以日期入口與月份列表瀏覽，日記日期獨立於建立時間。
5. 電腦提供 `/` 選單與區塊拖曳；手機必要操作都有可點選入口。
6. 區塊：段落、標題、項目／編號清單、待辦、引用、分隔線、圖片、程式碼；文字格式為粗體、斜體、連結。
7. 提供搜尋與垃圾桶還原；暫不規劃永久刪除與自動圖片清理。

## 儲存與同步決策

| 位置 | 責任 |
| --- | --- |
| D1 | Better Auth 資料、頁面擁有者／階層／日期／垃圾桶，以及可重建的搜尋資料 |
| 每頁的 SQLite-backed Durable Object | Yjs 原始狀態、更新紀錄、持久保存檢查點與房間狀態 |
| 私有 R2 | 不覆寫的圖片原檔，使用穩定識別 |
| IndexedDB＋y-indexeddb | 原裝置 Yjs 狀態、離線快取與尚未確認的提交 |
| 獨立私有 R2 備份區 | 備份清單、Yjs 狀態、產品資料與圖片副本 |

- Yjs 二進位狀態是內文原始資料；BlockNote JSON、摘要與搜尋文字是匯出或衍生資料。
- 寫入承諾是「驗證 → 持久保存 → 回覆提交確認 → 廣播」；連線或 provider 已同步不等於已保存。
- 不將整篇版本號衝突與 Yjs 同時設為內文的兩個寫入來源；階層、日期與垃圾桶仍需後端規則。
- 離線範圍限於已下載頁面內文；新增頁面、標題／階層異動與圖片上傳先要求連線。
- 一般重連合併同世代更新；刪除、還原或權限失效時先停止寫入。

## 備份與還原決策

- 每日 Asia/Taipei 03:00 備份（UTC cron `0 19 * * *`）；成功時間起保留 90×24 小時，達到界線即可清理；尚未建立排程。
- 完整備份包含頁面／階層／日記日期／垃圾桶／圖片資料、每篇 Yjs 狀態與引用圖片。
- 清單記錄格式版本、穩定擁有者 ID、世代、檢查點、擷取時間與校驗值。
- 所有必要檔案驗證完整後才標記成功；保留中備份引用的圖片不可清理。
- 採固定階層與頁面清單、逐篇擷取，記錄時間窗；不承諾整站同一瞬間快照。
- session、magic link 憑證與服務密鑰不納入可還原的產品匯出；擁有者 ID 必須正確映射。
- 還原前備份現況、暫停受影響寫入、以新世代恢復；舊裝置修改供檢視或另存，不自動合併。
- 提供手動完整匯出到自己的裝置，以設定頁下載 ZIP（含 JSON 清單、Yjs 二進位與圖片），並從成功備份列表選擇覆蓋還原。同 Cloudflare 帳號內的備份不是帳號之外的副本。

## 待確認事項

此表是單一決策清單。Q1、Q2、Q4–Q9 已採用預設，Q3 是接入登入／部署前的私有設定輸入，不阻擋本機技術驗證。V 全部自動化；此次執行 V1、V2 與同世代離線重連，V3、V4 留在後續。

| 編號 | 待確認／驗證內容 | 目前提案與影響 |
| --- | --- | --- |
| Q1 | 已決定：固定到期 | 登入建立起 30×24 小時，不因使用續期 |
| Q2 | 已決定：伺服器可讀內容 | 由登入與所有權保護，不採端對端加密 |
| Q3 | 允許登入 Email、網站網址與寄件網域／寄信服務 | 僅允許指定擁有者 Email，先評估 Cloudflare Email Service；密鑰不寫入文件 |
| Q4 | 已採預設：單次連結有效 10 分鐘 | 同 Email 每 60 秒可寄一次、每 15 分鐘最多 5 次；同 IP 每 15 分鐘最多 20 次；以伺服器時間／持久計數限制 |
| Q5 | 已決定：已下載內文可離線 | 標題留 D1，新增頁面、標題／階層異動與圖片上傳要求連線 |
| Q6 | 已採預設：上述基本區塊、搜尋與垃圾桶 | 不做永久刪除；圖片與程式碼納入 |
| Q7 | 已採預設：保留原圖，不壓縮 | JPEG／PNG／WebP／GIF，每檔最多 10 MiB；不接受 SVG／HEIC，提示先轉成支援格式；正式上傳驗證仍待 ASSET 測試 |
| Q8 | 已採預設：每日台北 03:00、90 天、時間窗備份 | 設定頁下載完整 ZIP、選成功備份覆蓋還原；不做版本時間軸 |
| Q9 | 已採預設：Asia/Taipei 與原先還原規則 | 同日期先還原；上層刪除隱藏子樹，還原時先前單獨刪除子頁仍留垃圾桶 |
| V1 | BlockNote 中文 composition、手機模擬觸控／選取／區塊移動、圖片與程式碼 | Playwright 程式斷言通過才視為編輯器定案；原生 OS 行為限制見自動化計畫 |
| V2 | y-partyserver 廣播前保存、提交確認、休眠／重啟與快照整理 | Workers 整合故障注入／eviction／abort 測試；不能只依 state vector 判斷刪除已保存 |
| V3 | D1／DO 刪除、還原、世代切換中斷後恢復 | Workers 整合測試逐階段注入失敗，斷言可重試與停止舊房間寫入 |
| V4 | 備份依賴、校驗、90 天清理與完整恢復 | 自動匯出到乾淨測試儲存並比較資料／雜湊；以可控時鐘測保留邊界 |

## TDD 與自動化驗證

已要求採用 Red → Green → Refactor；每個行為先證明正確原因的測試失敗，再最小實作與重構，保存機器報告。全部 47 個情境均有唯一驗證 ID 與自動化方法；此次開始技術驗證；已執行結果另存 TDD 證據，不把技術原型視為完整產品。

工具方向為 Vitest、Cloudflare 官方 Workers 整合及 Playwright。人工檢視、實際手機操作、人工收信與手動還原都不作為驗收門檻；手機模擬與中文事件的覆蓋限制明確記錄，不能宣稱等於原生 OS 輸入法。

詳細契約見 [自動化驗證計畫](automated-validation.md)。規格修改後與完成開發後各自自動提交相關檔案；先提交確認後規格，再完成已授權的技術驗證。

## 本次技術驗證結果

已完成 49 個自動化結果（單元 4、Workers 12、桌面／手機 E2E 33），原型追蹤要求的 40 個結果全部通過。BlockNote 採用、持久確認／重啟／整理與已下載內文離線刷新重連已有證據。正式 47 個產品情境尚未完成；V3、V4 仍未執行。詳見 [TDD 結果與限制](tdd/README.md)。

## 暫不規劃

- 資料庫視圖：使用者指定後續再做。
- 團隊分享、公開註冊、多人權限介面、評論與 AI：未提出第一版需求。
- 原生 App、完整離線建頁／上傳、完整歷史版本時間軸與即時游標展示：尚未納入。
- 整篇 JSON 人工衝突介面已由 Yjs 內文同步取代；世代不相容仍需人工選擇。

## OpenSpec 入口

- [變更說明](../openspec/changes/personal-notes-v1/proposal.md)
- [技術設計](../openspec/changes/personal-notes-v1/design.md)
- [後續任務](../openspec/changes/personal-notes-v1/tasks.md)
- [能力規格](../openspec/changes/personal-notes-v1/specs/)
- [TDD 與自動化驗證](automated-validation.md)

## 官方參考

來源支援技術方向，不能替代原型驗證與使用者決策。

- [React＋Vite](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/)
- [Better Auth magic link](https://better-auth.com/docs/plugins/magic-link)、[session 管理](https://better-auth.com/docs/concepts/session-management)
- [BlockNote Yjs](https://www.blocknotejs.org/docs/features/collaboration)
- [Yjs 更新](https://docs.yjs.dev/api/document-updates)、[離線編輯](https://docs.yjs.dev/getting-started/allowing-offline-editing)
- [y-partyserver](https://github.com/cloudflare/partykit/blob/main/packages/y-partyserver/README.md)
- [DO SQLite 儲存與復原](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)、[D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- [Cloudflare Email Service](https://developers.cloudflare.com/email-service/)
