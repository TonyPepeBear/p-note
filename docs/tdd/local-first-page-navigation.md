# 已下載頁面本機優先導覽 TDD 報告

規格見 [OpenSpec change](../../openspec/changes/archive/2026-10-14-local-first-page-navigation/proposal.md)。所有 Red／Green／Refactor 皆以 Chromium 桌面執行 `npm run test:e2e:fast -- tests/e2e/local-first.spec.ts tests/e2e/spa-navigation.spec.ts`，最後以三瀏覽器驗收。

## 實作摘要

- `main.tsx`：不在 `draft`、`p-note-load-current` 或已知登出狀態時，先以 `cachedPage()` 定位本機頁面並 `start(..., localOnly)` 開啟；正文未下載會丟出錯誤並回退雲端載入。今天入口沿用既有 Asia/Taipei 日期索引，沒有今天的對應就走 `/api/today`。
- 首次驗證只由 `Editor` 連線前的 `checkAccess` 執行，provider 在驗證通過前保持未連線。成功時更新並記住頁面資訊，不重建編輯器；401、刪除／無權限、擁有者或世代不符時先斷線並保存目前 doc 再停止編輯，保存失敗只顯示錯誤、不卸載 doc。暫時失敗沿用既有重試退避。
- `api.ts`：收到 401 或登出成功時記錄已知登出，之後頁面 API 成功才清除；`navigate()` 保存草稿後立即換頁，版本查詢改在背景，發現新版時鎖住編輯器、保存目前草稿，再依最新導覽序號以目前網址整頁載入；保存失敗恢復編輯並顯示錯誤。

## Red

[lfn-red.log](lfn-red.log)，exit 1，13 個失敗皆因等待網路：

- LFN-02：版本與頁面請求被攔住時，5000 毫秒內未切到乙頁（門檻 500）。
- LFN-03：上一頁及重新整理、今天入口在頁面 API 回應前沒有編輯器。
- LFN-05：重新整理後驗證被攔住，已下載頁面沒有開啟，無法在驗證前輸入。
- LFN-06：驗證恢復後沒有更新遠端標題。
- UX-20、LFN-01：版本查詢未回應時沒有換頁。

LFN-04 四個參數與 LFN-07 在舊版即通過，屬保護既有行為的回歸情境；LFN-07 另加上「目標頁驗證請求仍被攔住」的斷言，避免舊版因根本沒換頁而通過。

## Green

第一輪 23／24 通過；今天入口的失敗是測試誤以為本機優先仍會呼叫 `/api/today`，改為斷言頁面驗證請求被攔住後通過。

## Refactor 與回歸

Chromium 桌面完整回歸發現 4 個失敗並修正：

- 垃圾桶頁背景驗證改顯示伺服器訊息（ASSET-04、PAGE-07）。
- SYNC-RECONNECT-03 原斷言 401 時完全不出現編輯器，與本變更設計衝突；改為未知失效時背景驗證後顯示登入且不可編輯，再次重新整理（已知登出）不開啟快取。
- LFN-07 在負載下超過版本查詢 1.5 秒逾時；測試 gate 攔住的請求改為慢但成功的回應，不受呼叫端逾時中止。

覆蓋腳本新增 LFN ID，同 ID 不同標題視為參數化案例並要求全部通過，相同標題仍判重複（[單元](lfn-unit.log)）；文件契約登記 LFN-01～07。LFN-05 另加 Workers 整合測試確認伺服器可分辨登入到期、刪頁、還原版本且舊世代同步被拒，屬既有伺服器行為的保護測試。

## 最終驗收

| 檢查 | 結果 |
| --- | --- |
| [型別](lfn-check.log) | exit 0 |
| [建置](lfn-build.log) | exit 0 |
| [三瀏覽器 E2E](lfn-full-e2e.log) | 291 passed，exit 0 |
| [單元](lfn-unit.log) | 6 passed |
| [Workers](lfn-integration.log) | 104 passed |
| [建置 HTTPS smoke](lfn-build-smoke.log) | 2 passed |
| 情境覆蓋 | [UX](lfn-ux-coverage.log) 97／97、[UI](lfn-ui-coverage.log) 18／18、[產品](lfn-product-coverage.log) 129／129 |
| [文件契約](lfn-contract.log) | exit 0 |
| [OpenSpec 嚴格驗證](lfn-openspec.log)、`git diff --check` | 通過 |

LFN-02 的 500 毫秒門檻只對 20 個短段落、無圖片的受控 fixture 成立，不宣稱所有裝置的延遲保證。
