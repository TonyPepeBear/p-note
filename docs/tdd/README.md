# TDD 開發與驗證證據

此文件保留本機技術驗證與正式產品 TDD 證據。完整正式保存故障 UI、部署前整合與最終驗收仍在進行，OpenSpec change 不封存。

## 第九階段：覆蓋還原與舊草稿

V4、7.1／7.3 已有完整 Red／Green／Refactor 證據，見 [還原開發](../restore-development.md)。[結果](restore-recovery-results.json) 為單元 5、Workers 87、全套瀏覽器 141，共 233 個全部通過；[完整產品追蹤](restore-recovery-product-pending.log) 126／129，剩 SYNC-03 的三個瀏覽器結果。V3、正式雲端保存故障 UI 與最終 8.1／8.2 仍未勾選，不部署。

## 第六階段：正式離線與重連

OpenSpec 6.1／6.2 已完成。有效 Red／Green／Refactor、本機索引邊界、退避與每次權限重驗、182 個完整回歸結果見 [正式離線開發](../offline-development.md)。世代復原介面與備份／還原仍在進行。

Q3 私人部署輸入與原生 Email adapter 已接入，證據與實際寄信限制見 [寄信開發](../mail-development.md)。新 adapter 5 個案例及全套 56 個 Workers 結果通過。

## 第七階段：備份內部擷取

已建立持久正文擷取子案例與最小 RPC，範圍、Red／Green／Refactor 與 60 個 Workers 回歸見 [備份開發](../backup-development.md)。完整 BACKUP 情境與 7.1～7.3 尚未完成，保持未勾選。

## 第八階段：完整 ZIP 匯出

設定頁、私有串流 ZIP 與完整清單驗證已完成，BACKUP-06 的 Workers／三種瀏覽器環境通過。完整回歸為單元 5、Workers 75、瀏覽器 129，共 209；獨立 ZIP 解析 3／3。證據與限制見 [匯出開發](../export-development.md)。7.2 的備份／校驗／保留已完成；7.1／7.3 與 V3／V4 的完整還原仍未完成。

## 第五階段：正式編輯器

OpenSpec 5.5／5.6 已完成。有效 Red／Green／Refactor、72 個相關瀏覽器結果、51 個 Workers 回歸及 EDIT 17／17 追蹤見 [正式編輯器開發](../editor-development.md)。同步／備份／完整產品驗收仍在進行，不封存或部署。

## 第四階段：私有圖片

本輪完成 OpenSpec 5.3、5.4 的 ASSET-01～04 與 EDIT-03：有界上傳、JPEG／PNG／WebP／GIF 實際容器與 MIME 驗證、私有 R2 原檔、D1 所有權、失敗重試及穩定引用。沿用原表與 binding，沒有新套件／產品 migration／部署。使用者已確認 ASSET-05 留待備份 7.1。API、保留策略與 codec 邊界見 [圖片開發文件](../assets-development.md)。

[assets-results.json](assets-results.json) 記錄 126 個結果全部通過（單元 4、Workers 38、瀏覽器 84），沒有 skip；圖片 [14／14](assets-coverage.log)、PAGE [26／26](assets-pages-coverage.log)、AUTH [23／23](assets-auth-coverage.log) 與原型 [40／40](assets-probe-coverage.log) 全部完整。[完整產品](assets-product-coverage-pending.log) 仍退出 1，不宣稱備份或完整產品已完成。

| 行為 | 有效 Red | Green／Refactor |
| --- | --- | --- |
| 私有 API／格式大小／中斷／原檔與持久引用 | [red-assets-integration.log](red-assets-integration.log) | [green-assets-integration.log](green-assets-integration.log)、[refactor-assets-integration.log](refactor-assets-integration.log) |
| 圖片選取／失敗重試／跨 context 與垃圾桶 | [red-assets-e2e.log](red-assets-e2e.log) | [green-assets-e2e.log](green-assets-e2e.log)、[refactor-assets-e2e.log](refactor-assets-e2e.log) |
| 上傳成功後區塊插入失敗不能被吞掉 | [red-assets-insert.log](red-assets-insert.log) | [refactor-assets-e2e.log](refactor-assets-e2e.log) |

Workers 使用真實 D1／R2：串流中斷、R2 put 失敗及 D1 索引失敗不回正式引用，重試後原檔位元組／SHA-256 不變。大小測 10 MiB 前一 byte、邊界與超過一 byte；含動畫 GIF／WebP、截斷、PNG CRC、偽造 MIME／內容與 SVG／HEIC。正式 Yjs 引用在 DO abort 後恢復，另一 context／重開仍下載同原檔。瀏覽器原生上傳 callback 也使用私有 API。

第一次 sandbox 無法建立監聽埠，不計 Red，已升權取得 API 404 的有效失敗。WebKit 的 Playwright route 因 Service Worker 未攔到請求，該 fixture 問題不計產品 Red；改用隔離測試 Worker 注入 R2 put 故障，三種 engine 均通過。插入拋錯也保留檔案／錯誤與重試，沒有不存在原檔的正式引用。

