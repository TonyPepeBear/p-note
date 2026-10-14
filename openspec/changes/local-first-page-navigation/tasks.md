# Tasks

## 1. 本機優先載入與切頁

- [ ] 1.1 Red：在 `tests/e2e/local-first.spec.ts` 加入 LFN-02～04 的請求屏障、本機正文／索引 fixture、今日日期與已知登入失效案例，執行 `npm run test:e2e:fast -- tests/e2e/local-first.spec.ts`，記錄因等待 API 或快取處理缺失而失敗的斷言；保留 UX-21、UX-22 回歸。
- [ ] 1.2 Green：調整 `main.tsx`、`page-cache.ts` 與 `editor.tsx`，讓有效本機文件先可編輯、驗證前 provider 不連線，無快取或損毀時正確回退；先將版本查詢移出 `navigate` 的路由阻塞路徑。用同組 Chromium 測試確認 500 毫秒 fixture、網路釋放前本機保存、回退與日期行為。
- [ ] 1.3 Refactor：整理 scope／下載判定與載入狀態，重跑同組測試及 `npm run test:e2e:fast -- tests/e2e/spa-navigation.spec.ts` 的 UX-16～19 相關案例；於 `docs/tdd/local-first-page-navigation.md` 記錄本組命令、退出碼、Red 原因及 Green／Refactor 報告，不將尚未更新的 UX-20 當成完成。

## 2. 背景驗證與草稿保護

- [ ] 2.1 Red：於 `local-first.spec.ts` 加入 LFN-05、06 參數案例，涵蓋驗證期間輸入、無效權限／版本、暫時 500／斷線與恢復；以 `npm run test:e2e:fast -- tests/e2e/local-first.spec.ts` 記錄有效 Red，斷言驗證前無同步傳輸且伺服器內容未被污染。
- [ ] 2.2 Green：共用首次驗證結果與同步開關，明確失效時先保留當下草稿再停止編輯，暫時失敗允許本機寫作及重試；驗證成功保留編輯器節點、焦點與選取。以同組測試確認持久保存及新 context 正文，並注入本機保存失敗確認不銷毀未保存 doc。
- [ ] 2.3 Refactor：整理驗證／離線／阻擋狀態與重試生命週期，重跑相關 Chromium E2E，將本組 TDD 報告與失效處理結果加入 `docs/tdd/local-first-page-navigation.md`，核對所有 LFN-05、06 參數皆有機器斷言。

## 3. 背景版本檢查與導覽競爭

- [ ] 3.1 Red：更新 `spa-navigation.spec.ts` 的 UX-20，加入 LFN-01、07，涵蓋新版查詢期間輸入、保存失敗、亂序驗證／版本回應與連續換頁；執行 `npm run test:e2e:fast -- tests/e2e/spa-navigation.spec.ts` 並記錄正確原因的失敗。
- [ ] 3.2 Green：背景發現新版後保存當下草稿再載入最新目標，處理保存期間輸入邊界與錯誤；為本機開啟、頁面 API、驗證及版本回應加上導覽生命週期檢查，過期資源清理且上一頁／下一頁不遺失草稿。以同組測試確認目標、內容、記憶體標記與最多一條有效連線。
- [ ] 3.3 Refactor：合併必要的取消與清理流程，重跑 `npm run test:e2e:fast -- tests/e2e/local-first.spec.ts tests/e2e/spa-navigation.spec.ts`，將本組 TDD 報告與競爭測試結果補入 `docs/tdd/local-first-page-navigation.md`。

## 4. 整合驗收與交付

- [ ] 4.1 執行 `npm run check`、`npm run build` 與完整 `npm run test:e2e` 三瀏覽器驗收，確認既有登入、離線、還原隔離與 UX-16～22 回歸通過；記錄未執行／失敗不得標為完成。
- [ ] 4.2 執行 `openspec validate local-first-page-navigation --strict`、`git diff --check`，以自動文件檢查比對 UX-20～22、LFN-01～07 情境與實際報告，確認 TDD 文件命令、退出碼及結果完整。
- [ ] 4.3 實作驗收通過後依專案 Cloudflare 部署流程部署，執行自動 smoke 驗證並記錄部署版本；自動提交相關實作與報告，以 `git show --stat` 確認提交範圍。此項只在使用者後續啟動 apply 後執行。
