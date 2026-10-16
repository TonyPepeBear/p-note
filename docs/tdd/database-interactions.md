# 資料庫操作改善驗收

## 範圍

本次對應 14 項資料庫介面改善：即時篩選／排序與 chip、欄標題選單、原地新增、彩色選項 Combobox、Switch／拖曳欄位、持久欄寬、內建日期篩選、精簡日期、清單屬性標籤、自動換行、固定表頭／標題欄、cell 保存狀態、分頁管理及列／批次操作。

新增 `DB-13`～`DB-16` 驗收情境，補充 `DB-15` 的單元及 `DB-16` 的 Workers 正文複製驗證。舊設定的顏色、寬度及換行欄位可省略，無 SQL migration。

## Red

在獨立 `/tmp` worktree 對實作前版本執行同一份新增測試：

- Chromium 4 項失敗：篩選尚未儲存而沒有即時變化、缺少新增列按鈕、日期輸入仍為文字、缺少列選單。
- 單元 2 項失敗：內建時間型別仍為 number、新設定被 validConfig 拒絕。

初次環境失敗（套件、瀏覽器及函式庫缺漏）不計作產品 Red。依鎖定檔 npm ci、下載鎖定版 Playwright 瀏覽器；WebKit 需要的 Debian 函式庫解壓於 /tmp，置入該瀏覽器的私有 sys/lib。實際 WebKit 啟動及 DOM 讀取成功後，使用 PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 略過只檢查系統 ldconfig、無法辨識私有函式庫的預檢；沒有略過產品測試或斷言。

## Green 與修正

- 13 個單元測試通過，含台北 16:00 UTC 日界、四種日期條件及寬度／顏色／換行驗證。
- 177 個 Workers 整合測試通過，包含複製已保存 Yjs 正文、圖示、屬性與獨立世代，以及未登入、舊世代、垃圾桶拒絕。
- 瀏覽器驗收使用真實 HTTPS 測試 Worker 與持久資料，涵蓋新功能、既有資料庫、圖示及資料庫鍵盤導覽。
- 修正受控 Popover 的按鈕事件、分頁包裝後的方向鍵焦點範圍。
- 測試以確切標籤與指定選單操作，避免命中同欄位的新增控制及退場選單；重開前等待伺服器確認設定。
- WebKit 拖曳事件診斷確認退場中的 Popover 曾覆蓋把手；改為斷言選單已隱藏並透過 hover 等待把手可接收事件，不加入固定等待時間。
- 故障注入改在 fetch 邊界，避免 WebKit Service Worker 使 page.route 無法穩定攔截；必須斷言已觸發失敗請求，再恢復及重試。

最終單次三瀏覽器驗收 120／120 通過（各 40 項，無 skip／retry／flaky），HTTPS 建置 smoke 2／2 通過。型別、文件契約及正式設定通過；資料庫情境覆蓋完整。結果彙整見 [機器結果](database-interactions-results.json)。本次驗收聚焦上述四個相關 spec，沒有宣稱全站 687 個瀏覽器案例重新執行。

## 發布

沿用 master 的 GitHub Actions 正式部署。合併前封存 OpenSpec 並同步主規格；確認 workflow 的資料遷移與發布結果，不另作正式網站 HTTP 探測。
