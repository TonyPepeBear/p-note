# 同步區塊開發與驗收

日期：2026-10-15（台北）。OpenSpec change：`add-synced-blocks`。本文件保留有效 TDD 證據、失敗與中止的執行範圍，以及最終自動化驗收；不將多輪結果混稱為單次完整通過。

## 規格與環境

需求分為 `SB-01`～`SB-22`，涵蓋建立與引用、持久保存、離線、解除同步與保留、引用管理、搜尋與反向連結、權限、備份還原、API／MCP，以及手機鍵盤與中文選字。工具與斷言以 [同步區塊規格](../../openspec/specs/synced-blocks/spec.md) 為準；[MCP 規格變更](../../openspec/specs/codex-plugin/spec.md) 將整合後主分支的 11 個工具擴充為 13 個。

規格先提交為 `da5bc7d`，MCP 契約與覆蓋追蹤補充提交為 `b6e8371`。本機 Node 為 `v24.19.0`、npm 為 `11.9.0`，套件版本沿用鎖檔。瀏覽器以 `PLAYWRIGHT_BROWSERS_PATH=/tmp/p-note-browsers` 執行；Wrangler 暫存設定使用 `XDG_CONFIG_HOME=/tmp/p-note-wrangler`。

同一 checkout 只保留一組 E2E 常駐服務；多瀏覽器測試由既有 worker port／資料目錄隔離。後端檔案更新會重載服務，因此可重現驗收只採用來源穩定且沒有其他 runner 共同 reset 的執行。

本機 CPU quota 為 4 核。整合後四工 E2E 的既有登入與備份案例曾達 20 秒逾時，改為兩工後於 407 個案例執行完成時中止：402 通過、5 個逾時；其中桌面 197/197、Chromium 手機 196/197。接著 WebKit 單工完整執行 197 個案例，192 通過、5 失敗，退出碼 1；確認多選時浮動工具列遮住同步按鈕，其餘失敗另以隔離執行與最終輪次復驗。未將中止或失敗的執行宣稱為完整通過，並沿用既有 timeout 與 `retries: 0`。

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

後續整合 `961ada2` 的頁面圖示及 `11a8e7f` 的快取用量設定，最終產品提交為 `55707df`。同步區塊 migration 順延為 `0013_synced_blocks.sql`；MCP 合併圖示工具後為 13 個。備份還原保留可選圖示與共同世代切換；內層筆記連結加入圖示裝飾，圖示選擇事件限制於來源編輯器，避免同頁多個視圖同時開啟對話框。

可讀匯出另取得有效 Red：`SB-16` fixture 加入已完成清單後，預期 `- [x]`、實際 `- [ ]`。原因是 Yjs 保存布林 `true`，呈現器只比較字串；正規化後 `backup-synced-blocks.test.ts` 全 4 個案例通過，耗時 13.56 秒。合併標記曾造成編譯阻擋、零案例執行，未計為產品 Red。

嚴格 XML 驗證補上未知節點與損壞結構的拒絕斷言。`SB-06` 原 fixture 將獨立新文件直接合併進既有引用頁，形成兩個根節點；固定來源的首輪結果為 160 個通過、此 1 個失敗。測試改成先載入持久 Yjs 狀態，再替換正文，沿用實際編輯歷史，產品驗證未放寬。最終結果以下表最後一次執行為準。

WebKit 完整驗證取得手機操作的有效 Red：多選時，官方浮動格式列遮住上方同步按鈕，轉換請求尚未送出；窄畫面改為內容下方顯示後，多選案例通過。另由 trace 確認保存文案從「同步中」變成「雲端已儲存」時，手機工具列換行造成 44px 的捲動偏移；固定保存狀態為獨立一列後，保留原本 4px 容差的往返斷言通過。

SB-03 新增圖示流程曾誤點既有筆記連結而導航離頁，改為將原生文字選取移至段落尾端後使用真正鍵盤。SB-21 補上對話框關閉完成的等待，並在頁面層尋找透過 portal 呈現的格式列；仍斷言內層文字選取、單一可見工具列、直接點擊與無水平溢出，未使用 force click、增加容差或延長 timeout。這些 fixture 問題不列為產品 Red。

## 測試實作與覆蓋契約

[Playwright 案例](../../tests/e2e/synced-blocks.spec.ts) 共 17 個案例，涵蓋 14 個需要瀏覽器驗證的 SB ID；使用真實巢狀編輯器、WebSocket、隔離 context、IndexedDB 與離線刷新。剪貼簿只替代 OS 邊界，複製按鈕及 paste 事件仍走產品程式。協作游標標籤不屬於正文，精確文字比較會排除該顯示元件。

