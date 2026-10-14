# PWA 開發驗收

日期：2026-10-14。OpenSpec change：`implement-pwa`。

## TDD

- 有效 Chromium Red：PWA-02 等不到「安裝 p-note」按鈕，因原版尚未提供安裝介面而逾時。
- 有效單元 Red：PWA-05 發現舊版 Service Worker 攔截 `/health`，未採公開靜態資源白名單。
- 瀏覽器尚未下載與 Wrangler 嘗試寫入不可寫的預設設定目錄造成的啟動失敗，不列為有效 Red。測試設定、日誌與瀏覽器改放暫存目錄後重跑。
- Chromium Green：manifest、PNG 尺寸、原生安裝取消、替代說明、standalone、登入前離線重開、已下載筆記草稿與未知筆記保護均通過。
- 更新驗證包含替身斷言（保存成功才送啟用訊息、IndexedDB 失敗時不啟用且恢復編輯），以及真實 Service Worker 預快取→waiting→套用→重新載入，斷言正文保留、其他分頁記憶體標記不變。

## 執行環境

瀏覽器使用 `PLAYWRIGHT_BROWSERS_PATH=/tmp/p-note-browsers`，Wrangler 使用 `XDG_CONFIG_HOME=/tmp/p-note-config` 與 `WRANGLER_LOG_PATH=/tmp/p-note-logs`。WebKit 的公開 Debian 相依套件只下載、解壓到暫存目錄，並放入暫存 browser bundle 的 `sys/lib`；不修改系統套件。預檢無法從系統 ldconfig 找到暫存 GLES 函式庫，先以實際 WebKit 啟動並讀取 `about:blank` 的 readyState 斷言成功，再以 `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1` 執行真實瀏覽器測試。

完整產品驗收命令：

```sh
XDG_CONFIG_HOME=/tmp/p-note-config WRANGLER_LOG_PATH=/tmp/p-note-logs \
PLAYWRIGHT_BROWSERS_PATH=/tmp/p-note-browsers \
PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 E2E_WORKERS=4 npm run test:e2e
```

單元測試 8 個、Workers 測試 107 個、型別、正式設定、文件契約（117 個唯一情境）與 change 嚴格驗證通過。

完整三瀏覽器共 372 項，361 項通過，11 項既有 WebKit 長流程在四個 worker 並行時碰到整體 20 秒上限，沒有 skip；PWA 的 21 項在這輪全部通過。保留完整報告後，以 `E2E_WORKERS=1 npm run test:e2e -- --last-failed` 重跑，11 項全部通過，沒有提高測試時間上限或修改既有產品功能。原先逾時的圖片多格式上傳、本機優先開啟與換頁、日期、垃圾桶與復原流程皆已完成驗證；不宣稱第一輪為全綠。

最後補上訂閱後重新讀取 waiting 狀態，並讓雜湊靜態資源優先使用快取，確保仍開啟的分頁不依賴已從伺服器移除的舊檔。單元斷言確認命中舊版雜湊資源時完全不發送網路請求；最終建置另執行 PWA 三瀏覽器與 HTTPS smoke 驗證。

最終 PWA 三瀏覽器 21 項全部通過，`npm run test:spec-coverage -- --pwa` 的 17 個必需環境結果全部通過；真實 dist 的 HTTPS Worker、wss、離線刷新與分析 POST smoke 2 項全部通過。最小且已去除原始頁面／登入資料的 [驗證摘要](pwa-results.json) 由自動化報告產生。

## 封存與發布

完成驗證後將 change 封存並同步 [PWA 主規格](../../openspec/specs/progressive-web-app/spec.md)，再提交與合併 PR。交付前同步了主分支的 hover 配色與取消發布後檢查變更，移除本輪原先準備的正式入口檢查擴充，保留最新 CICD-03 與發布規則；主規格契約更新為 121 個唯一情境。

整合後以單一 worker 執行 `pwa.spec.ts`、`hover-colors.spec.ts` 與 `deployment.spec.ts`，三瀏覽器 42 項全部通過（PWA 21、hover 12、發布契約 9），本機 HTTPS 建置 smoke 再跑 2 項通過；型別、PWA 覆蓋、正式設定與 13 份主規格嚴格驗證通過。

正式發布沿用 master 的 GitHub Actions；確認資料遷移與發布結果後結束，不執行額外正式網站 HTTP 檢查、不在本機重複部署或重新執行整套產品 E2E。
