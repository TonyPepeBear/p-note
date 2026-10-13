# 覆蓋還原與本機草稿

設定頁可選擇成功備份，勾選覆蓋確認後還原。先校驗整份備份，保存操作意圖並排空舊房間，再備份暫停後的雲端現況；現況備份成功前不切換正式頁面。準備新世代正文及操作專屬圖片副本後，以單一 D1 batch 切換頁面、階層、日期、垃圾桶與圖片索引，重建搜尋並解除新房間。舊房間保持停止，原圖不永久清理。

中斷時私人頁面入口拒絕存取部分資料。設定頁顯示未完成操作，重試同一備份與請求識別；D1 保存階段與固定世代清單，服務重啟後繼續。被操作引用的備份暫時不清理，完成後恢復 90 天規則。請求成功但回應遺失時，同一識別只回傳先前結果，不再覆蓋後續修改。此紀錄保留 90 天。

還原完成後，操作分頁明確載入目前版本。其他舊裝置重連或刷新時，以擁有者、頁面與世代隔離本機草稿；可按「檢視本機草稿」唯讀查看，或「另存為筆記」。另存先保存本機內容與新房間正文，再發布新的根筆記，不復活原頁，也不另建同日期日記。被刪除頁面仍可選擇還原原頁；換世代後可選擇載入目前版本。登入到期仍須重新登入，不能用本機資訊繞過所有權。

產品還原保留既有 user／session／account／verification 狀態，備份不含登入憑證。0004 migration 與 RESTORES binding 僅套用隔離本機環境；沒有套用雲端 migration、建立資源、實際寄信或部署。

| 行為 | Red | Green／回歸 |
| --- | --- | --- |
| 完整還原／乾淨產品儲存／中斷重試／舊房間拒絕 | [還原缺失](tdd/red-restore.log) | [還原後端](tdd/green-restore.log)、[全套 Workers](tdd/refactor-restore-recovery-integration.log) |
| 清理與還原引用競爭 | [清理競爭](tdd/red-restore-pin.log) | 同上 |
| 已完成請求重送不能覆蓋新修改 | [重送](tdd/red-restore-idempotent.log) | 同上，含 abort 後重送 |
| 設定頁覆蓋還原 | [介面缺失](tdd/red-restore-settings.log) | [三種瀏覽器](tdd/green-restore-settings.log) |
| 舊草稿唯讀檢視／刷新／另存 | [介面缺失](tdd/red-recovery.log)、[另存 API 缺失](tdd/red-fork.log) | [另存後端](tdd/green-fork.log)、[三種瀏覽器](tdd/green-recovery-ui.log) |

Workers 87 個結果通過；還原／草稿相關瀏覽器 15 個結果通過，沒有 skip。故障注入涵蓋暫停、準備、原子切換、解除、SQL batch 回滾、損毀檔案及發布失敗。乾淨儲存案例清空 D1 產品資料、舊 DO SQLite 與 ASSETS，只保留獨立 BACKUPS，恢復後比對 metadata、二進位正文、圖片雜湊及索引；另存後重啟仍保留正文。

初次草稿介面 Red 的測試請求缺 Origin，被 403 拒絕，不算功能 Red；補齊合法來源後留下缺少檢視按鈕的有效失敗。初次 Green 把同一 context 的新分頁當成沒有舊快取的裝置，正確被隔離；改用只有 session cookie、沒有 localStorage 的新 context 後通過。正式手機／中文測試仍為自動化模擬，不宣稱原生 OS 或已部署 Cloudflare 驗證。

完整部署前目標尚未完成：正式雲端保存故障 UI、自動整理／正文邊界及正式靜態資源整合仍待驗證；最終全套回歸與 47 個情境追蹤依 OpenSpec 任務完成。

本輪最終 [全套瀏覽器回歸](tdd/refactor-restore-recovery-e2e.log) 141／141 通過，與單元／Workers 合計 [233 個結果](tdd/restore-recovery-results.json)。[獨立 ZIP 校驗](tdd/restore-recovery-zip.log) 3／3；型別、Vite build、Worker dry-run、文件契約、OpenSpec 嚴格驗證與差異空白檢查通過。[完整追蹤](tdd/restore-recovery-product-pending.log) 126／129，退出碼 1 表示 SYNC-03 的三個瀏覽器案例仍缺漏，不以整批測試成功代替完整產品驗收。

補充邊界驗證：[目標備份到期後重送](tdd/red-restore-expired-ack.log) 的有效 Red 是 404；完成結果查詢先於目標檔案驗證後，全部 Workers 回歸通過，確認不再切換世代。[登入到期退步](tdd/red-restore-auth-regression.log) 曾隱藏草稿，修正為保留唯讀編輯器後 [三個瀏覽器通過](tdd/green-restore-auth-regression.log)。

[頁面鍵盤 fixture](tdd/restore-recovery-navigation-fixture.log) 曾在標題儲存尚未完成、按鈕停用時送 Enter，焦點留在 summary 並收合操作區；這不是缺失功能的 Red。改為等待按鈕可用，三個瀏覽器各重跑三次，[9／9 通過](tdd/restore-recovery-navigation-green.log)。未增加 timeout 或重試掩蓋失敗。
