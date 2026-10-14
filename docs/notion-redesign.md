# Notion 工作區全面重做

本次以 Notion 的中性色、緊湊側欄、無框文件、資料庫檢視及輕量浮層為介面基準，涵蓋所有既有使用者畫面。規格見 [proposal](../openspec/changes/rebuild-notion-workspace/proposal.md)、[設計決策](../openspec/changes/rebuild-notion-workspace/design.md)及 [UI-01～10 驗收情境](../openspec/changes/rebuild-notion-workspace/specs/workspace-experience/spec.md)。

## 畫面範圍

| 區域 | 重做內容 | 必須保留的操作 |
| --- | --- | --- |
| 登入與確認登入 | 精簡置中版面、清楚下一步與一致表單 | 寄送、確認、失敗後重試 |
| 工作區 | 暖灰約 240px 側欄、細分隔線、白色主畫布、輕量頂部列 | 收合與恢復、頁面樹、目前頁面、搜尋及日記 |
| 文件與編輯 | 無框正文、大標題、緊鄰內容的工具與保存狀態 | 直接改標題、區塊操作、圖片、程式碼及離線草稿 |
| 導覽浮層 | 搜尋、日記、頁面操作、刪除確認與垃圾桶統一呈現 | 鍵盤、Escape、焦點返回、長標題、還原 |
| 資料庫 | 可鍵盤操作的檢視 tabs、相鄰搜尋與工具列、緊密表格／清單 | 篩選、排序、欄位管理、欄位值、新增及開啟筆記 |
| 備份 | 共用工作區 shell、精簡列表與明確覆蓋確認 | 建立、下載、勾選確認、取消、中斷重試 |
| API key | 共用工作區 shell、緊密表單與列表 | 建立、顯示、隱藏、複製、撤銷確認 |
| 全域與特殊狀態 | 載入、空資料、零結果、錯誤、離線及草稿復原使用同一層次 | 保留內容、可重試、無誤導的成功訊息 |
| 手機 | 375px 畫布、導覽 drawer、主要操作至少 44px | 抽屜關閉後繼續寫作、設定導覽、長表格容器內捲動 |

## 多步操作驗收

[新增 E2E](../tests/e2e/notion-redesign.spec.ts) 驗證以下完整流程，並以既有 [UI](../tests/e2e/workspace-ui.spec.ts)、[UX](../tests/e2e/workspace-usability.spec.ts)、[資料庫](../tests/e2e/databases.spec.ts)、[備份](../tests/e2e/backup.spec.ts)與 [API key](../tests/e2e/api-keys.spec.ts) 測試補足回歸：

- 寫入正文 → 收合側欄 → 恢復 → 繼續書寫 → 重新整理後內容仍在。
- 12 份筆記的緊湊側欄 → 開啟清單最後一筆 → 正文編輯與保存；同時斷言中性色、閱讀畫布無外框及無水平溢出。
- 手機開啟導覽 → 新增筆記 → 改標題與寫正文 → 再開關導覽 → 繼續編輯；主要動作、頁面列與關閉按鈕至少 44px。
- 鍵盤切換資料庫檢視 → 搜尋零結果 → 清除搜尋 → 新增筆記 → 編輯正文 → 回資料庫 → 重開筆記確認內容。
- 從文件開啟備份 → 切換 API key 設定 → 返回同一文件；側欄與已保存正文保留。
- 手機設定中開啟導覽 → 選擇另一文件 → 立即編輯 → 再進出備份設定後仍保留內容。

測試使用合成筆記與 `owner@example.test`，不讀取或保存正式筆記、真實收件者、憑證或 API key。幾何與互動斷言是自動驗收條件，截圖是開發檢查證據。

## 執行與結果

所有 E2E 服務由主代理集中啟動，避免同一 checkout 共用測試資料時相互覆寫。相關 Red／Green 使用 Chromium desktop，最終回歸使用 `chromium-desktop`、`chromium-mobile` 與 `webkit-mobile`。

2026-10-14：主代理在隔離舊版 checkout 執行兩個 Chromium desktop Red，兩個案例均因預期產品缺口失敗：工作區沒有「收合側邊欄」按鈕，備份頁沒有「筆記頁面」導覽。沒有將服務錯誤、瀏覽器安裝或環境失敗視為有效 Red。

新增的六個流程及既有 [互動色測試](../tests/e2e/hover-colors.spec.ts) 共同覆蓋本次改版；互動色測試改用新版 aria-current 語義，保留 hover、觸控、對比、停用與鍵盤焦點要求。Green、完整回歸與發布結果由主代理實際執行後記錄，不將尚未執行的檢查標為通過。

完成實作與驗證後，合併前先封存 OpenSpec change、同步主規格並提交；合併後確認 master workflow 的資料遷移與發布結果，發布成功後結束。
