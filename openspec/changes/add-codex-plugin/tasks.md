# Tasks

## 1. MCP 連線

- [ ] 1.1 先以 PLUGIN-01／02 E2E 重現缺少 plugin 的 Red，再實作工具與 API 對接，相關 Chromium 測試通過。
- [ ] 1.2 實作私人設定、輸入與安全入口驗證，PLUGIN-03 斷言錯誤及重新導向不洩漏 key。

## 2. 封裝與文件

- [ ] 2.1 提供 manifests、marketplace、技能、安裝文件與 ZIP 命令，以 PLUGIN-04 驗證引用、封裝內容與解壓後啟動。
- [ ] 2.2 完整三瀏覽器驗收、型別與 OpenSpec 驗證通過，記錄必要的 TDD 結果。

## 3. 整合

- [ ] 3.1 封存同步主規格並提交，檢查提交內容與 noreply 身分，推送並建立／立即合併 PR。
- [ ] 3.2 確認 master Actions 的資料遷移與發布成功，不另做正式 HTTP 檢查。
