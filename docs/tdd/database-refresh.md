# 資料庫條件更新與檢視併發

change：optimize-database-refresh。規格先提交為 `34c0786`，使用假資料驗證；不保存原始認證標頭、登入連結或瀏覽器 trace。

## Red

- 新增 Workers 測試首輪共 5 項，4 項以預期原因失敗：GET 沒有 ETag；不同檢視併發結果為 `[200, 409]`，預期 `[200, 200]`。
- 新增瀏覽器條件更新情境，原前端沒有傳送版本標頭，恢復可見後取得 200 而非條件回應。
- 初始環境缺少既有 MCP／OAuth 套件及瀏覽器，啟動錯誤不計為 Red；依 lockfile 使用 npm 11.21.0 安裝後才進行行為驗證。

## Green 與 Refactor

- D1 trigger 追蹤父頁、直接子列、世代、正文更新時間及操作可見性；無效 UPDATE 不增加版本。
- 304 路徑只有祖先／版本查詢，不讀取子列。200 的版本與資料以同一 batch 快照讀取。
- 不同檢視以三方合併保存；同檢視衝突、無效欄位引用、已刪列的欄位相容性及驗證後競爭寫入均受保護。純檢視修改不掃描子列屬性。
- 前端入口拆至 272 行，獨立表格、欄位輸入、檢視設定、欄位管理及讀取 hook；背景暫停、恢復補讀、慢速請求去重、保存後刷新及草稿版本採用皆有處理。
- 回歸發現關閉檢視表單時，舊草稿短暫搭配空設定而觸發例外，已以有效 session 條件修復，既有 DB-05 篩選／排序驗收保留。
- 新增兩端開啟表單的驗收，使用檢視選擇器操作；最初的角色選擇器錯誤不計為產品 Red。

## 自動化驗證

| 命令／範圍 | 結果 |
| --- | --- |
| `npm run test:unit` | 8 項通過 |
| `npm run test:integration -- tests/workers/databases.test.ts` | 9 項通過 |
| `npm run test:integration -- tests/workers/pages.test.ts` | 9 項通過 |
| `npm run test:integration -- tests/workers/restore.test.ts` | 9 項通過 |
| Wrangler 本機空資料庫遷移 | 0001～0009 全部成功，包含完整 CREATE TRIGGER parser |
| `npm run test:build` | 建置及 2 項 smoke 通過 |
| `npm run check`、`npm run check:production` | 通過 |
| `npm run test:e2e -- tests/e2e/databases.spec.ts` | 三瀏覽器 48 項全部通過（各 16 項） |

上述最終成功命令退出碼均為 0；Red 命令退出碼為 1。完整驗收包含 DB-01～DB-12，另有大型中文、慢速讀取及跨裝置草稿案例。封存後 `check:spec` 通過，OpenSpec 主規格嚴格檢查 14 項全過；`test:spec-coverage -- --databases` 必需結果 38／38 通過。

change 已封存至 [2026-10-15-optimize-database-refresh](../../openspec/changes/archive/2026-10-15-optimize-database-refresh/tasks.md)，並同步 [主規格](../../openspec/specs/note-databases/spec.md)。

## 瀏覽器驗證邊界

使用 Chromium 桌面／手機與 WebKit 手機模擬。WebKit 會把重新驗證 304 呈現為快取 200；UI 驗收因此斷言 If-None-Match、相同 ETag 及網路本文 0 bytes，API 驗收仍嚴格斷言 304 與空本文。

本機瀏覽器及缺少的 Debian shared libraries 放在 `/tmp`，未修改專案依賴或系統。因 Playwright 的 DLOPEN 檢查只查系統 ldconfig、不認得局部函式庫路徑，先以 ldd、實際 CDLL 載入及隔離 WebKit 啟動確認，再設定 `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1` 執行完整瀏覽器斷言。重現此環境時同時設定 `PLAYWRIGHT_BROWSERS_PATH=/tmp/p-note-browsers`、`LD_LIBRARY_PATH=/tmp/p-note-webkit-deps/root/usr/lib/x86_64-linux-gnu`、`XDG_CONFIG_HOME=/tmp/p-note-config`；這些僅是本機執行位置。

WebSocket 推播維持後續方向；資料庫目前沒有正文編輯器的 WebSocket 訂閱，取消輪詢尚需完整事件通知、可靠交付與重連補讀。
