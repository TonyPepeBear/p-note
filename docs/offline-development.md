# 正式離線與重連

完成 OpenSpec 6.1／6.2。正文仍以 owner／page／generation 雜湊隔離的 IndexedDB 保存，localStorage 只存已驗證頁面資訊。未下載正文、損毀索引及明確 401／403／404／409 不冒充可用快取。暫時網路／API 故障時，已下載頁面仍可書寫，雲端狀態不能顯示已保存。

正式同步停用 provider 未重驗的自動重連；以 1 秒起、最長 30 秒退避重新查詢權限後連線。網路恢復、前景與重試按鈕沿用同一流程。本機保存與持久 ACK 保持分離；重新登入仍回原頁及同世代草稿。

Service Worker 在首次準備完成前快取已載入的同源公開啟動資源，排除 API、登入連結、同步及測試入口。私人圖片不進公開 shell 快取。快取清單與保存失敗會回報錯誤。

| 行為 | Red | Green／Refactor |
| --- | --- | --- |
| 正式雙端、離線刷新、未下載與跨分頁 | [正式離線 Red](tdd/red-formal-offline.log) | [Green 12 個結果](tdd/green-formal-offline.log) |
| API 503 快取啟動 | [重連 Red](tdd/red-formal-reconnect.log) | [Green 24 個結果](tdd/green-formal-reconnect.log) |
| 實際 1012 斷線後權限重驗 | [關閉 Red](tdd/red-formal-close.log) | [Green](tdd/green-formal-reconnect.log) |
| 索引缺漏、損毀與欄位邊界 | [索引 Red](tdd/red-page-cache.log)、[欄位 Red](tdd/red-page-cache-fields.log) | [單元 5 個結果](tdd/green-page-cache.log) |

重連初次 Red 中用戶端 close 未在斷言期限完成握手，不列產品失敗證據；改由隔離 runtime 實際關閉房間連線，並以原關閉處理器取得有效 Red。測試入口不出現在應用 Worker。

型別與 [build](tdd/formal-offline-build.log) 通過；完整 [Workers 51 個結果](tdd/refactor-formal-offline-integration.log) 與 [瀏覽器 126 個結果](tdd/refactor-formal-offline-e2e.log) 全部通過，沒有 skip 或重試。機器使用本機 Workers runtime、桌面 Chromium 與手機 Chromium／WebKit 模擬。

世代變更的檢視／另存與備份還原仍在後續任務。尚未驗證已部署 Cloudflare 或原生手機鍵盤；未部署。
