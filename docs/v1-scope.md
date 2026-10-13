# 第一版需求、技術決策與待確認事項

整理日期：2026-10-13（Asia/Taipei）。

狀態：討論整理與 OpenSpec 草案。已授權依新 AGENTS.md 更新規格、採 TDD 與全自動驗證並提交文件；尚未授權應用程式、測試程式或原型實作、部署或建立雲端資源。文件完整或驗證通過只表示規格格式齊備。

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
| React＋Vite | 已選定；TypeScript 為開發語言提案 |
| BlockNote | 優先評估，尚未完成手機、中文輸入與同步驗證 |
| Better Auth＋magic link | 已選定方向，不使用 Cloudflare Access |
| Yjs | 已納入第一版，不再以整篇 JSON 版本衝突作為內文同步主方案 |
| Durable Objects＋y-partyserver | 已選定同步後端方向，持久化掛鉤與確認訊息仍待驗證 |
| Cloudflare | 專案要求優先使用 Cloudflare，以 Workers Paid plan 為前提 |
| 開發與驗收 | 依新 AGENTS.md 使用 TDD、全自動驗收、規格修改及開發完成後自動提交 |

## 操作流程提案

以下是已討論的草案，尚未全部逐項確認。

1. 首次登入後開今天的日記；重新登入後回到原本編輯的頁面。
2. 電腦使用左側導覽與右側編輯區；手機優先呈現內容，從選單開啟導覽。
3. 筆記頁面能寫內容，也能包含子頁面；以路徑導覽返回上層。
4. 日記以日期入口與月份列表瀏覽，日記日期獨立於建立時間。
5. 電腦提供 `/` 選單與區塊拖曳；手機必要操作都有可點選入口。
6. 區塊候選：段落、標題、項目／編號清單、待辦、引用、分隔線、圖片、程式碼；文字格式候選為粗體、斜體、連結。
7. 提供搜尋與垃圾桶還原；暫不規劃永久刪除與自動圖片清理。

## 儲存與同步提案

| 位置 | 建議責任 |
| --- | --- |
| D1 | Better Auth 資料、頁面擁有者／階層／日期／垃圾桶，以及可重建的搜尋資料 |
| 每頁的 SQLite-backed Durable Object | Yjs 原始狀態、更新紀錄、持久保存檢查點與房間狀態 |
| 私有 R2 | 不覆寫的圖片原檔，使用穩定識別 |
| IndexedDB＋y-indexeddb | 原裝置 Yjs 狀態、離線快取與尚未確認的提交 |
| 獨立私有 R2 備份區 | 備份清單、Yjs 狀態、產品資料與圖片副本 |

- Yjs 二進位狀態是內文原始資料；BlockNote JSON、摘要與搜尋文字是匯出或衍生資料。
- 寫入提案是「驗證 → 持久保存 → 回覆提交確認 → 廣播」；連線或 provider 已同步不等於已保存。
- 不將整篇版本號衝突與 Yjs 同時設為內文的兩個寫入來源；階層、日期與垃圾桶仍需後端規則。
- 離線提案限於已下載頁面內文；新增頁面、標題／階層異動與圖片上傳先要求連線。
- 一般重連合併同世代更新；刪除、還原或權限失效時先停止寫入。

## 備份與還原提案

- 保留期已確認為 90 天。頻率提案為每日一次，排程時間與時區待確認；尚未建立排程。
- 完整備份包含頁面／階層／日記日期／垃圾桶／圖片資料、每篇 Yjs 狀態與引用圖片。
- 清單記錄格式版本、穩定擁有者 ID、世代、檢查點、擷取時間與校驗值。
- 所有必要檔案驗證完整後才標記成功；保留中備份引用的圖片不可清理。
- 提案是固定階層與頁面清單、逐篇擷取，記錄時間窗；不承諾整站同一瞬間快照。
- session、magic link 憑證與服務密鑰不納入可還原的產品匯出；擁有者 ID 必須正確映射。
- 還原前備份現況、暫停受影響寫入、以新世代恢復；舊裝置修改供檢視或另存，不自動合併。
- 提供手動完整匯出到自己的裝置，形式待確認。同 Cloudflare 帳號內的備份不是帳號之外的副本。

## 待確認事項

此表是單一決策清單。Q 是產品／部署輸入，不是人工驗收；決策記錄由機器檢查值域與規格一致性。V 全部使用自動化測試，不要求人工收信、實機操作或目視判斷；本次仍未執行原型或實作。

| 編號 | 待確認／驗證內容 | 目前提案與影響 |
| --- | --- | --- |
| Q1 | 30 天 session 固定到期或隨使用續期？ | 固定 30 天為提案；影響登入驗收與設定 |
| Q2 | 接受伺服器可讀內容，或要求端對端加密？ | 尚未定案；改變同步、搜尋、金鑰與備份，實作前必須決定 |
| Q3 | 允許登入 Email、網站網址與寄件網域／寄信服務 | 僅允許指定擁有者 Email，先評估 Cloudflare Email Service；密鑰不寫入文件 |
| Q4 | magic link 有效期、重新寄送與頻率限制 | 單次使用、有效 10 分鐘為提案；頻率數值未定 |
| Q5 | 離線操作範圍；標題是否也要即時／離線編輯？ | 已下載內文可離線，標題先留 D1，結構／上傳要求連線；影響同步來源與佇列範圍 |
| Q6 | 基本區塊、搜尋與垃圾桶是否納入第一版？ | 採用上述流程為提案；圖片與程式碼已確認 |
| Q7 | 圖片格式、大小上限與是否壓縮 | 先保留原圖並限制格式／大小，手機照片格式待評估 |
| Q8 | 備份頻率／時間／時區、時間窗一致性與匯出／還原介面 | 每日一次、保留 90 天、逐篇擷取為提案；暫不做版本時間軸 |
| Q9 | 日記時區、同日期垃圾桶日記與父子頁面還原規則 | 今天用 Asia/Taipei、同日期先還原、上層刪除隱藏子樹為提案 |
| V1 | BlockNote 中文 composition、手機模擬觸控／選取／區塊移動、圖片與程式碼 | Playwright 程式斷言通過才視為編輯器定案；原生 OS 行為限制見自動化計畫 |
| V2 | y-partyserver 廣播前保存、提交確認、休眠／重啟與快照整理 | Workers 整合故障注入／eviction／abort 測試；不能只依 state vector 判斷刪除已保存 |
| V3 | D1／DO 刪除、還原、世代切換中斷後恢復 | Workers 整合測試逐階段注入失敗，斷言可重試與停止舊房間寫入 |
| V4 | 備份依賴、校驗、90 天清理與完整恢復 | 自動匯出到乾淨測試儲存並比較資料／雜湊；以可控時鐘測保留邊界 |

## TDD 與自動化驗證

已要求採用 Red → Green → Refactor；每個行為先證明正確原因的測試失敗，再最小實作與重構，保存機器報告。全部 47 個情境均有唯一驗證 ID 與自動化方法；產品測試尚未實作或執行。

工具方向為 Vitest、Cloudflare 官方 Workers 整合及 Playwright。人工檢視、實際手機操作、人工收信與手動還原都不作為驗收門檻；手機模擬與中文事件的覆蓋限制明確記錄，不能宣稱等於原生 OS 輸入法。

詳細契約見 [自動化驗證計畫](automated-validation.md)。規格修改後與完成開發後各自自動提交相關檔案；本次僅提交指示與規格文件。

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
