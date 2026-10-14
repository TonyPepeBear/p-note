# Tasks

## 1. 資料庫頁面

- [x] 1.1 以 DB-01／02 E2E 先取得 Red，再完成相容 migration、建立／移動、資料庫導覽與垃圾桶；相關 Chromium E2E 通過並記錄。

## 2. 欄位及檢視

- [x] 2.1 以 DB-03／04 E2E Red／Green 完成共用型別校驗、原子欄位 API、設定衝突、表格及正文屬性編輯；相關 Chromium E2E 通過。
- [x] 2.2 以 DB-05 E2E Red／Green 完成表格／清單、多檢視、篩選、排序與欄位排列／隱藏；重開及切換斷言通過。
- [x] 2.3 以 DB-06／07／08 E2E Red／Green 完成失敗重試、跨裝置、權限／世代與手機鍵盤操作；相關 Chromium E2E 通過，撰寫功能使用與保存限制文件。

## 3. 備份與相容

- [x] 3.1 以 DB-09／10 E2E Red／Green 擴充完整 ZIP、清單校驗與覆蓋還原，兼容舊備份；斷言欄位／檢視／正文與世代隔離通過，文件記錄格式相容。

## 4. 驗收與發布

- [ ] 4.1 Refactor 後相關 E2E 持續通過；執行完整三瀏覽器 E2E、unit／integration、check、build、spec 校驗，DB-01～10 全數具通過證據，提交程式及驗收紀錄。
- [ ] 4.2 以正式 Wrangler 設定套用 migration、dry-run、部署；自動驗證正式建置與專用資料庫操作，清理臨時 session／測試資料並提交部署結果。
- [ ] 4.3 確認全部 tasks 完成後同步主規格、封存 change，openspec validate 及清單確認無未完成變更，提交封存紀錄。
