# 驗證紀錄

只使用本機假資料，未保存正式筆記、登入資訊或 API 原始回應。瀏覽器與暫存函式庫沿用既有測試環境；環境重現方式見 `docs/tdd/create-menu.md`。

- Red：`npm run test:e2e:fast -- tests/e2e/create-menu.spec.ts --grep UI-CREATE-05` 退出碼 1，2 個案例皆因私人頁面標題旁缺少加號而失敗。
- Green：`npm run test:e2e:fast -- tests/e2e/create-menu.spec.ts` 退出碼 0，6/6 通過，包含兩種建立目標。
- Refactor：共用 CreateMenu 元件，修正與頁面選單重複的 React key；新增入口與備份還原鎖定的 Chromium 桌面驗證退出碼 0，8/8 通過。
- 三瀏覽器驗收偵測到手機抽屜重新啟用焦點陷阱時會蓋過選單返回焦點；改為在選單退出轉場完成後將焦點交還加號，取消保留導覽，建立後關閉抽屜。

- 焦點修正後：`npm run test:e2e:fast -- tests/e2e/create-menu.spec.ts` 退出碼 0，6/6 通過；`npm run test:e2e -- tests/e2e/create-menu.spec.ts` 退出碼 0，18/18 通過（三個 browser project 各 6 個）。
- 初輪驗收涵蓋新增選單、備份還原鎖定與手機導覽，共 30 個案例，26 通過、4 個手機加號取消焦點案例失敗。修正後重跑完整新增選單的 18 個三瀏覽器案例；按標題與 project 合併最新結果，程式斷言 30 個唯一案例全部通過，無略過或自動重試。
- `npm run check`、`npm run check:spec` 及 OpenSpec 嚴格驗證通過；E2E 使用最新 Vite 正式建置，不宣稱為整套產品測試或實機手機驗收。
