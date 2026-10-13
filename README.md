# p-note

個人筆記／日記系統。目前完成 React＋Vite、BlockNote、Yjs 本機技術驗證、資料結構與登入，以及日期補寫／月份列表、階層筆記／標題／移動、垃圾桶與中文標題／內文搜尋。登入使用本機測試寄件匣；私有圖片、備份、完整正式同步驗收與部署仍在後續 OpenSpec 任務。

## 自動化驗證

需要 Node.js 22.22 以上。安裝使用 npm 11.21.0；瀏覽器首次需要下載。

```sh
npx --yes npm@11.21.0 ci
npm run worker:types
./node_modules/.bin/playwright install chromium webkit
npm run validate:probe
```

`validate:probe` 執行單元、真正本機 Workers 整合、Chromium 桌面／手機與 WebKit 手機 E2E，再比對原型追蹤 ID、檢查型別、建置與文件契約。全程機器斷言，沒有人工驗收。OpenSpec 額外執行 `openspec validate personal-notes-v1 --type change --strict --no-interactive`。

`npm run test:spec-coverage` 是完整產品的檢查，目前會因尚未完成而失敗；`npm run test:spec-coverage -- --probe` 只驗收本次技術範圍，不能代替完整產品驗收。

`npm run test:spec-coverage -- --auth` 比對本輪 AUTH-01～08 的 Workers 與三種瀏覽器結果。先執行完整 `npm test`，避免以篩選執行的報告作完整覆蓋。

`npm run test:spec-coverage -- --pages` 比對 PAGE-01～08 的 Workers 與三種瀏覽器結果；頁面、日期、垃圾桶、搜尋及儲存保護詳見 [頁面開發文件](docs/pages-development.md)。

## 本機登入與今日編輯器

分別啟動 `npm run dev` 與 `npm run dev:test-worker`，開啟 `http://127.0.0.1:5173/`。測試 Worker 使用假設定，自動套用隔離本機 schema，寄件匣與故障／時鐘入口供自動化測試使用。正式寄信尚未接入，應用預設會拒絕寄信；不能當正式私人筆記服務部署。

設定來源、權限邊界與驗證見 [登入開發文件](docs/auth-development.md)。

## 本機原型

分別啟動兩個終端：

```sh
npm run dev:worker
```

```sh
npm run dev
```

開啟 `http://127.0.0.1:5173/probe?page=demo`。同一 page 在兩個瀏覽器可同步；已下載的內文可離線刷新與編輯。圖片使用固定 PNG fixture。原型沒有正式登入／所有權檢查，只接受本機網站入口，不提供部署命令。正式 SYNC 房間使用獨立 namespace，不能由原型路由存取。

目前使用官方 Vitest plugin 內的 Wrangler CLI；y-partyserver 的 Workers types 4 peer 已明確鎖定，執行時與 Env 使用 Wrangler 產生的最新型別。乾淨安裝已用 npm 11.21.0 驗證；npm 10 的可選 peer 解析曾發生內部錯誤，不使用 force 或忽略 peer 檢查。

- [第一版需求與決策](docs/v1-scope.md)
- [OpenSpec 任務](openspec/changes/personal-notes-v1/tasks.md)
- [技術驗證結果與 TDD 證據](docs/tdd/README.md)
