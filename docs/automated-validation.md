# 自動化驗證與 TDD 計畫

狀態：已授權建立環境與執行此次技術 TDD；依 AGENTS.md 全部開發驗收自動化。47 個情境是完整產品契約，此次原型結果不能冒充完整覆蓋。

## TDD 流程

1. **Red**：先為已定案行為新增最小測試，執行並記錄因功能缺失而失敗的斷言。語法／設定／依賴錯誤不算有效 Red；已存在且直接通過的測試不能冒充新行為的 Red。
2. **Green**：只實作讓該測試通過的必要程式；執行同一測試及受影響回歸測試。
3. **Refactor**：整理必要程式，不改變行為；再次執行同組測試及相關回歸，保留可重現結果。
4. 每個行為任務關聯 spec Scenario ID；保存 Red／Green／Refactor 的命令、版本、退出碼與測試報告。失敗即非完成，不以人工判定放行或把未實作測試標成通過。
5. 規格改動與完成開發各自依 AGENTS.md 自動提交相關檔案。此次先提交規格，再執行已授權循環。

## 工具與驗證邊界

| 層級 | 規劃工具 | 主要自動化斷言 |
| --- | --- | --- |
| 規格文件 | OpenSpec 嚴格驗證＋Node 文件檢查 | 本地連結、每個 Scenario 的唯一驗證 ID／方法、待確認狀態、未執行任務、文件差異空白檢查 |
| 單元 | Vitest | 日期／保留邊界、狀態轉移、內容轉換與權限判斷，使用固定資料與可控時鐘 |
| Workers 整合 | Vitest＋Cloudflare 官方整合測試工具 | 真正本機 Workers runtime 的 D1／SQLite DO／R2／WebSocket 行為；依測試隔離儲存 |
| 瀏覽器端到端 | Playwright | Chromium 桌面／手機模擬與 WebKit 手機模擬；實際 DOM、文件資料、觸控／鍵盤、IndexedDB、兩個隔離 context 與多分頁 |
| 外部服務契約 | 自動化寄件匣／寄信 stub；需要時隔離預備環境的機器測試 | 寄信請求與回應、連結使用與錯誤；可用性測試由程式判定，不要求人工收信或平台控制台操作 |

工具名稱是後續測試設計方向，此次開始建立 package.json 與測試程式；CI 使用相同非互動入口。後續設定依安裝版本校核，不能宣稱不存在的測試命令已可執行。

## 可重現故障與生命週期

- Session／magic link／日記與 90 天保留：控制用戶端及伺服器時鐘，不等待真實日期或長時間 sleep。測試 Q1／Q8 定案後的前一刻、邊界與之後。
- 同步：建立實際雙端 Yjs 文件與 WebSocket，控制並行屏障、延遲、重送及遺失確認；同時斷言用戶端資料、持久狀態與確認序號。
- DO：使用官方 evictDurableObject 測試保留連線的休眠／喚醒，abortAllDurableObjects 測試丟棄記憶體而保留持久資料；不可用刪光儲存的 reset 冒充重啟。[官方測試 API](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/)
- 保存／快照／D1 與 DO 協調：在特定讀寫／切換中斷點注入失敗，驗證重試及資料完整性。只 mock 被注入的邊界，不把整個儲存替換為記憶體 mock 來證明持久化。
- 離線：以隔離 browser context 關閉網路、刷新、重新連線並重開本機資料；背景情境測試應用生命週期事件與連線中斷／重建。
- 圖片：以固定二進位、偽造格式、超限檔案及 R2 故障 fixture 比對雜湊、引用與存取權限。
- 備份：自動匯出後在空的產品儲存恢復；比對完整資料集合、檔案雜湊、檢查點與新世代，並測試損毀與中斷。
- 故障注入只存在測試 runtime，不能成為正式環境可公開呼叫的端點；固定隨機種子並限制等待條件，避免偶發測試掩蓋資料錯誤。
- 本機工具不能重現的服務行為，以全自動隔離預備環境測試補足；不得改成人工驗收或把未覆蓋行為視為成功。

## 手機與中文輸入的自動化範圍

