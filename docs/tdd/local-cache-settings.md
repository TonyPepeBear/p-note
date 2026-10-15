# 設定頁本地快取用量

## Red
- 產品基準：`118aef8`；先提交規格，尚未修改產品程式時新增 UI-11 E2E。
- 命令：`npm run test:e2e:fast -- tests/e2e/local-cache-settings.spec.ts --grep '總量與完整'`。
- 退出碼 1，1 個案例因找不到「本地快取」region 而失敗，符合預期缺陷。
- 最初測試服務啟動發現預裝依賴不完整；先以 `npm ci` 同步 lockfile 後才取得上述 Red，此環境錯誤不算 Red。

## Green 與 Refactor
- 命令：`npm run test:e2e:fast -- tests/e2e/local-cache-settings.spec.ts tests/e2e/settings-navigation.spec.ts`。
- 退出碼 0，13／13 通過，耗時 27.6 秒。
- UI-11 的 9 個案例覆蓋完整／無／部分分項、零用量、缺少 storage／estimate、拒絕回應、缺少總量、載入及重新進入設定更新用量；另有 4 個設定導覽錯誤回歸案例。
- Refactor 將可顯示狀態的 usage／quota 型別收斂成必要數字，移除非空斷言；保留有效零值，未知分項不推定為零。
- `npm run check`、`npm run check:spec`、`openspec validate add-local-cache-settings --strict` 與 `git diff --check` 均退出碼 0。

## 主線整合
- 驗收期間發現遠端主線已前進至 `961ada2`，停止舊基準的完整執行並 rebase 至該版本。
- 保留主線的 HIST／ICON 等規格檢查，另新增 UI-11，唯一規格情境由 145 增為 146。
- 整合後 `npm run check` 與 `npm run check:spec` 再次通過；完整驗收使用整合後版本。
- 完整執行發現 WebKit 在兩個 UI-11 案例中改顯示原生估計值，測試注入的 estimate 替身隨原生包裝物件被回收而遺失。測試改為在初始化時以 navigator 自有屬性保留 storage 物件；產品行為與斷言不變。

## 完整驗收
- `npm run test:e2e`：完整執行 600 個案例（每個瀏覽器專案 200 個），首輪 590 通過、10 個 WebKit 案例失敗，退出碼 1，24.3 分鐘。
- 首輪失敗包括 2 個上述 UI-11 測試替身問題、6 個既有案例超過 20 秒、LINK-01 既有斷言失敗，以及 UI-CREATE-05 量測到 43.999984px、未達 44px 斷言。
- `E2E_WORKERS=1 npm run test:e2e -- --last-failed`：10／10 通過，退出碼 0，1.3 分鐘。未修改既有案例、時間上限或產品斷言。
- 以（檔案、測試名稱、瀏覽器專案）合併實際 JSON 報告的最新結果，得到完整 600／600 通過、無 skip；每個專案 200 個，UI-11 每個專案各 9 個。這是完整首輪加針對失敗的修正與回歸，不宣稱單輪全綠。
- `E2E_WORKERS=1 npm run test:e2e -- tests/e2e/local-cache-settings.spec.ts`：調整測試替身後，三瀏覽器完整 UI-11 共 27／27 通過，退出碼 0，1.3 分鐘。再合併這輪結果仍為 600／600 通過。

## 環境
- 測試使用 `XDG_CONFIG_HOME=/tmp/p-note-config`、`PLAYWRIGHT_BROWSERS_PATH=/tmp/p-note-browsers`。
- WebKit 缺少的系統函式庫從環境既有 Debian snapshot 來源下載至 `/tmp`，解開至本次瀏覽器的本機函式庫目錄。
- 以實際 WebKit 啟動及渲染斷言確認可執行；`PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1` 僅略過系統快取預檢，保留所有瀏覽器與產品斷言。
