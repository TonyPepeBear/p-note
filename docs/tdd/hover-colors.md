# Hover 互動色驗證

## 範圍與發現
檢查登入、側欄、編輯工具列、區塊選單、BlockNote、資料庫、備份與 API key 設定的共用元件及色彩來源。工作區固定使用淺色模式。

- 深灰 subtle 按鈕使用 Mantine dark.2 作 hover 底色，呈現中灰色塊。
- 側欄選取項目的自訂背景壓過套件 hover，缺少互動回饋。
- 區塊刪除選單的原始紅字／hover 底色對比約 2.26:1。
- 橘色最深 filled 按鈕 hover 退回較淺一階，白字對比約 3.58:1；一般狀態也僅約 4.30:1。

## Red／Green
新增 `tests/e2e/hover-colors.spec.ts`，以 Chromium 桌面先重現中性 hover 明度、選取 hover 及危險操作對比失敗。修正測試資料日期後，側欄案例因選取底色未變而失敗，符合預期。

共用淺灰綠 token、側欄狀態選擇器、BlockNote 公開 CSS 色彩變數 與較深危險文字／橘色解決上述失敗。驗收斷言實際合成底色、hover 回饋、一般文字至少 4.5:1、紅／綠語意、disabled 不變、Tab 焦點及觸控無殘留 hover；不依賴固定截圖或 CSS 變數名稱。

## 環境
雲端環境已安裝 Chromium 與 WebKit。WebKit 缺少的公開系統函式庫解開到 `/tmp`，下載包的啟動腳本保留此函式庫路徑；主機靜態 GLES 檢查不識別此路徑，測試環境略過該靜態檢查，但已實際啟動 WebKit 載入測試網站，產品斷言完整執行。此環境調整不提交至產品。

## 驗收結果
- 完整 `npm run test:e2e`：345 個案例，首輪 339 通過；6 個 WebKit 案例在四 worker 執行時超過 20 秒。
- 僅針對失敗案例以一個 worker、60 秒總時限重跑，原功能斷言未變：6／6 通過，每例實際 8.0–10.3 秒。程式斷言首輪及重跑案例完全對應，未解決失敗為 0。
- UI-01～UI-10：三瀏覽器共 30 個結果均在完整首輪通過，包含新增 hover／觸控／焦點與對比情境。
- `npm run check`、`npm run check:spec`、E2E 使用的 Vite production build、`npm run check:production` 通過。
- 已依最新 AGENTS.md 在合併 PR 前同步主規格並提交封存結果。
- 整合遠端新筆記連結功能並解決衝突後，相關 30 個案例首輪 29 通過，WebKit 的 LINK-01 導航案例失敗且單獨重跑仍失敗。
- 最終保留 BlockNote 原本的 light 主題流程，改由 CSS 色彩變數調整編輯器及 portal；重跑 hover 與 LINK-01 相關情境，18 個三瀏覽器案例全部通過，包含曾失敗的導航案例。最終型別與 115 個規格契約通過。此為針對最終整合變更的驗證，不宣稱新筆記連結功能納入前一輪完整 345 項執行。
- 正式發布與 HTTPS 檢查結果見下方紀錄。

原始測試資料、登入連結、憑證、trace 與截圖不提交。

## 正式發布
- [PR #5](https://github.com/TonyPepeBear/p-note/pull/5) 已合併；發布提交為 `95dc0a34ed3179185b22d9018828ec5c92314d94`。
- [GitHub Actions](https://github.com/TonyPepeBear/p-note/actions/runs/38582082623) 首輪建置、型別、正式設定、部署預檢、資料庫遷移及 Cloudflare 發布均成功。最後的首頁建置檢查讀到上一版 module 資源，故首輪 workflow 標示失敗。
- 發布後以同一份 `scripts/check-deployment.mjs` 重驗 [正式 HTTPS 入口](https://note.tonypepe.com)：本次 JavaScript 建置一致、資源可讀、私人 API 拒絕未登入、測試入口封鎖，全部斷言通過。
- 額外唯讀 HTTPS 檢查斷言正式 CSS 與本次建置一致，編輯器及側欄選取 hover 色彩變數皆已發布；首頁及 CSS 均為 200。
- 經使用者明確批准後，重跑同一發布提交的工作；[第二次執行](https://github.com/TonyPepeBear/p-note/actions/runs/38582082623/attempts/2) 於台北時間 2026-10-14 22:47 完成，最終狀態為 success。建置、資料庫遷移、Cloudflare 發布，以及最後的正式建置與私人 HTTPS 入口檢查全部成功。
