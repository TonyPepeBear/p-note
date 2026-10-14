## MODIFIED Requirements

### Requirement: master 自動部署

發布流程 SHALL 在推送 master 或手動選擇 master 時驗證該提交、建置、套用正式資料遷移並部署既有正式服務；所有正式發布 MUST 依序執行。其他分支 MUST 不得發布正式服務。Cloudflare 發布命令成功後 MUST 結束發布工作，不得再自動存取正式首頁、比較網站建置資源或探測私人／測試入口。

#### Scenario: CICD-01 分支與失敗阻擋
- **自動化驗證**: `CICD-01`；Playwright 讀取 workflow，斷言 master 觸發、手動分支限制、型別／設定／建置與預檢先於部署、步驟失敗停止及同一 concurrency 群組不取消執行中發布。
- **WHEN** master 推送或手動觸發，且檢查、建置或預檢失敗
- **THEN** 發布工作不執行；通過後才依序進行資料遷移與部署

#### Scenario: CICD-02 部署憑證隔離
- **自動化驗證**: `CICD-02`；Playwright 設定檢查與 GitHub secret 名稱查詢，斷言部署憑證僅注入遠端發布步驟，不讀取本機私人檔，不輸出或覆寫既有 Worker secrets。
- **WHEN** CI 使用部署 API token 發布正式服務
- **THEN** 憑證來自 GitHub Actions Secrets，程式與報告不包含私人值；缺少憑證立即失敗，不執行資料遷移

#### Scenario: CICD-03 發布成功後結束
- **自動化驗證**: `CICD-03`；Playwright 讀取 workflow 與實際 GitHub Actions 執行，斷言最後一步為資料遷移與 Cloudflare 發布，不執行發布後網站／建置／入口檢查，發布命令成功即工作成功。
- **WHEN** 正式資料遷移及 Cloudflare 發布命令成功
- **THEN** 工作結束並回報成功，不因正式首頁、資源版本或入口的 HTTP 回應再次阻擋發布
