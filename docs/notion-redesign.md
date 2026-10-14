# Notion 工作區全面重做

本次以 Notion 的中性色、緊湊側欄、無框文件、資料庫檢視及輕量浮層為介面基準，涵蓋所有既有使用者畫面。規格見 [proposal](../openspec/changes/archive/2026-10-14-rebuild-notion-workspace/proposal.md)、[設計決策](../openspec/changes/archive/2026-10-14-rebuild-notion-workspace/design.md)及 [UI-01～10 驗收情境](../openspec/changes/archive/2026-10-14-rebuild-notion-workspace/specs/workspace-experience/spec.md)。

## 畫面範圍

| 區域 | 重做內容 | 必須保留的操作 |
| --- | --- | --- |
| 登入與確認登入 | 精簡置中版面、清楚下一步與一致表單 | 寄送、確認、失敗後重試 |
| 工作區 | 暖灰約 240px 側欄、細分隔線、白色主畫布、輕量頂部列 | 收合與恢復、頁面樹、目前頁面、搜尋及日記 |
| 文件與編輯 | 無框正文、大標題、緊鄰內容的工具與保存狀態 | 直接改標題、區塊操作、圖片、程式碼及離線草稿 |
| 導覽浮層 | 搜尋、日記、頁面操作、刪除確認與垃圾桶統一呈現 | 鍵盤、Escape、焦點返回、長標題、還原 |
| 資料庫 | 可鍵盤操作的檢視 tabs、相鄰搜尋與工具列、緊密表格／清單 | 篩選、排序、欄位管理、欄位值、新增及開啟筆記 |
| 備份 | 共用工作區 shell、精簡列表與明確覆蓋確認 | 建立、下載、勾選確認、取消；還原執行中／中斷時鎖定離頁並以相同 request ID 重試 |
| API key | 共用工作區 shell、緊密表單與列表 | 建立、顯示、隱藏、複製、撤銷確認；背景登入失效立即隱藏 key 並保留草稿 |
| 全域與特殊狀態 | 載入、空資料、零結果、錯誤、離線及草稿復原使用同一層次 | 保留內容、可重試、無誤導的成功訊息 |
| PWA | 中性安裝圖示、瀏覽器主題色、緊湊安裝／更新入口及說明浮層 | 安裝、取消、離線重開、保存後更新；還原鎖定時停用安裝與更新 |
| 手機 | 375px 畫布、導覽 drawer、主要操作至少 44px | 抽屜關閉後繼續寫作、設定導覽、長表格容器內捲動 |

## 多步操作驗收

[新增 E2E](../tests/e2e/notion-redesign.spec.ts) 驗證以下完整流程，並以既有 [UI](../tests/e2e/workspace-ui.spec.ts)、[UX](../tests/e2e/workspace-usability.spec.ts)、[資料庫](../tests/e2e/databases.spec.ts)、[備份](../tests/e2e/backup.spec.ts)與 [API key](../tests/e2e/api-keys.spec.ts) 測試補足回歸：

- 寫入正文 → 收合側欄 → 恢復 → 繼續書寫 → 重新整理後內容仍在。
- 12 份筆記的緊湊側欄 → 開啟清單最後一筆 → 正文編輯與保存；同時斷言中性色、閱讀畫布無外框及無水平溢出。
- 手機開啟導覽 → 新增筆記 → 改標題與寫正文 → 再開關導覽 → 繼續編輯；主要動作、頁面列與關閉按鈕至少 44px。
- 鍵盤切換資料庫檢視 → 搜尋零結果 → 清除搜尋 → 新增筆記 → 編輯正文 → 回資料庫 → 重開筆記確認內容。
- 從文件開啟備份 → 切換 API key 設定 → 返回同一文件；側欄與已保存正文保留。
- 手機設定中開啟導覽 → 選擇另一文件 → 立即編輯 → 再進出備份設定後仍保留內容。
- `BACKUP-UI-LOCK-01`：選擇備份並確認還原 → 執行中鎖定返回、設定、今天與登出 → 還原中斷後維持鎖定及原備份 → 沿用相同 request ID 重試。
- `KEY-03`：保存正文 → 開啟設定並顯示 key → 背景驗證登入失效 → 立即離開設定、隱藏完整 key、顯示重新登入且保留草稿。

測試使用合成筆記與 `owner@example.test`；登入憑證及 API key 由隔離測試環境建立，不讀取正式筆記、真實收件者或正式憑證，也不將測試憑證寫入文件。幾何與互動斷言是自動驗收條件，截圖是開發檢查證據。

## 畫面紀錄

以下皆為隔離測試資料，沒有正式筆記或憑證：