型別、[Vite build](assets-client-build.log)、Worker types、[Worker dry-run](assets-worker-build.log)、文件／設定契約、OpenSpec 嚴格驗證與 git diff --check 通過。未部署或執行雲端 migration。原檔不永久清理；伺服器是容器驗證、前端另做像素解碼；手機只用瀏覽器模擬，沒有原生相簿選取器驗收。

## 第三階段：頁面與日記

本輪完成 OpenSpec 5.1、5.2 的 PAGE-01～08：今日與日期補寫／月份列表、根筆記／子頁／路徑、標題與合法移動、垃圾桶還原，以及中文標題／正文搜尋。實作範圍、API／migration 與限制見 [頁面開發文件](../pages-development.md)。

[pages-results.json](pages-results.json) 記錄最終 106 個結果全部通過（單元 4、Workers 33、瀏覽器 69），沒有 skip。頁面追蹤 [26／26](pages-coverage.log)、登入 [23／23](pages-auth-coverage.log) 與原型 [40／40](pages-probe-coverage.log) 全部完整；[完整產品檢查](pages-product-coverage-pending.log) 仍因後續功能未完成而退出 1，不封存 change。

| 行為 | 有效 Red | Green／Refactor |
| --- | --- | --- |
| 日期、階層、循環、垃圾桶與中文搜尋 API | [red-pages-integration.log](red-pages-integration.log) | [green-pages-integration.log](green-pages-integration.log)、[refactor-pages-integration.log](refactor-pages-integration.log) |
| 日期、導覽、子頁、垃圾桶與搜尋 UI | [red-pages-e2e.log](red-pages-e2e.log) | [green-pages-e2e.log](green-pages-e2e.log)、[refactor-pages-e2e.log](refactor-pages-e2e.log) |
| 本機保存失敗必須停止導覽／刪頁 | [red-pages-local.log](red-pages-local.log) | [refactor-pages-e2e.log](refactor-pages-e2e.log) |
| 權限重驗斷線需捕捉拒絕與保留草稿 | [red-pages-revalidate.log](red-pages-revalidate.log) | [refactor-pages-e2e.log](refactor-pages-e2e.log) |
| 缺少移動目標與異動中列表不能冒充完成 | [red-pages-boundaries.log](red-pages-boundaries.log) | [refactor-pages-integration.log](refactor-pages-integration.log) |

PAGE-01 的既有今日 API 原本直接通過，只作回歸，不冒充 Red；首次 Workers Red 是其餘七個功能入口缺少。最初瀏覽器 fixture 遺漏 Origin 而被 CSRF 拒絕，該環境錯誤不列證據；補上 Origin 後在固定的舊 UI 基線重取六個操作入口缺少的有效 Red。導覽案例等待實際 frame 導覽完成，避免把上一頁的保存狀態當成新頁面完成；移動選單已改成明確的 label／control 關聯。

故障測試使用真正 D1／SQLite DO／R2：在房間持久暫停與解除階段注入失敗，斷言處理中頁面停止存取、未完成結果不提前進垃圾桶列表、意圖仍存在，再以 abort 重啟並重送同操作，斷言可恢復、正文與圖片引用不變。循環測試併發互移，只能一方成功；搜尋斷言 owner／子樹／世代／檢查點隔離，且不改正文。共用既有 bounded JSON 解析與保存函式，保留錯誤與大小檢查。

型別、Vite build、Worker types 一致性、文件／設定契約、OpenSpec 嚴格驗證與差異空白檢查皆通過。[Worker bundle](pages-worker-build.log) 僅 dry-run，沒有部署。預期注入 RPC／損毀載入錯誤與開發代理 EPIPE 不列成功條件；判定依斷言與退出碼。

PAGE-06 的圖片是固定 R2／Yjs 引用 fixture，沒有完成 ASSET 服務。正式寄信、私有圖片、備份、覆蓋還原世代切換與完整正式離線仍待後續；手機為 Chromium／WebKit 模擬，沿用既有單次更新 512 KiB 與編輯器大 chunk 界線。

## 第二階段：資料結構與登入

本輪完成 1.4、2.2、4.1、4.2：Better Auth 1.7.7 直接使用 D1，建立 SQL schema、固定 30 天 session、雜湊保存的 10 分鐘單次連結、D1 滑動視窗限流、無副作用郵件確認頁與 POST 兌換，以及登入／今日入口和正式 SYNC 房間的權限邊界。設定與服務隔離見 [登入開發文件](../auth-development.md)。

最終 [auth-results.json](auth-results.json) 記錄 76 個結果全部通過（單元 4、Workers 24、瀏覽器 48），沒有 skip。登入追蹤 [23／23](auth-coverage.log)、既有原型 [40／40](auth-probe-coverage.log) 都完整；[完整產品檢查](auth-product-coverage-pending.log) 仍因後續任務未完成而退出 1。

