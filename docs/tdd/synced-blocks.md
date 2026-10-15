# 同步區塊開發與驗收

日期：2026-10-15（台北）。OpenSpec change：`add-synced-blocks`。本文件目前保留有效 TDD 證據；最終統一驗收、封存與發布結果尚待補記，不宣稱全部需求已通過。

## 規格與環境

需求分為 `SB-01`～`SB-22`，涵蓋建立與引用、持久保存、離線、解除同步與保留、引用管理、搜尋與反向連結、權限、備份還原、API／MCP，以及手機鍵盤與中文選字。工具與斷言以 [同步區塊規格](../../openspec/changes/add-synced-blocks/specs/synced-blocks/spec.md) 為準；[MCP 規格變更](../../openspec/changes/add-synced-blocks/specs/codex-plugin/spec.md) 將工具由 10 個擴充為 12 個。

規格先提交為 `da5bc7d`，MCP 契約與覆蓋追蹤補充提交為 `b6e8371`。本機 Node 為 `v24.19.0`、npm 為 `11.9.0`，套件版本沿用鎖檔。瀏覽器以 `PLAYWRIGHT_BROWSERS_PATH=/tmp/p-note-browsers` 執行；Wrangler 暫存設定使用 `XDG_CONFIG_HOME=/tmp/p-note-wrangler`。

同一 checkout 只保留一組 E2E 常駐服務；多瀏覽器測試由既有 worker port／資料目錄隔離。後端檔案更新會重載服務，因此可重現驗收只採用來源穩定且沒有其他 runner 共同 reset 的執行。

## 有效 Red 與已確認 Green

| 範圍 | 命令與版本 | 實際結果 |
| --- | --- | --- |
| 同步區塊建立、授權及備份入口 Red | `npm run test:integration -- tests/workers/synced-blocks.test.ts tests/workers/backup-synced-blocks.test.ts`；`118aef8` 加未提交測試及 migration | 退出碼 1；6 個案例因 `POST /api/synced-blocks` 預期成功、實際 404 失敗；耗時 58.05 秒。此為功能入口缺失的有效 Red。 |
| 搜尋與反向連結 Red | `XDG_CONFIG_HOME=/tmp/p-note-wrangler npm run test:integration -- tests/workers/synced-discovery.test.ts`；`118aef8` 加未提交測試 | 退出碼 1；`SB-13` 搜尋預期 2 頁、實際空陣列，`SB-14` 反向來源預期 2 頁、實際 1 頁；2 個案例失敗，耗時 12.37 秒。 |
| 搜尋與反向連結 Green | 同上命令；`da5bc7d` 加未提交實作 | 退出碼 0；2 個案例通過，耗時 19.13 秒。 |
| 單一同步區塊 UI 初次執行 | `PLAYWRIGHT_BROWSERS_PATH=/tmp/p-note-browsers XDG_CONFIG_HOME=/tmp/p-note-wrangler npm run test:e2e:fast -- tests/e2e/synced-blocks.spec.ts --grep 'SB-01：單一區塊'`；`da5bc7d` 加未提交實作與測試 | 退出碼 0；1 個 Chromium 桌面案例通過，總耗時 8.8 秒。當時功能已存在，不能把此結果記為 Red。 |

依賴安裝前的環境錯誤不列為有效 Red。UI 第一輪單檔曾通過單一轉換、多選轉換及斜線建立 3 個案例，其後混入開發服務重載與重複 runner 的 reset，整輪不作最終驗收，也不把逾時、401 或登入限流列為產品缺陷的有效 Red。

非 TTY 的工具中斷曾只結束外層命令，留下 Playwright 子行程；發現後已明確終止兩個 runner，並確認沒有持續執行的測試子行程。後續統一驗收須由單一 runner 執行。原始瀏覽器診斷可能含測試 session cookie，因此本文件只保留命令、版本、退出碼、數量與必要斷言摘要，不提交原始網路回應或敏感 trace。

乾淨環境後另取得兩個有效 UI Red。第一個是 API 保留引用節點 ID、切換同步目標時，y-prosemirror 還原已不存在的 NodeSelection 位置而拋錯；修正只在非中文選字中的遠端節點選取使用安全位置還原，並以同步 ID／世代作為內層編輯器 key。第二個是同頁兩個引用共用 awareness，焦點編輯器寫入游標、另一個引用清除游標，形成訊息互送；測試階段計數曾顯示 7,943 筆進入、823 筆完成。內層省略只負責協作游標的 provider 選項，保留共用 Yjs 文件與實際同步連線，完整目標切換案例遂於 4.9 秒通過。臨時診斷計數、路由及階段紀錄已移除。

