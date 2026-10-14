## 設計
以共用 CSS variables 定義淺灰綠互動底色與選取底色；Mantine variant resolver 僅調整 gray／dark 的 subtle／light，中性 default 與無指定語意色的選單使用同一底色。主色及 red／orange 保留原有語意色。側欄以明確狀態選擇器處理 hover 與觸控 active，排除停用元件。BlockNote 透過支援的 theme colors 接入相同互動色，保留文字高亮色。

## 驗證
Red／Green 使用 hover-colors.spec.ts 與 Chromium 桌面。驗收完整三瀏覽器 E2E，檢查 hover 計算色、一般文字 4.5:1、主操作與危險操作對比、停用背景不變、鍵盤焦點、觸控操作後沒有黏住 hover。截圖僅使用測試資料，留在忽略的 test-results。