| 行為 | 有效 Red | Green／Refactor |
| --- | --- | --- |
| 登入入口、所有權、日期唯一、寄信故障、單次／過期、限流及撤銷 | [red-auth.log](red-auth.log) | [green-auth-integration.log](green-auth-integration.log)、[refactor-auth-integration.log](refactor-auth-integration.log) |
| 登入 UI、期限內重開、離線草稿到期與重新登入返回原頁 | [red-auth-e2e.log](red-auth-e2e.log) | [green-auth-e2e.log](green-auth-e2e.log)、[refactor-auth-e2e.log](refactor-auth-e2e.log) |
| 建立時鐘前進仍維持精確固定期限 | [red-auth-clock.log](red-auth-clock.log) | [refactor-auth-integration.log](refactor-auth-integration.log) |
| 撤銷 session 同時清除 cookie | [red-auth-logout.log](red-auth-logout.log) | [refactor-auth-integration.log](refactor-auth-integration.log) |

最初瀏覽器 Red 執行期間誤混入 Vite 熱更新，該輪不列證據；已回到固定的登入前原型 UI 基線重取五個缺少登入操作的失敗。本輪 Red 的命令、版本、退出碼及失敗原因記錄在 JSON；選取單一案例的其他未執行案例不算通過。

重構沿用既有編輯器與持久確認程式、共用 owner／page／generation 房間名稱、將時鐘與寄件匣隔離於測試 runtime，並以同一次建立時間計算固定期限。撤銷／過期後的連線不能提交或接收有效同伴廣播；官方 eviction 後仍重驗權限。重新登入保留 IndexedDB 草稿並讀取原頁世代；原型 namespace 不可取得正式房間資料。

型別、Worker types 一致性、Vite build、文件／設定契約、OpenSpec 嚴格驗證及差異空白檢查皆通過。[Worker bundle](auth-worker-build.log) 僅 dry-run，沒有部署。Vite 的既有 BlockNote 大 chunk 提示、測試中主動關閉 WebSocket 的開發代理 EPIPE，以及損毀載入測試的預期錯誤日誌不視為行為失敗；所有結果仍由斷言與退出碼決定。

正式 Email／域名／寄件服務尚未接入，應用預設拒絕寄信。登入以假設定與本機 runtime 自動驗證，未驗證已部署 Cloudflare。完整離線啟動、頁面階層／垃圾桶介面、私有資產、備份與世代切換協調仍留後續任務；手機仍為 Chromium／WebKit 模擬。

## 結果與採用決策

- BlockNote 0.55.0：基本區塊／格式往返、程式碼語言／縮排／換行、固定圖片引用、可點選區塊操作、中文事件與游標都通過桌面 Chromium、手機 Chromium 及手機 WebKit 模擬；採用為第一版編輯器。
- Yjs／y-partyserver：原生處理先廣播、延後 onSave；原型攔截原生 sync step 2／update 與帶 ID 的完整狀態提交，驗證後寫入 SQLite，等待 storage.sync，再確認及套用廣播。純刪除不能只靠 state vector 判斷；已用實際刪除與重啟斷言驗證。
- 保存故障不確認、不廣播或污染房間，重試／重送可恢復。abort 後只靠持久資料恢復；eviction 保留 WebSocket，喚醒後繼續保存。整理快照與刪除已含更新同一交易，中斷回滾；無新更新時重複整理也保持最高檢查點。
- y-indexeddb 載入快取；本機寫入改由明確 IndexedDB 交易確認完成／錯誤，先合併其他分頁紀錄再原子保存。已下載內文斷網修改、刷新及重連可合併在線端；未下載頁面與容量不足不宣稱本機保存成功。
- 關閉 BroadcastChannel 直接分享，讓跨分頁驗證走真正 WebSocket 與持久確認。owner／page／generation 隔離只是原型識別隔離，正式權限仍待 Better Auth 整合。

前輪機器結果見 [results.json](results.json)：4 個單元、12 個 Workers 整合、33 個瀏覽器結果，共 49 個全部通過。原型追蹤檢查要求 40 個技術結果，全部通過；完整產品 47 個情境仍不得算已驗收。

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
- 已測瀏覽器斷網與重連；瀏覽器仍在線但後端不可用時的啟動退化，留在正式同步整合測試。本輪 Service Worker 已加入 API／憑證頁排除與舊 shell 版本清理，完整正式離線啟動仍留待後續。
- Q3 的正式擁有者 Email、網站與寄件設定在接入服務前提供；本輪 AUTH 已完成本機驗證，V3／V4、完整 PAGE／ASSET／BACKUP 依 [任務](../../openspec/changes/personal-notes-v1/tasks.md) 繼續。

## 原始參考

- [BlockNote Yjs 整合](https://www.blocknotejs.org/docs/features/collaboration)
- [y-partyserver 原始碼](https://github.com/cloudflare/partykit/blob/main/packages/y-partyserver/src/server/index.ts)
- [Cloudflare 官方 Vitest plugin](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/)、[測試 API](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/)
- [y-indexeddb 原始碼](https://github.com/yjs/y-indexeddb/blob/master/src/y-indexeddb.js)