| 畫面 | 紀錄 |
| --- | --- |
| 桌面文件 | [工作區](screenshots/notion/workspace-desktop.png) |
| 桌面資料庫 | [檢視與工具列](screenshots/notion/database-desktop.png) |
| 設定 | [API key 空狀態](screenshots/notion/settings-desktop.png) |
| 手機文件 | [工作區](screenshots/notion/workspace-mobile.png) |
| 手機資料庫 | [觸控工具列](screenshots/notion/database-mobile.png) |
| 手機安裝說明 | [安裝浮層](screenshots/notion/install-mobile.png) |

## 執行與結果

2026-10-14 完成驗收。所有 E2E 由同一組服務集中執行，三個專案為 `chromium-desktop`、`chromium-mobile` 與 `webkit-mobile`；手機是瀏覽器模擬環境，範圍同 [自動化驗證文件](automated-validation.md)。

| 驗證 | 實際結果 |
| --- | --- |
| 單元測試 | 5 個測試檔，8／8 通過 |
| Workers 整合測試 | 17 個測試檔，107／107 通過 |
| 最後一輪完整 E2E | 410／411 通過；WebKit `PAGE-04` 耗盡案例總時限，於後續集中回歸通過 |
| 最後集中回歸 | 36／36 通過，涵蓋 PWA、手機焦點、資料庫、備份鎖定及 `PAGE-04`；補強安裝說明動畫斷言後，該流程再跑三環境 3／3 通過 |
| 每個情境／瀏覽器的最後結果 | 414／414 通過；含新增的三個 `PWA-UI-01` 執行，並非單輪執行 414 個案例 |
| 真實建置 HTTPS smoke | 2／2 通過：登入、wss 保存、離線刷新與分析請求不阻擋編輯 |
| 型別、文件契約與正式設定預檢 | `check`、`check:spec`、`check:production` 通過 |
| 規格覆蓋 | 完整產品、UI、UX、資料庫、連結與 PWA 均通過 |

完整回歸原始報告保存在被 Git 忽略的 `reports/e2e-full.json`，最後集中回歸為 `reports/e2e-focused.json`，安裝說明的最後驗證為 `reports/e2e-install.json`。覆蓋率使用 `reports/e2e.json`：依檔案、情境階層／標題與瀏覽器保留最後一次**實際執行**結果，並記錄三個來源報告的 SHA-256；沒有將重複案例相加、改寫來源報告或隱藏先前失敗。414 個不同結果中沒有未執行、略過或尚未修復的失敗。

### Red／Green 與修復紀錄

- 在隔離舊版 checkout 執行兩個 Red，分別因沒有「收合側邊欄」與備份設定沒有「筆記頁面」導覽而失敗；新版相同流程通過。
- 首輪相關桌面測試 46 個通過、4 個失敗；修正 hover 一致性、危險操作對比、登入主操作 44px 及輔助文字對比，四個案例重跑通過。還原鎖定與設定背景登入失效兩個新增案例也通過。
- 第一輪完整回歸為 378／387；修正手機返回入口、筆記連結載入期間的舊結果選取，將舊 AppShell 選擇器改為導覽語義。`PAGE-03`、`PAGE-04`、`PAGE-06` 的長流程總時限改為 45 秒，保留每步 5 秒及全部原斷言。
- 新增 `LINK-01` 延遲搜尋測試，確認 Enter 不會插入上一批結果；原連結測試直接斷言實際目標 ID。
- 新增 `PWA-UI-01` 抓到關閉說明後焦點未恢復，以及選擇同一份日記後抽屜未關閉；已修正最上層 Escape 處理、明確焦點恢復及同頁導覽關閉。明確設定安裝說明的浮層順序，加入實際點擊「知道了」與等動畫完成的斷言，避免 DOM 可見卻無法點擊或截到透明首幀，最後三環境均通過。
- 整合上游 PWA 後，舊 watch 程序未重新讀取建置設定，造成未登入離線頁缺資源；重新啟動服務後完整回歸與最後集中回歸均通過，沒有因此修改 Service Worker 產品邏輯。
- 中間一次 Chromium 真實更新測試在 5 秒內未收到重新載入，未能重現；獨立連跑三次及最後三環境回歸均通過。保留該次失敗紀錄，未據此變更更新控制器或放寬該斷言。

最後集中回歸命令：

```sh
npm run test:e2e -- tests/e2e/pwa.spec.ts tests/e2e/databases.spec.ts tests/e2e/notion-redesign.spec.ts tests/e2e/backup.spec.ts tests/e2e/pages.spec.ts --grep 'PWA-|DB-08|UI-05|BACKUP-UI-LOCK|PAGE-04'
```

合併前封存 OpenSpec 並同步主規格。合併後由 master workflow 執行資料遷移與發布，發布結果以對應的 GitHub Actions 為準；不額外執行正式網站 HTTP 檢查。
