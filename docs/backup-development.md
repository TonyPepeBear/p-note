# 備份與還原開發進度

目前完成內部 `SyncRoom.capture`：排空已接受更新後，從 SQLite 持久快照與紀錄重建正文，回傳二進位 Yjs、檢查點、世代與擷取時間。擷取前後核對 D1 所有權／頁面／世代；同 owner 正在結構操作時拒絕。這個 RPC 只由 Worker binding 呼叫，沒有公開 HTTP 擷取端點。

有效 [Red](tdd/red-backup-capture.log) 是缺少擷取 RPC 的三個失敗；[Green](tdd/green-backup-capture.log) 四個案例驗證 abort 後持久正文、偽造 scope／舊世代拒絕、逐篇時間與尚未上雲內容排除，以及中途切世代／損毀紀錄拒絕。初次 Green 的 HTTP 拒絕碼預期誤寫 409，已依既有「沒有 page 參數 → 404」契約修正，不列產品 Red。RPC 拒絕測試以 async 等待，避免測試器對原生 RPC thenable 產生未處理錯誤。

完整 [Workers 回歸](tdd/refactor-backup-capture-integration.log) 60 個結果通過；型別、文件契約與差異空白檢查通過。擷取失敗不回傳空文件，也不改原紀錄。測試使用真實本機 D1／SQLite 與 WebSocket、持久故障注入，沒有雲端資料異動。

這些擷取子案例不能代替 BACKUP-01～09 完整驗收。後續目錄實作見下節；ZIP 匯出、覆蓋還原協調及世代檢視／另存仍未完成，相關 OpenSpec 任務保持未勾選。未部署。

## 私有備份目錄與 90 天清理

新增 [0003 migration](../migrations/0003.sql) 與獨立 `BACKUPS` R2，僅套用本機隔離環境。POST `/api/backups` 建立，GET 同路徑列出狀態與 latest，GET `/api/backups/:id/manifest` 只讀保留期內同 owner 的成功備份。每次備份保存固定頁面 metadata、各篇持久正文、所有已登記原圖、大小與 SHA-256；不匯出登入資料或密鑰。

目錄先記 pending，原圖／副本／清單讀寫及校驗失敗記 failed。成功發布的同一個 D1 SQL 條件重新驗證所有頁面世代與結構操作，不讓 R2 清單寫入期間的世代競爭漏過。成功時間取全部 R2 校驗完成後，封存清單先記擷取時間窗，下載清單再由目錄加入成功時間。failed／pending 不取代 latest success。

每日 UTC `0 19 * * *`（台北 03:00）由持久擁有者帳號執行，不依賴會到期的 session。成功時間滿 90×24 小時到期；清理先記 expiring，拒絕下載半套資料，刪該備份前綴後才移除目錄。中斷可重試；不同備份各有原圖副本，活躍 ASSETS 原檔不永久清理。

| 驗證 | 證據 |
| --- | --- |
| 尚無建立 API 的五個有效失敗 | [目錄 Red](tdd/red-backup-catalog.log) |
| 原子發布競爭與成功時間提早的兩個有效失敗 | [發布 Red](tdd/red-backup-publish.log) |
| 固定備份 API 前基線補取時間窗與圖片清理失敗 | [時間窗／ASSET-05 Red](tdd/red-backup-assets-window.log) |
| 正文／圖片／副本／清單故障，世代競爭、憑證排除、權限、排程、90 天邊界、時間窗與 ASSET-05 | [Green 10 個案例](tdd/green-backup-catalog.log) |
| 相關全部 Workers | [Refactor 70 個結果](tdd/refactor-backup-catalog-integration.log) |

初次用 mock 替換 RPC 方法時，測試 runtime 拒絕該 RPC，不能當成中途世代切換證據。已改用真正 SQLite 損毀與 R2 寫入邊界，並明確斷言世代真的改變。發布 Red 的篩選執行只計兩個有效失敗，其他未執行案例不算通過。BACKUP-05／ASSET-05 先補充資料回歸，再於固定 `8e12e32` 應用入口基線補取兩個 API 404 的有效 Red，finally 還原目前程式；沒有把此子範圍冒充已完成所有備份 Red 任務。

完整 [瀏覽器回歸](tdd/refactor-backup-catalog-e2e.log) 126 個結果通過；[Vite build](tdd/backup-catalog-build.log) 與 [Worker dry-run](tdd/backup-catalog-worker-build.log) 通過，只有本機打包。清理故障亦以 abort 後重試驗證持久意圖。

[完整產品追蹤](tdd/backup-catalog-product-pending.log) 為 104／129，仍退出 1：剩 BACKUP-01、06～09 與 SYNC-03 的 UI、SYNC-10～11，共 8 個情境、25 個必需結果；不以此階段宣稱整版完成。

待完成 ZIP 串流匯出、完整清單／路徑驗證、覆蓋還原、索引重建及舊裝置檢視／另存，才勾選完整 7.1～7.3 與 V3／V4。應用設定仍使用本機 placeholder 資源 ID；沒有建立雲端 bucket、套用雲端 migration 或部署。
