# 備份與還原開發進度

目前完成內部 `SyncRoom.capture`：排空已接受更新後，從 SQLite 持久快照與紀錄重建正文，回傳二進位 Yjs、檢查點、世代與擷取時間。擷取前後核對 D1 所有權／頁面／世代；同 owner 正在結構操作時拒絕。這個 RPC 只由 Worker binding 呼叫，沒有公開 HTTP 擷取端點。

有效 [Red](tdd/red-backup-capture.log) 是缺少擷取 RPC 的三個失敗；[Green](tdd/green-backup-capture.log) 四個案例驗證 abort 後持久正文、偽造 scope／舊世代拒絕、逐篇時間與尚未上雲內容排除，以及中途切世代／損毀紀錄拒絕。初次 Green 的 HTTP 拒絕碼預期誤寫 409，已依既有「沒有 page 參數 → 404」契約修正，不列產品 Red。RPC 拒絕測試以 async 等待，避免測試器對原生 RPC thenable 產生未處理錯誤。

完整 [Workers 回歸](tdd/refactor-backup-capture-integration.log) 60 個結果通過；型別、文件契約與差異空白檢查通過。擷取失敗不回傳空文件，也不改原紀錄。測試使用真實本機 D1／SQLite 與 WebSocket、持久故障注入，沒有雲端資料異動。

這些是備份的內部子案例，不能代替 BACKUP-01～09 完整驗收。目前尚未完成成功清單、私有備份 R2、ZIP 匯出、90 天清理、覆蓋還原協調及世代檢視／另存；相關 OpenSpec 任務保持未勾選。未部署。
