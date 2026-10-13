# 完整 ZIP 匯出

設定頁可建立備份並下載保留期內的成功備份。下載 GET 每次驗證 session／owner／保留期、清單版本／欄位／階層／日期／檔名與副本 SHA-256；拒絕路徑穿越、重複 ID、循環、外人資料及額外憑證欄位。建立時也校驗 metadata，避免發布無法讀取的成功目錄。

使用固定 `@zip.js/zip.js` 2.23.0，原檔以 STORE／Zip64 寫出，不壓縮或修改內容。下載前逐檔校驗，串流時再驗證，僅保留當前檔案，不把整站 ZIP 轉成 Blob。正式 Worker 與測試入口傳入 ExecutionContext，透過 waitUntil 追蹤輸出；中途失效會令串流失敗，不關閉成可解析的部分 ZIP。

清單包含擁有者 ID、階層／日記／垃圾桶 metadata、世代、持久 checkpoint／擷取時間窗、成功時間及正文／圖片大小與校驗值；登入資料與密鑰不匯出。設定頁切換先完成本機保存，編輯器保持掛載並隱藏，持續保存遠端更新；載入或建立失敗會顯示一般錯誤。

| 行為 | Red | Green／Refactor |
| --- | --- | --- |
| API 入口／權限／清單安全 | [三個 API Red](tdd/red-backup-export.log) | [15 個相關 Workers 結果](tdd/green-backup-export.log) |
| 建立時 metadata 校驗 | [錯誤成功發布 Red](tdd/red-backup-metadata.log) | [相關 Workers](tdd/green-backup-export.log) |
| 設定頁與真實下載 | [三種瀏覽器缺少入口](tdd/red-backup-settings.log)、[grid 覆蓋 hidden](tdd/red-backup-settings-hidden.log) | [三種瀏覽器 Green](tdd/green-backup-settings.log) |

完整 [Workers 75 個結果](tdd/refactor-backup-export-integration.log) 與 [瀏覽器 129 個結果](tdd/refactor-backup-export-e2e.log) 通過，沒有重試或 skip。型別、[Vite build](tdd/backup-export-build.log)、[Worker dry-run](tdd/backup-export-worker-build.log)、文件契約與差異空白檢查通過。新增套件沒有其他依賴；未部署。

另以 [Python 標準庫檢查器](../scripts/check-backup-zip.py) 獨立解析三份瀏覽器下載，檢查 ZIP CRC、檔案集合／大小與 SHA-256，[3／3 通過](tdd/backup-export-independent.log)。可在完整 E2E 後重跑：

```sh
UV_CACHE_DIR=/tmp/p-note-uv-cache uv run --no-project python scripts/check-backup-zip.py
```

BACKUP-06 已通過指定環境；[完整產品追蹤](tdd/backup-export-product-pending.log) 仍為 108／129，剩 7 個情境、21 個必需結果。覆蓋還原、乾淨儲存恢復、舊世代檢視／另存與正式保存失敗 UI 仍需完成。不以此階段宣稱整版完成；尚未實跑超過 4 GiB 的匯出或部署後平台行為。

套件串流／Zip64 與 error 行為以 [官方 ZipWriter API](https://gildas-lormeau.github.io/zip.js/api/classes/ZipWriter.html) 及安裝版型別／程式碼為準。