[覆蓋檢查](../../scripts/spec-coverage.mjs) 的 `--synced-blocks` 直接讀取規格方法，要求 14 個 Workers 結果及 14 個 SB ID 在三種瀏覽器的結果，目前共 56 個必要環境結果。此數量由規格計算，沒有硬寫歷史情境總數；未執行、skip、失敗、缺少層級或缺少瀏覽器皆不能算通過。同一標題可列多個 ID，解析器逐一記錄，參數化案例須全部通過。

MCP API 的 Workers 案例透過真正 HTTP transport 呼叫工具，檢查同步正文讀寫、ETag、唯讀 scope、撤銷及頁面引用操作。OAuth 及 13 個工具發現另由既有 plugin E2E 驗證；額外通過的案例不取代規格指定環境。

## 最終統一驗收

來源穩定、單一 runner 的最後結果如下。三瀏覽器相關整合輪次共 96 項，95 通過、1 項因 SB-21 portal 定位失敗；修正後以主要同步區塊 spec 的完整三瀏覽器 51 項驗證必要環境。API、MCP、歷史預覽、引用目標切換、新增入口、圖示與頁面面板的其他整合案例均於該 96 項輪次通過。

| 驗證 | 命令 | 結果 |
| --- | --- | --- |
| Workers 行為及回歸 | `XDG_CONFIG_HOME=/tmp/p-note-wrangler npm run test:integration -- --bail=1` | 圖示整合後後端來源 `e530b13`，30 檔、176 個案例通過，退出碼 0，耗時 379.20 秒；其後只變更前端、文件與 fixture，後端未變。 |
| 單元回歸 | `npm run test:unit` | 最終產品來源 `55707df`，5 檔、11 個案例通過，退出碼 0。 |
| 最終三瀏覽器同步區塊 | `npm run test:e2e -- tests/e2e/synced-blocks.spec.ts --workers=1` | `55707df`，51/51 通過，三個 project 各 17 項；退出碼 0，耗時 370.61 秒，無 skip、retry 或 flaky。 |
| 同步區塊必要環境覆蓋 | `npm run test:spec-coverage -- --synced-blocks` | 56/56 通過、無缺漏；由真實 `reports/unit.json`、`reports/integration.json`、`reports/e2e.json` 計算。 |
| 型別與正式設定 | `npm run check`、`npm run check:production` | 退出碼均為 0。 |
| 真實建置煙霧 | `npm run test:build` | 退出碼 0；HTTPS Worker 上的 dist 登入、wss 保存、離線刷新與分析請求隔離，共 2/2 通過。 |
| 文件與規格 | `npm run check:spec`、`git diff --check` | 通過；含所有主分支與本次同步區塊情境。 |
| OpenSpec | `openspec validate add-synced-blocks --strict`；封存後 `openspec validate --all --strict` | 開發規格與封存後主規格皆嚴格驗證。 |

在 portal 修正後的第一輪 51 項嘗試中，舊常駐服務於重連後有兩項 5 秒等待逾時：SB-07 雙端已合併、最後刷新等待保存；SB-08 恢復網路等待首次下載。中止前共 18 通過、2 失敗，退出碼 143。trace 的重連 API 耗時約 1.3～2.15 秒，未確認為產品 race。停止所有舊服務及子行程，單次建置後啟動全新同一組服務，以相同 timeout、`retries: 0` 重跑，取得上述 51/51；失敗輪次不算通過，也不因單次逾時直接宣稱產品缺陷。

早期完整 591 項嘗試的中止範圍及 WebKit 完整 197 項結果保留於前文；本文件不宣稱存在單次 591/591 的全綠報告。可提交的 [結果摘要](synced-blocks-results.json) 僅保留數量、退出碼、來源與命令，原始報告及 trace 不提交。

手機僅為 Chromium／WebKit 裝置模擬；中文使用 composition／beforeinput／input fixture 與游標斷言，未宣稱操作實際 OS 輸入法或軟鍵盤。儲存與權限測試使用本機 Workers runtime，不以原生裝置或正式 Cloudflare 手動操作作為驗收門檻。

## 封存與發布

本文件與驗證摘要隨封存提交保存，主規格同步為同步區塊及 13 個 MCP 工具。PR、合併與 GitHub Actions 的遷移／發布屬封存提交後的外部交付步驟，其實際結果由 PR 與對應 master workflow 記錄；此封存文件不預先聲明發布成功。
