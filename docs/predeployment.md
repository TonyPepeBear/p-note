# 部署前完成與驗證

本輪維持第一版 47 個情境範圍，完成本機產品與建置整合。沒有部署、建立雲端資源、套用雲端 migration、寄送真實郵件或封存 OpenSpec。

| 需求 | 自動化證據 |
| --- | --- |
| AUTH-01～08：單一擁有者、連結／30 天固定到期、所有權與撤銷 | [Workers](tdd/final-integration.log)、[瀏覽器](tdd/final-e2e.log) |
| PAGE-01～08：日期、唯一性、階層、垃圾桶、搜尋與實際更新時間 | 同上；[修改時間 Red](tdd/red-body-updated-time.log) |
| EDIT-01～05：基本區塊、程式碼、圖片、觸控／鍵盤與中文 | [瀏覽器](tdd/final-e2e.log)；[複製狀態 Red](tdd/red-copy-feedback.log)、[Green](tdd/green-copy-feedback.log) |
| SYNC-01～12：確認、故障、離線與世代隔離 | [Workers](tdd/final-integration.log)、[瀏覽器](tdd/final-e2e.log)、[SQLite 故障 UI](tdd/formal-save-failure-ui.log) |
| ASSET-01～05：原檔、格式／大小、權限與備份引用 | [Workers](tdd/final-integration.log)、[瀏覽器](tdd/final-e2e.log) |
| BACKUP-01～09：90 天、完整 ZIP、時間窗、覆蓋還原與舊裝置 | 同上；[還原 TDD](restore-development.md) |
| 真實 dist、HTTPS／wss 與離線刷新 | [建置 Red](tdd/red-build-smoke.log)、[最終建置驗證](tdd/final-build-smoke.log) |
| 快照自動整理、abort 與故障重試 | [Red](tdd/red-auto-compaction.log)、[Green／量測](tdd/green-auto-compaction.log)、[全部 Workers](tdd/final-integration.log) |

最新單元 5、Workers 92、桌面／手機瀏覽器 150、建置 smoke 1，共 248 個結果通過，無 skip。完整產品 [追蹤](tdd/final-product-coverage.log) 為 129／129；不以原型前綴或額外案例代替正式情境。

V3 的階段證據涵蓋頁面暫停／解除與還原暫停／準備／切換／解除；中斷保存意圖、阻擋正式讀寫，abort 後同操作可重試。有效 Red 見 [頁面中斷](tdd/red-pages-boundaries.log)、[還原缺失](tdd/red-restore.log) 與 [舊草稿入口](tdd/red-recovery.log)；Green 在各中斷階段檢查舊連線關閉及原持久正文不變。先前已實作的 SYNC-03 UI 直接通過，沒有偽造 Red。

自動整理門檻為 64 筆或 2 MiB；量測 63 筆為 761,202 bytes，快照為 12,146 bytes。整理與更新共用序列，從持久紀錄重建，快照／清理同一交易；整理失敗不發出新的保存失敗訊息。正文修改時間與更新同一 SQLite 交易，重送不改時間，D1 失去更新時間後可於重啟重建。

本機舊版本只保留裝置上的隔離草稿。載入目前版本後仍可檢視／另存舊草稿；不提供雲端版本時間軸。原圖與未引用物件不永久清理。

## 可重複的驗證

依 [README](../README.md) 依序執行完整測試、建置 smoke、情境追蹤、型別、文件契約、OpenSpec 嚴格驗證與 git diff --check。`test:build` 需要 OpenSSL，會建立並清理臨時憑證；smoke 使用獨立輸出目錄，不清除主套件 ZIP 產物。Python 獨立 ZIP 檢查以 `uv run --no-project python scripts/check-backup-zip.py` 執行。

先前中斷留下的服務已依日誌 PID 停止；WebKit 的 [乾淨重驗](tdd/webkit-recovery-recheck.log) 9／9 通過，最終全套亦通過。Workers 曾在跨檔案並行執行時出現 10 MiB 案例逾時，改為檔案依序執行，各案例內的併發斷言仍保留；沒有增加 timeout 或設定重試掩蓋失敗。

## 發布設定與界線

私人值只在 git 忽略的 `.dev.vars.release`／`.env.release`，權限 0600；[格式檢查](tdd/final-private-config.log) 不輸出值。寄件網域的唯讀確認與原生 adapter 見 [寄信開發](mail-development.md)。密鑰尚未上傳。

`wrangler.app.jsonc` 是應用範本：STATIC 提供 dist，ASSETS／BACKUPS 為不同私有 R2，DB 是 D1，SYNC／RESTORES 為 SQLite DO，cron 為台北 03:00。資源名稱與 D1 ID 仍是本機 placeholder；正式資源佈建與套用 migration／secrets／網站路由屬後續部署工作。框架型別由 Wrangler 產生，不手寫 Env。

每筆 Yjs 更新目前上限 512 KiB；超限拒絕、不確認且保留本機內容。圖片上限 10 MiB。手機、輸入法與軟鍵盤仍為自動化事件／viewport 模擬；HTTPS smoke 忽略本機自簽憑證驗證，不宣稱正式 TLS、實機輸入法、實際郵件送達或已部署 Cloudflare 的長期運作。

最終 [型別](tdd/final-types.log)、[文件契約](tdd/final-contract.log)、[OpenSpec 嚴格驗證](tdd/final-openspec.log)、[Worker dry-run](tdd/final-worker-build.log) 與 [獨立 ZIP](tdd/final-zip.log) 通過。此機器的 shell PATH 曾找不到 OpenSpec，改用既有安裝的絕對路徑執行，沒有重新安裝。重跑時需先確認 OpenSpec CLI 在 PATH。
