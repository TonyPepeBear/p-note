# p-note

個人筆記／日記系統。提供階層筆記、每日一篇與日期補寫、區塊編輯、中文搜尋、垃圾桶、私有原圖、即時與離線同步、90 天備份、完整 ZIP 匯出及覆蓋還原。舊裝置草稿隔離後可檢視或另存。開發使用 OpenSpec 與 TDD；未部署。

## 自動化驗證

需要 Node.js 22.22 以上。安裝使用 npm 11.21.0；瀏覽器首次需要下載。

```sh
npx --yes npm@11.21.0 ci
npm run worker:types
./node_modules/.bin/playwright install chromium webkit
npm test
npm run test:build
npm run test:spec-coverage
npm run check
npm run check:spec
openspec validate personal-notes-v1 --type change --strict --no-interactive
git diff --check
```

全程機器斷言，沒有人工驗收。Workers 測試檔案依序執行；各案例內的併發操作仍使用真實同步屏障與連線。`test:build` 需要 OpenSSL，會自動產生並清理測試憑證，以真實 dist 和本機 HTTPS Worker 驗證登入、wss 與離線刷新，使用假的寄件匣與隔離儲存。

`npm run test:spec-coverage` 比對 47 個正式情境及 129 個必需環境結果，缺漏、重複、skip 或失敗均拒絕。`--probe` 只檢查原型，不能代替完整產品驗收。

`npm run test:spec-coverage -- --auth` 比對本輪 AUTH-01～08 的 Workers 與三種瀏覽器結果。先執行完整 `npm test`，避免以篩選執行的報告作完整覆蓋。

`npm run test:spec-coverage -- --pages` 比對 PAGE-01～08 的 Workers 與三種瀏覽器結果；頁面、日期、垃圾桶、搜尋及儲存保護詳見 [頁面開發文件](docs/pages-development.md)。

`npm run test:spec-coverage -- --assets` 比對 ASSET-01～04、EDIT-03 的私有圖片結果；ASSET-05 由完整產品追蹤涵蓋。上傳限制、權限與原檔保留詳見 [圖片開發文件](docs/assets-development.md)。

## 本機登入與今日編輯器

分別啟動 `npm run dev` 與 `npm run dev:test-worker`，開啟 `http://127.0.0.1:5173/`。測試 Worker 使用假設定，自動套用隔離本機 schema，寄件匣與故障／時鐘入口供自動化測試使用。本機測試不寄真實郵件；正式服務使用原生 Email adapter，發布設定與實際寄信驗證見 [正式部署](docs/production-deployment.md)。

設定來源、權限邊界與驗證見 [登入開發文件](docs/auth-development.md)。

編輯器的「備份設定」提供建立備份、完整 ZIP 下載與成功備份覆蓋還原。格式、權限、串流與獨立解析驗證見 [匯出開發](docs/export-development.md)；復原與重試見 [還原開發](docs/restore-development.md)。

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
- [部署前完成、驗證與發布設定](docs/predeployment.md)
- [正式 Cloudflare 發布與驗證](docs/production-deployment.md)
- [OpenSpec 任務](openspec/changes/personal-notes-v1/tasks.md)
- [技術驗證結果與 TDD 證據](docs/tdd/README.md)
