## Why
工作區的深灰 subtle 按鈕 hover 使用 dark.2，背景變成中灰；側欄選取樣式壓過 hover，其他導覽與選單混用預設冷灰。互動色應與淺色灰綠工作區一致。

## What Changes
- 統一中性按鈕、圖示、選單與編輯器的淺灰綠 hover。
- 側欄未選取、選取及選取後 hover 使用可分辨的狀態。
- 保留主操作、危險操作、停用及鍵盤焦點的語意與可讀性。
- 以 Playwright 驗證實際計算色、文字對比與觸控狀態，完成 PR 與正式部署。

## Impact
- 影響 workspace-experience、共用主題、側欄與 BlockNote 視覺樣式。
- 不新增資料遷移或改動筆記內容格式。