本輪中文 fixture 另以可控時鐘跨過 Safari 的選字後按鍵保護與 iOS Enter fallback；游標比較段落內文字位置，容許等價 DOM 邊界。程式碼複製本輪檢查 API 呼叫內容，正式 OS 剪貼簿仍不算已驗收。

手機驗收以觸控、viewport、焦點、可視編輯區、選單與 browser engine 自動斷言。中文輸入以 composition／beforeinput／input 事件與編輯器交易 fixture 驗證文字、選取、游標、換行與同步；不把合成事件說成真正操作了 OS 輸入法。

手機模擬不是實機 Safari／Chrome，viewport 縮小也不等於 OS 鍵盤實際彈出。這是已記錄的測試範圍限制，不新增人工驗收門檻，不以截圖目視取代程式斷言。若需要擴大原生覆蓋，先定義可全自動執行的裝置測試再更新規格。[Playwright 模擬範圍](https://playwright.dev/docs/emulation)

## 待確認事項與機器可檢查輸入

Q1、Q2、Q4–Q9 已採預設，Q3 留作接入服務前部署資訊；使用者選擇不是人類「驗證產品」。決定後提供固定契約／設定 fixture，由文件與設定檢查驗證值域、完整性及 spec 一致性。未定案者不寫死成已核准行為，產品驗收不能繞過所依賴的輸入。

測試使用假的擁有者 Email、域名與服務密鑰，不將私人配置寫入規格。Q3 的外部可用性以可機器判定的契約／隔離 smoke 測試記錄；尚未設定不等於通過。

## 情境追蹤

每份規格的「自動化驗證」列是輸入／故障及斷言的原始定義，以下只索引，不重複維護另一份行為清單。

| 能力 | 情境 ID | 計畫來源 |
| --- | --- | --- |
| personal-auth | AUTH-01～AUTH-08 | [spec](../openspec/changes/personal-notes-v1/specs/personal-auth/spec.md) |
| pages-and-journal | PAGE-01～PAGE-08 | [spec](../openspec/changes/personal-notes-v1/specs/pages-and-journal/spec.md) |
| block-editing | EDIT-01～EDIT-05 | [spec](../openspec/changes/personal-notes-v1/specs/block-editing/spec.md) |
| realtime-sync | SYNC-01～SYNC-12 | [spec](../openspec/changes/personal-notes-v1/specs/realtime-sync/spec.md) |
| private-assets | ASSET-01～ASSET-05 | [spec](../openspec/changes/personal-notes-v1/specs/private-assets/spec.md) |
| backup-restore | BACKUP-01～BACKUP-09 | [spec](../openspec/changes/personal-notes-v1/specs/backup-restore/spec.md) |

目前共 47 個情境 ID；是完整產品計畫；此次技術驗證的子項結果另記錄，不把未實作的正式服務算通過。後續測試名稱或 metadata 帶入 ID，機器比對 spec 與測試報告；沒有對應測試、skip／todo、未執行或失敗不能算已覆蓋。文件編號檢查不能冒充產品測試覆蓋率。

## 自動化命令契約

已建立以下非互動入口；實際原型結果與 TDD 證據見 [結果](tdd/README.md)。`npm run validate:probe` 串接本輪完整檢查；`test:spec-coverage` 的 --probe 僅檢查技術子案例，預設完整產品模式仍應失敗。

| 命令方向 | 預期輸出 |
| --- | --- |
| test:unit | Vitest 單元測試報告與退出碼 |
| test:integration | Workers runtime 整合報告及資料隔離／清理結果 |
| test:e2e | Playwright 各桌面／手機 engine 結果，失敗 trace 作診斷，通過以斷言決定 |
| test:spec-coverage | ID 與實際執行報告比對，缺漏／skip／失敗即非零退出碼 |
| check 與 build | 型別、格式及建置非互動檢查；不替代行為測試 |

CI 依相同入口執行相關測試，收集 TDD 報告與情境對照。初次 Red 必須保留，即使後續重試通過也不能隱藏最初失敗。

## 官方參考

- [Vitest](https://vitest.dev/guide/)
- [Cloudflare 測試 API](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/)
- [Playwright 裝置與 viewport 模擬](https://playwright.dev/docs/emulation)
