# 我的圖片驗證

## Red

- Workers：`npm run test:integration -- tests/workers/assets.test.ts`，既有 5 項通過，新增 ASSET-06／07／09 因 `GET /api/assets` 回 404 而失敗。
- Chromium 桌面：`npm run test:e2e:fast -- tests/e2e/my-images.spec.ts --grep ASSET-09`，登入成功後因工作區沒有「我的圖片」入口而失敗。首次使用已下載的完整 Chromium 執行，暫存 config 位於被忽略的 reports 目錄。
- 缺少 npm 套件與瀏覽器 libraries 的環境失敗不列為 Red。

## Green 與回歸

- Workers 私有圖片：8／8 通過；驗證登入與 owner 隔離、純 D1 清單、同時間排序、完整分頁、參數與安全整數限制、空集合、列表層 D1 故障與重試。
- Chromium 桌面：首次 5／5 通過；新增麵包屑返回與保存延遲換頁情境後 6／6 通過。
- 型別、正式設定檢查通過；Vite 建置及真正 HTTPS dist 的登入、wss 儲存、離線刷新 2／2 冒煙測試通過。
- `npm run test:e2e -- tests/e2e/assets.spec.ts tests/e2e/my-images.spec.ts`：Chromium 桌面、Chromium 手機、WebKit 手機共 33／33 通過。
- 同一輪產品驗收的 `settings-navigation.spec.ts`／`backup.spec.ts` 三瀏覽器共 24／24 通過，涵蓋還原鎖定與操作失敗提示。
- 首輪圖片驗收出現測試重複點擊已自動關閉的手機抽屜，以及 WebKit Service Worker 繞過 Playwright route 的故障注入差異；改為等待抽屜關閉，並損毀隔離 R2 fixture、斷言真實讀取 503 後重跑圖片驗收通過。未因此修改產品行為。
- `npm run test:spec-coverage -- --assets`：26／26 必需結果通過；`npm run check:spec`、`openspec validate my-images --strict` 通過。
- 已整合 master 的資料庫 revisions 與頁面版本歷史，圖片索引使用 `0011_asset_listing.sql`，避免遷移編號衝突。圖片切換也遵守版本歷史與還原導覽鎖定，發現待恢復操作會關閉圖片頁並取消過期切換。
- 最終整合驗收：`assets.spec.ts`、`my-images.spec.ts`、`settings-navigation.spec.ts`、`backup.spec.ts`、`history.spec.ts` 三瀏覽器共 81／81 通過；圖片與歷史 Workers 共 20／20 通過。型別、圖片／歷史規格覆蓋、正式設定及規格檢查均在整合後通過。

## 測試環境與範圍

使用本機隔離 D1／R2、測試登入帳號及固定圖片 fixture，不存正式筆記、cookie、token、登入郵件或平台原始回應。僅保存命令、結果及必要斷言描述。

npm cache、Wrangler logs、Playwright browsers 與 Debian WebKit 相依 libraries 均放在 /tmp。WebKit 實際 headless 啟動與 ldd 已驗證；Playwright 的 ldconfig 檢查不識別暫存 libraries，使用 LD_LIBRARY_PATH 載入它們。

手機驗收為 Chromium／WebKit 模擬，包含 390px 長檔名無水平溢出。列表以既有私有原圖呈現 lazy 縮圖；不另做圖片轉換或離線快取。
