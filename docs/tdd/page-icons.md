# 頁面 emoji 圖示驗證

使用 OpenSpec `add-page-emoji-icons`，情境為 ICON-01～ICON-04。所有登入與筆記內容皆使用測試資料；本文件只保存必要斷言與結果，不提交登入連結、憑證或原始平台回應。

## Red

- 新增 `tests/workers/page-icons.test.ts` 後先執行：原有回應沒有 icon、`/icon` 路由不存在、MCP 缺少 `set_page_icon`，6 項均依功能缺失失敗。
- 備份 schema 測試先確認：合法 `👩🏽‍💻` 會被原 manifest validator 拒絕。
- 在功能加入前的獨立 checkout 執行 Chromium 桌面 ICON-01：標題上方沒有「新增圖示」按鈕，斷言失敗。依賴、瀏覽器下載或建置設定錯誤不計為 Red。
- 整合主分支資料庫條件讀取後，新增 ETag 回歸：直接更新資料庫／子列 icon 時原 trigger 回傳 304，預期 200，據此在 `0012_page_icons.sql` 納入 icon 變更。
- 完整回歸的 UX-07 抓到動態註冊 ProseMirror 外掛會銷毀既有 Yjs UndoManager：刪除區塊後無法復原。圖示裝飾改在編輯器建立時注入，資料／portal 更新不重設外掛，純圖示更新也不發送編輯交易；相關桌面驗證 8／8 通過。
- 補測未開過的連結目標：切到離線後，原圖示 widget 消失，禁用按鈕斷言找不到元素而 Red。保留已讀的記憶體 metadata 後 Green 1／1，圖示可見且禁用、正文相同、目標仍未寫入下載快取。

## Green 與回歸

相關桌面循環命令：`npm run test:e2e:fast -- tests/e2e/page-icons.spec.ts`，6／6 通過，背景圖示更新保留標題草稿另 1／1 通過。涵蓋鍵盤／觸控入口、常用及自訂 emoji、移除、輸入錯誤、側欄、行內連結、連結選單、反向連結、兩種資料庫檢視、雙分頁、離線快取、寫入失敗、延遲回應與還原換世代。

API／MCP／資料庫條件讀取回歸 `npm run test:integration -- tests/workers/page-icons.test.ts tests/workers/databases.test.ts`，16／16 通過。備份與還原相關回歸 33／33 通過，包含 manifest、ZIP、舊備份缺 icon、無效 icon 不覆蓋現況、回復備份及垃圾桶還原。

圖示由 ProseMirror 裝飾顯示，E2E 比對更新圖示前後的 BlockNote JSON 完全相同。metadata_revision 與 sync_generation 防止延遲回應蓋回較新圖示；資料庫輪詢沿用 ETag、草稿保護及隱藏分頁暫停機制。

整合最新頁面選單、圖片瀏覽及版本歷史後，全量單元測試 11／11、Workers 整合測試 149／149 通過。新增歷史交互驗證：單頁歷史還原保留目前 emoji、移除後不復活、相同請求重送、整站還原後的歷史可用，以及還原中斷期間登入／API key／MCP 均不能改圖示。

後端驗收命令為 `npm run test:integration -- --testTimeout=30000`。早期與瀏覽器並行時，大型圖片案例曾超過 10 秒；停止瀏覽器後重跑，該案例在 6.8 秒完成，全量 149 項通過。正式建置及 HTTPS Worker smoke 2／2 通過，包含登入、wss 持久保存與離線刷新。型別、正式設定與規格契約檢查通過。

曾啟動全套產品 E2E，但在整合主分支及修正測試等待條件時中止；中止結果不列為驗收通過。最終以 Chromium 桌面、Chromium 手機及 WebKit 手機驗證本次範圍：圖示、連結、頁面選單、資料庫條件讀取／寫入失敗、版本歷史、區塊復原、首次下載、圖片、整站還原、重連與 MCP HTTP 往返。

較大範圍三瀏覽器回歸 135 項中 130 項通過。其餘為手機換頁後抽屜被關閉的既有測試競爭、WebKit 第二 context 首次載入等待，以及三個 WebKit service worker 使 `page.route` 故障注入未生效的案例。最後整合上游新頁就緒等待，並以 fetch 邊界注入 503、真實已寫入回應的延遲釋放，以及新世代／較低 revision 的列表，確保三種瀏覽器都真的執行相同故障情境。

測試等待修正僅區分首次就緒與儲存、避免誤讀還原前隱藏的編輯器，以及避免自動重連成功後等待已消失的重試按鈕。清空儲存的冪等測試請求僅在連線重設時重送。最終使用 1 個 worker 避免四核心環境內多個 WebKit 頁面爭用資源；多步流程上限最多 45 秒，原有保存、內容、12 秒 metadata 及 500 毫秒切頁斷言維持原值。

最終三瀏覽器驗收 54／54 通過（每種瀏覽器各 18 項），包含全部 8 個圖示案例、最新頂端新增選單及其側欄／手機整合、子資料庫換頁與雙端離線重連。前輪五個失敗情境皆於本輪重驗通過；圖示規格覆蓋 11／11 個必要結果通過。