測試 runtime 也改為每次建立資料庫只初始化一次結構，避免引用清單輪詢重跑全部 DDL；Workers reset 清空結構後仍重新初始化。這是測試環境改善，不能取代上述實際游標迴圈的修正。

## 主分支整合

驗收期間主分支新增版本歷史、圖片清單、資料庫更新與頁面選單，已整合至 `0df0e10`。同步區塊 migration 改為 `0012_synced_blocks.sql`，保留既有遷移順序。同步文件跳過頁面歷史 hooks；歷史預覽使用獨立靜態引用呈現器，單頁還原前驗證引用，連線同時核對同步正文與引用頁世代。新增 Workers 與瀏覽器相容性斷言，最終驗收以整合後來源為準。

可讀匯出另取得有效 Red：`SB-16` fixture 加入已完成清單後，預期 `- [x]`、實際 `- [ ]`。原因是 Yjs 保存布林 `true`，呈現器只比較字串；正規化後 `backup-synced-blocks.test.ts` 全 4 個案例通過，耗時 13.56 秒。合併標記曾造成編譯阻擋、零案例執行，未計為產品 Red。

嚴格 XML 驗證補上未知節點與損壞結構的拒絕斷言。`SB-06` 原 fixture 將獨立新文件直接合併進既有引用頁，形成兩個根節點；固定來源的首輪結果為 160 個通過、此 1 個失敗。測試改成先載入持久 Yjs 狀態，再替換正文，沿用實際編輯歷史，產品驗證未放寬。最終結果以下表最後一次執行為準。

## 測試實作與覆蓋契約

[Playwright 案例](../../tests/e2e/synced-blocks.spec.ts) 共 17 個案例，涵蓋 14 個需要瀏覽器驗證的 SB ID；使用真實巢狀編輯器、WebSocket、隔離 context、IndexedDB 與離線刷新。剪貼簿只替代 OS 邊界，複製按鈕及 paste 事件仍走產品程式。協作游標標籤不屬於正文，精確文字比較會排除該顯示元件。

[覆蓋檢查](../../scripts/spec-coverage.mjs) 的 `--synced-blocks` 直接讀取規格方法，要求 14 個 Workers 結果及 14 個 SB ID 在三種瀏覽器的結果，目前共 56 個必要環境結果。此數量由規格計算，沒有硬寫歷史情境總數；未執行、skip、失敗、缺少層級或缺少瀏覽器皆不能算通過。同一標題可列多個 ID，解析器逐一記錄，參數化案例須全部通過。

MCP API 的 Workers 案例透過真正 HTTP transport 呼叫工具，檢查同步正文讀寫、ETag、唯讀 scope、撤銷及頁面引用操作。OAuth 及 12 個工具發現另由既有 plugin E2E 驗證；額外通過的案例不取代規格指定環境。

## 最終統一驗收

下列結果待單一穩定來源執行後補記；目前不標示通過：

| 驗證 | 命令 | 結果 |
| --- | --- | --- |
| Workers 行為及回歸 | `npm run test:integration` | `b6e8371` 加本次實作；24 檔、132 個案例通過，退出碼 0，報告 `reports/integration.json`。 |
| 單元回歸 | `npm run test:unit` | `b6e8371` 加本次實作；5 檔、8 個案例通過，退出碼 0。 |
| 相關 Chromium 桌面 Green／Refactor | `npm run test:e2e:fast -- tests/e2e/synced-blocks.spec.ts` | 待補穩定來源結果 |
| 三瀏覽器相關功能驗收 | `npm run test:e2e -- tests/e2e/synced-blocks.spec.ts tests/e2e/synced-blocks-api.spec.ts tests/e2e/plugin.spec.ts` | 待補實際執行範圍、數量與退出碼 |
| 同步區塊必要環境覆蓋 | `npm run test:spec-coverage -- --synced-blocks` | 待補；不得以測試存在或 `--list` 代替執行報告 |
| 型別、建置與文件契約 | `npm run check`、`npm run build`、`npm run check:spec`、`git diff --check` | 規格／文件檢查已通過；最終實作版本尚待統一補記 |
| OpenSpec | `openspec validate add-synced-blocks --strict` | 開發規格嚴格驗證通過；封存後尚待驗證主規格 |

手機僅為 Chromium／WebKit 裝置模擬；中文使用 composition／beforeinput／input fixture 與游標斷言，未宣稱操作實際 OS 輸入法或軟鍵盤。儲存與權限測試使用本機 Workers runtime，不以原生裝置或正式 Cloudflare 手動操作作為驗收門檻。

## 封存與發布

待全部需求與自動化驗收通過後，依專案規則封存 change、同步主規格並提交，再完成 PR、合併與確認 GitHub Actions 遷移／發布結果。此處尚無已完成發布的聲明。
