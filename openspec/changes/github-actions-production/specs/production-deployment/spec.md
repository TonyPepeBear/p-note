## ADDED Requirements

### Requirement: master 自動部署

發布流程 SHALL 在推送 master 或手動選擇 master 時驗證該提交、建置、套用正式資料遷移並部署既有正式服務；所有正式發布 MUST 依序執行。其他分支 MUST 不得發布正式服務。

#### Scenario: CICD-01 分支與失敗阻擋
- **自動化驗證**: `CICD-01`；Playwright 讀取 workflow，斷言 master 觸發、手動分支限制、完整三瀏覽器測試先於部署、相依工作成功才發布及同一 concurrency 群組不取消執行中發布。
- **WHEN** master 推送或手動觸發，且檢查或測試失敗
- **THEN** 發布工作不執行；通過後才依序進行資料遷移、部署與 HTTPS 檢查

#### Scenario: CICD-02 部署憑證隔離
- **自動化驗證**: `CICD-02`；Playwright 設定檢查與 GitHub secret 名稱查詢，斷言部署憑證僅注入發布工作，不讀取本機私人檔，不輸出或覆寫既有 Worker secrets。
- **WHEN** CI 使用部署 API token 發布正式服務
- **THEN** 憑證來自 GitHub Actions Secrets，程式與報告不包含私人值；缺少憑證立即失敗，不執行資料遷移

#### Scenario: CICD-03 正式建置與入口驗證
- **自動化驗證**: `CICD-03`；Node HTTP smoke 的本機故障 fixture 與實際 GitHub Actions 執行，斷言正式 HTML 與建置 script 相符、私人 API 回 401、測試入口回 404，TLS 與任一斷言失敗皆退出非零。
- **WHEN** 正式部署成功後檢查公開入口
- **THEN** 正式站提供本次建置並維持私人存取限制，執行結果可由 GitHub run 查詢
