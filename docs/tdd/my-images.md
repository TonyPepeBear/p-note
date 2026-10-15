# 我的圖片驗證

## Red

- Workers：`npm run test:integration -- tests/workers/assets.test.ts`，既有 5 項通過，新增 ASSET-06／07／09 因 `GET /api/assets` 回 404 而失敗。
- Chromium 桌面：`npm run test:e2e:fast -- tests/e2e/my-images.spec.ts --grep ASSET-09`，登入成功後因工作區沒有「我的圖片」入口而失敗。首次使用已下載的完整 Chromium 執行，暫存 config 位於被忽略的 reports 目錄。
- 缺少 npm 套件與瀏覽器 libraries 的環境失敗不列為 Red。

## Green 與回歸

- Workers 私有圖片：8／8 通過；驗證登入與 owner 隔離、純 D1 清單、同時間排序、完整分頁、參數與安全整數限制、空集合、列表層 D1 故障與重試。
- Chromium 桌面：首次 5／5 通過；新增麵包屑返回與保存延遲換頁情境後納入最終三瀏覽器驗收。
- 型別、正式設定檢查通過；Vite 建置及真正 HTTPS dist 的登入、wss 儲存、離線刷新 2／2 冒煙測試通過。
- 最終三瀏覽器圖片、設定與備份導覽驗收尚待完成；完成後更新本紀錄並封存 OpenSpec。

## 測試環境與範圍

使用本機隔離 D1／R2、測試登入帳號及固定圖片 fixture，不存正式筆記、cookie、token、登入郵件或平台原始回應。僅保存命令、結果及必要斷言描述。

npm cache、Wrangler logs、Playwright browsers 與 Debian WebKit 相依 libraries 均放在 /tmp。WebKit 實際 headless 啟動與 ldd 已驗證；Playwright 的 ldconfig 檢查不識別暫存 libraries，使用 LD_LIBRARY_PATH 載入它們。

手機驗收為 Chromium／WebKit 模擬，包含 390px 長檔名無水平溢出。列表以既有私有原圖呈現 lazy 縮圖；不另做圖片轉換或離線快取。
