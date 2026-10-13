# 第一階段 TDD 技術驗證

此輪完成已授權的本機測試環境、BlockNote、Yjs 持久化與同世代離線重連。原型不等於完整產品：正式登入、頁面／日記資料、私有圖片、刪除／還原世代切換及 90 天備份仍未完成，OpenSpec change 不封存。

## 結果與採用決策

- BlockNote 0.55.0：基本區塊／格式往返、程式碼語言／縮排／換行、固定圖片引用、可點選區塊操作、中文事件與游標都通過桌面 Chromium、手機 Chromium 及手機 WebKit 模擬；採用為第一版編輯器。
- Yjs／y-partyserver：原生處理先廣播、延後 onSave；原型攔截原生 sync step 2／update 與帶 ID 的完整狀態提交，驗證後寫入 SQLite，等待 storage.sync，再確認及套用廣播。純刪除不能只靠 state vector 判斷；已用實際刪除與重啟斷言驗證。
- 保存故障不確認、不廣播或污染房間，重試／重送可恢復。abort 後只靠持久資料恢復；eviction 保留 WebSocket，喚醒後繼續保存。整理快照與刪除已含更新同一交易，中斷回滾；無新更新時重複整理也保持最高檢查點。
- y-indexeddb 載入快取；本機寫入改由明確 IndexedDB 交易確認完成／錯誤，先合併其他分頁紀錄再原子保存。已下載內文斷網修改、刷新及重連可合併在線端；未下載頁面與容量不足不宣稱本機保存成功。
- 關閉 BroadcastChannel 直接分享，讓跨分頁驗證走真正 WebSocket 與持久確認。owner／page／generation 隔離只是原型識別隔離，正式權限仍待 Better Auth 整合。

機器結果見 [results.json](results.json)。目前 4 個單元、12 個 Workers 整合、33 個瀏覽器結果，共 49 個全部通過。原型追蹤檢查要求 40 個技術結果，全部通過；完整產品 47 個情境仍不得算已驗收。

## Red、Green 與回歸證據

| 行為 | 有效 Red | Green／回歸 |
| --- | --- | --- |
| 缺漏／重複／skip 不可算覆蓋 | [red-coverage.log](red-coverage.log) | [green-unit.log](green-unit.log) |
| 解析實際報告與環境 | [red-reports.log](red-reports.log) | [green-unit.log](green-unit.log) |
| 目前提交確認識別 | [red-receipt.log](red-receipt.log) | [green-unit.log](green-unit.log)、真實服務延遲 ACK 的 E2E |
| BlockNote 行為 | [red-editor.log](red-editor.log) | [green-e2e.log](green-e2e.log) |
| 離線／雙端／跨分頁 | [red-offline.log](red-offline.log) | [green-e2e.log](green-e2e.log) |
| 保存、刪除、重啟、整理 | [red-sync.log](red-sync.log) 的 SYNC-02～07 | [green-sync.log](green-sync.log) |
| 保存先於原生廣播 | [red-order.log](red-order.log) | [green-sync.log](green-sync.log) |
| 整理不倒退檢查點 | [red-checkpoint.log](red-checkpoint.log) | [green-sync.log](green-sync.log) |

Red 日誌命令退出碼皆為 1，Green 日誌皆為 0。最初覆蓋檢查器 Red 用 Vitest 5.0.4；Workers plugin 的啟動不相容不是 Red，環境後改鎖 Vitest 4.1.11。最初 red-sync 的原生二進位案例誤把 Blob 當 ArrayBuffer，不列為有效 Red；設定 binaryType 後以原生處理基線另取 red-order，得到「已廣播但 SQLite 更新數為零」的正確斷言失敗。缺 y-prosemirror、失效 DO stub、工具設定錯誤亦不列為 Red。

重構／回歸保留 IndexedDB 與確認識別的獨立邊界、將報告檢查與瀏覽器 helper 共用、移除無需求的 CORS 處理。最終相關測試、型別、建置與規格檢查都以非互動命令驗證，不製造人工驗收門檻。

完整產品檢查見 [product-coverage-pending.log](product-coverage-pending.log)：退出碼 1 是預期的未完成狀態，不可用 --probe 覆蓋或把前綴 PROBE 的子案例混算為正式情境。

## 覆蓋限制與後續

- 中文是 composition／beforeinput／input 與交易 fixture；可控時鐘模擬 Safari 選字後 500 ms 保護與 iOS Enter fallback。手機 viewport／觸控不是原生 OS 輸入法或軟鍵盤，沒有宣稱實機驗證。
- 程式碼複製檢查 Clipboard API 呼叫內容，沒有讀取 OS 剪貼簿；圖片是固定原檔，尚未驗證正式私有上傳。正式 EDIT／ASSET 任務仍保留。
- 全部儲存、WebSocket、abort／eviction 使用本機 Workers runtime；未驗證已部署 Cloudflare 的長期運作、平台事故或正式 Email 服務。
- 原型單筆 Yjs 更新限制 512 KiB、快照整理由測試／本機端點觸發；正式正文限制、自動整理門檻與 IndexedDB SDK 掛鉤升級仍需後續自動化測試。
- 已測瀏覽器斷網與重連；瀏覽器仍在線但後端不可用時的啟動退化，留在正式同步整合測試。Service Worker 現為原型靜態快取，正式 API 接入前需收斂允許路由與版本清理。
- Q3 的擁有者 Email、網站與寄件設定在接入服務前提供；V3／V4、AUTH、PAGE、ASSET、BACKUP 依 [任務](../../openspec/changes/personal-notes-v1/tasks.md) 繼續。

## 原始參考

- [BlockNote Yjs 整合](https://www.blocknotejs.org/docs/features/collaboration)
- [y-partyserver 原始碼](https://github.com/cloudflare/partykit/blob/main/packages/y-partyserver/src/server/index.ts)
- [Cloudflare 官方 Vitest plugin](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/)、[測試 API](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/)
- [y-indexeddb 原始碼](https://github.com/yjs/y-indexeddb/blob/master/src/y-indexeddb.js)
