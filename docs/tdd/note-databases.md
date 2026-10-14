# Notion 式筆記資料庫驗收

change：notion-like-note-databases。規格提交 2e1d9dd，更新設計與前五項任務進度提交 a8cbbaf。

## TDD

- [初始 Red](db-red.log)：10 個情境因缺少建立入口／資料庫 API 而失敗。
- [第一輪 Green](db-green-first.log)：8 個通過，兩個失敗來自測試標籤未使用 exact 與舊備份 API 預期狀態碼寫錯；後續修正測試，保留原紀錄。
- [舊世代設定 Red](db-red-config-generation.log)：舊世代設定原本回 200，新增世代核對後拒絕。
- [表格標題 Red](db-red-title-cell.log)：補上直接編輯筆記名稱的入口。
- [還原後重開 Red](db-red-database-reopen.log)：資料庫容器誤用正文快取路徑，改為直接讀取 metadata；筆記正文保留原世代隔離。
- [中間結果](db-green.log)、[完整欄位結果](db-green-final.log)保留轉場／快取隔離測試問題的失敗紀錄。375px 幾何斷言先等待對話框轉場完成；新 context 只複製 cookie，不能複製舊正文 metadata 快取冒充全新載入。
- [Refactor](db-refactor.log)：DB-01～10 的 Chromium 桌面全部通過。各情境涵蓋建立／移動、垃圾桶、自訂欄位、無效值、檢視、併發／失敗、權限／離線、手機鍵盤、完整 ZIP 及新舊備份。

## 發布限制

本次欄位與檢視採連線 HTTP 保存，正文沿用離線及即時同步。型別變更與使用中選項移除會拒絕；刪欄位／移出筆記保留原 ID 值。未包含看板、日曆、內嵌／連結檢視、公式或關聯；不宣稱多人協作、長期負載與實際郵件寄信重新驗證。

## 最終自動化驗收

- [完整三瀏覽器回歸](db-full-e2e.log)：321 項執行，318 項通過；失敗為手機／WebKit 的 DB-05 大型案例 20 秒總時間上限，以及 WebKit 的 DB-06 故障注入未被 page.route 攔截。
- [測試邊界修正](db-refactor-test-harness.log)：DB-05 保留每個斷言的原等待上限，僅將整個多次重開案例的總時間設為 60 秒；DB-06 在頁面 fetch 邊界注入並斷言確實觸發失敗，保留 Service Worker／離線功能。
- [大型中文請求 Red](db-red-request-limit.log) → [Green](db-green-request-limit.log)：一般表單 4 KiB 不能承載宣告的 50 欄位及中文值；資料庫設定／屬性獨立限制請求大小，其他表單預設不變。
- [最終資料庫三瀏覽器](db-three-browser-final.log)：33 個全部通過；[情境覆蓋](db-coverage.log)：DB-01～10 每個瀏覽器必需結果共 30 個全數通過，額外的大型中文案例三個也通過。
- [可追溯結果彙整](db-acceptance.json)：既有 291 項由完整回歸通過，新資料庫 33 項由最終針對性重跑通過，共 324 個唯一案例全數驗證。此為跨執行來源彙整，不宣稱單次完整 324 項全綠。
- [Workers 最終回歸](db-integration-final.log)：104 個通過；[單元](db-unit.log)：6 個通過；[型別](db-check.log)、[文件契約](db-spec-check.log)通過。
- [真實 dist／HTTPS smoke](db-build-smoke.log)：2 個通過，包含登入、wss 保存、離線刷新與分析 POST 不阻擋啟動。

## 正式發布

[正式遷移](db-production-migrations.log)與[預檢](db-production-dry-run.log)成功，[發布版本](db-production-deploy.log)為 362deed1-59fd-42c8-8942-eb371297ada4。[正式 API 與瀏覽器驗證](db-production-results.json)全部通過，含版本一致、建立／欄位值、清單篩選、完整正文及全新 context 讀取；測試資料庫已移入垃圾桶、臨時 session 已刪除。此輪使用短期管理 session，未重新驗證實際寄信。
