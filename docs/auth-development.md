# 本機資料結構與登入

已建立 Better Auth 1.7.7＋D1、固定 30 天 session、10 分鐘單次 magic link、今日入口與必要同步權限邊界。原生寄信 adapter 已接入，實際寄信與部署尚未執行；資料來源與限制以 [設計](../openspec/changes/archive/2026-10-14-personal-notes-v1/design.md) 為準。

## Q3 設定來源

應用 Worker 由 binding 讀取 `OWNER_EMAIL`、`BETTER_AUTH_URL`、`BETTER_AUTH_SECRET`；[wrangler.app.jsonc](../wrangler.app.jsonc) 只列 required 名稱，不提交私有值。日後正式密鑰使用 Wrangler secret；本機私有值置於被 git 忽略的 `.dev.vars`。網址必須為 HTTPS origin；HTTP 只接受 loopback origin。缺值、非法網址或不足 32 字元的密鑰回應 503，不揭露值。

正式擁有者 Email、網站 origin 與寄件網域已記錄在 git 忽略的私人設定。應用預設使用原生 `EMAIL` binding 與 `SENDER_EMAIL`；拒絕／缺值時清除本次未寄出的驗證憑證。詳見 [寄信開發](mail-development.md)。測試仍注入寄件匣，沒有實際寄信或部署。

## 本機測試入口

```sh
npm run dev
npm run dev:test-worker
```

首頁 `http://127.0.0.1:5173/` 提供登入與今日編輯器；獨立原型入口為 `/probe?page=demo`。[測試 Worker](../tests/runtime.ts) 使用假的 Email／origin／密鑰、隔離 D1／R2 與 `.wrangler/test-state`；自動套用本機 schema，提供機器讀取寄件匣、前進時鐘、寄信故障與重設入口。測試端點只存在測試 Worker，拒絕非 loopback 網址，不設定 remote binding。瀏覽器測試自動從寄件匣取得連結，沒有人工收信步驟。

`dev:worker` 仍是原本獨立同步原型，搭配 `/probe` 使用；其 config 沒有正式 SYNC binding。應用 Worker 拒絕原型路由，測試 Worker 才組合兩種入口作回歸。測試 config 與應用 config 都沒有部署 script。

## 資料與權限邊界

[SQL migration](../migrations/0001.sql) 建立 Better Auth 的 user／session／account／verification，以及 pages／assets／page_search。日記包含垃圾桶也維持同 owner／日期唯一；parent 與搜尋索引使用同 owner 的複合外鍵。內文仍以 SQLite DO 的 Yjs 狀態為原始資料，不存進 D1。

magic link 雜湊保存並由 Better Auth 的 D1 adapter 原子消耗。郵件 URL 先開無副作用確認頁，再以同來源 POST 兌換；不公開 Better Auth 的 GET 兌換入口。Email 與 IP 寄送限制以 D1 原子 batch 的滑動視窗維持，使用 Cloudflare 提供的連線 IP。未知 Email 使用相同一般回應，不建立帳號或寄信。

session 自單一建立時間起固定 30×24 小時，不續期且禁用 cookie session cache；登出撤銷服務端 session 並清除 cookie。每個私人 API 與同步握手驗證登入與 owner。正式房間以 owner／page／generation 隔離；接收訊息、初次傳送、休眠喚醒及關閉事件廣播前，排除撤銷／到期／刪頁／舊世代的連線。

登入到期後仍可保留已開頁面的 IndexedDB 草稿；重新登入回到原頁，重新讀取 owner 與世代。世代已變更時停止接入並保留舊快取。Service Worker 排除 API、測試控制、登入憑證頁及同步路由，避免把私人回應當靜態快取。

## 自動化命令

```sh
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:spec-coverage -- --auth
npm run test:spec-coverage -- --probe
npm run check
npm run build
npm run check:spec
```

`--auth` 必須比對 AUTH-01～08 的 Workers 結果及五個需要瀏覽器的情境在三種 engine 的結果；缺漏、重複、skip 或失敗不能算完成。預設完整產品覆蓋仍應失敗，不能用本輪登入或原型結果替代。Red／Green／Refactor 的機器證據記錄在 [TDD 文件](tdd/README.md)。

## 仍待後續

備份、世代切換協調與完整產品驗收仍在後續任務；頁面、私有圖片與正式離線啟動／重連已完成本機驗證。手機為 Chromium／WebKit 模擬，未驗證原生 OS 鍵盤、實際郵件送達或已部署 Workers。所有驗收仍由自動化斷言完成。
