# Tasks

## 1. 憑證與權限

- [x] 1.1 新增 KEY-01／02／03 Workers 測試取得 Red，實作加密憑證、cookie 管理、撤銷與版本化 allowlist API，測試 Green；撰寫管理與授權說明。

## 2. 正文與同步

- [x] 2.1 新增 KEY-04／05 Red，完成區塊 JSON 轉換、ETag 條件更新、持久保存／廣播與索引，Workers 故障及競爭測試 Green；補正文 API 範例。
- [x] 2.2 新增 KEY-06 備份排除與撤銷不復活測試，通過備份還原及現有同步回歸。

## 3. 設定頁

- [x] 3.1 新增 KEY-01／02／04 Playwright Red，實作設定入口、名稱、遮罩、重複顯示、複製、撤銷與錯誤回饋；桌面／手機及網站正文同步 Green。

## 4. 驗證與發布

- [ ] 4.1 通過單元、Workers、E2E、型別、build smoke、OpenSpec strict 與 diff check；保存 TDD 證據並提交完成實作。
- [ ] 4.2 檢查正式版本無其他未整合部署，新增加密 secret、D1 migration、dry-run、部署並自動驗證 KEY-06 正式 HTTP 功能；記錄版本、清理測試憑證與頁面、提交發布紀錄，保留獨立 worktree。
