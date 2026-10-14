## ADDED Requirements

### Requirement: 一致且可讀的互動色

系統 SHALL 在淺色工作區使用柔和灰綠的中性互動底色；目前項目、主操作及危險操作 MUST 保留可辨識語意。停用元件 MUST 不呈現可操作的 hover，鍵盤焦點 MUST 可見；觸控裝置 MUST 不留下黏住的滑鼠 hover。

#### Scenario: 中性操作與主操作 hover
- **自動化驗證**: `UI-07`；Playwright 斷言登入、工具列、備份與設定 hover 背景維持淺色、中性底色一致、hover 與預設不同、文字對比至少 4.5:1，主操作保留主色與可讀性。
- **WHEN** 滑鼠移至中性操作或主操作
- **THEN** 中性操作顯示柔和淺底、文字清楚；主操作維持綠色語意與 hover 回饋

#### Scenario: 側欄選取與互動狀態
- **自動化驗證**: `UI-08`；Playwright 斷言未選取與選取項目 hover 均有回饋、選取標记與文字對比保留；觸控操作後未選取項目不殘留 hover。
- **WHEN** 使用者以滑鼠或觸控操作側欄
- **THEN** 未選取、選取與 hover 可區分，目前頁面持續標記

#### Scenario: 選單與編輯器互動一致
- **自動化驗證**: `UI-09`；Playwright 斷言區塊選單及 BlockNote 工具 hover 使用一致淺色背景、文字對比至少 4.5:1；危險操作維持紅色及可讀性。
- **WHEN** 使用者操作區塊選單或編輯器工具
- **THEN** 互動色與工作區一致，刪除類動作保留紅色語意

#### Scenario: 停用與鍵盤焦點
- **自動化驗證**: `UI-10`；Playwright 斷言停用上傳與還原操作在 pointer 移入後背景不變、保持 disabled；鍵盤 Tab 焦點有可見 outline 且能操作面板。
- **WHEN** 元件尚不可操作或使用者以鍵盤移動焦點
- **THEN** 停用項目無 hover 回饋且不可執行；可用元件保留可見鍵盤焦點
