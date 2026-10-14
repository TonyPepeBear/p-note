# master 自動部署驗證

日期：2026-10-14。使用者確認沿用 `master`，不建立 `main`。OpenSpec change：`github-actions-production`。

## TDD

命令：`E2E_PORT_OFFSET=200 E2E_WORKERS=2 npm run test:e2e:fast -- tests/e2e/deployment.spec.ts`。

- Red：退出碼 1，3 個失敗；CICD-01／02 因缺少 workflow、CICD-03 因缺少部署後檢查腳本失敗。
- 首次 Green 嘗試：退出碼 1，2 個通過、1 個失敗。順序測試誤將 dry-run 的 deploy 字樣當作真正部署；修正斷言為完整發布命令。
- Green：退出碼 0，3 個通過。HTTP fixture 確認正確建置通過，舊版 script、私人 API 回 200、測試入口回 200 均拒絕。
- 初次 sandbox 啟動本機連接埠被拒絕，未視為有效 Red；上述 Red／Green 是允許本機服務後的結果。

## 靜態驗證

- OpenSpec 嚴格驗證通過。
- 官方 actionlint v1.7.12 執行成功；下載後先以官方 checksum 驗證 SHA256，工具僅存於暫存目錄。
- 型別、正式設定與 6 個單元測試通過。
- 規格檢查器新增 CICD 情境支援，`npm run check:spec` 通過 105 個唯一情境與本機連結檢查。

## 整合與啟用狀態

`npm run test:integration` 通過 104 個測試；`E2E_PORT_OFFSET=400 npm run test:build` 通過 2 個 HTTPS 建置測試。`node scripts/check-deployment.mjs` 對目前正式站的唯讀檢查通過。

本機完整 E2E 首先出現 Chromium 的 LFN-06／07 失敗；針對性重跑兩個皆通過，但重跑時雖改變 port，仍共用 `.wrangler/test-state-*`，因此干擾後半段 WebKit。停止這輪時是 300 通過、15 失敗、2 中斷、16 未執行，不作為完整驗收通過。針對性重跑命令為 `E2E_PORT_OFFSET=600 E2E_WORKERS=1 npm run test:e2e:fast -- tests/e2e/local-first.spec.ts tests/e2e/spa-navigation.spec.ts --grep 'LFN-07|LFN-06：背景驗證 500' --reporter=list --output=test-results/cicd-recheck`。正式驗收等待隔離的 GitHub runner 結果；不交錯執行相同 checkout 的 E2E 服務。

GitHub Actions 已啟用，帳號有 repository 管理權。Cloudflare 連接器的 token 管理 API 回覆未授權；使用者直接在 GitHub Secrets 新增專用 `CLOUDFLARE_API_TOKEN`，CLI 已確認名稱存在，對話及版本控制不接收其值。

程式提交 `517e05e` 推送 `master` 自動觸發 [首次執行](https://github.com/TonyPepeBear/p-note/actions/runs/38555268728)。GitHub runner 通過套件／瀏覽器安裝、型別、正式設定、單元及 Workers 整合檢查；E2E 執行到約第 284 個情境時，已出現 API key 設定與日記月份的 WebKit 逾時，為取得紀錄而取消，未進入正式遷移或部署。完整產品回歸未通過；本機針對性重跑亦曾重現，延長時間不能視為已修正。

使用者要求聚焦部署後，流程收斂為型別、正式設定、建置、dry-run、D1 migrations、部署及公開 HTTPS smoke，不再將完整產品 E2E 綁入每次發布。沒有修改產品或既有測試斷言。收斂後的 3 個部署契約測試通過，actionlint 與規格文件檢查通過。

## 實際發布成功

提交 `435a695` 推送 `master` 自動觸發 [成功執行](https://github.com/TonyPepeBear/p-note/actions/runs/38558648192)，run 與 deploy job 的結論皆為 `success`。型別、正式設定、建置、dry-run、D1 migrations、Worker 發布及正式 HTTPS smoke 全部通過。

正式 Worker 版本為 `f4b29957-c395-4aae-9215-a11733378e7c`。最小證據：`migrationExecuted: true`、`smokePassed: true`。報告不保存平台原始回應或憑證值。後續純紀錄提交使用 `[skip ci]` 避免相同程式重複發布。

公開 smoke 只驗證 HTTPS、建置 script、私人 API 與測試入口限制，不涵蓋正式寄信或登入後同步；上述完整產品回歸失敗仍保留，未宣稱已修正。
