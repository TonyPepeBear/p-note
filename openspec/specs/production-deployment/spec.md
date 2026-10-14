# production-deployment Specification

## Purpose
讓已完成的個人筆記與日記應用在正式 HTTPS 網域提供私人服務，使用隔離的正式儲存資源與私有設定，並以可重複的自動化驗證確認登入郵件、授權與持久同步實際可用。

## Requirements

### Requirement: 正式網域與私人資源

系統 SHALL 在 `https://note.tonypepe.com` 提供正式建置，使用專用資料庫、私有圖片與備份儲存；密鑰 MUST 不出現在版本控制與驗證紀錄。

#### Scenario: DEPLOY-01 正式設定完整
- **自動化驗證**: `DEPLOY-01`；Node 設定與雲端 API 檢查，斷言真實 ID、分離私有儲存、四個 secret 與網域綁定。
- **WHEN** Node 自動檢查正式設定、git 追蹤檔與雲端資源狀態
- **THEN** 正式資料庫 ID 不為 placeholder、圖片與備份分開且未公開、必要密鑰名稱齊全、正式網域綁定正確，密鑰檔未受 git 追蹤

#### Scenario: DEPLOY-02 正式 HTTPS 與私人入口
- **自動化驗證**: `DEPLOY-02`；Node HTTP 與 Playwright 檢查有效 TLS、建置入口、未登入 401 與測試入口 404。
- **WHEN** 自動化 HTTP／Playwright 在有效 TLS 連線存取正式根路徑、私人 API 與測試入口
- **THEN** 根路徑提供建置 HTML、未登入私人 API 拒絕存取、測試與原型入口回 404

### Requirement: 正式登入郵件與持久同步

系統 SHALL 將登入郵件送達已設定擁有者，透過同正式網域的確認操作建立登入狀態；兩個獨立瀏覽器 SHALL 在 wss 連線同步正文，且全新瀏覽器載入後保留雲端確認過的正文。

#### Scenario: DEPLOY-03 真實郵件登入
- **自動化驗證**: `DEPLOY-03`；Gmail 與 Playwright 斷言時間窗內郵件、同網域連結、確認登入及一次性兌換。
- **WHEN** Playwright 申請擁有者登入連結，Gmail API 讀取對應寄件者與時間窗的實際郵件，再由 Playwright 執行確認登入
- **THEN** 郵件包含同正式 origin 的確認路徑，僅 GET 不兌換，確認成功後私人頁面可編輯；驗證紀錄不儲存登入 token 與 cookie

#### Scenario: DEPLOY-04 雙瀏覽器與全新載入
- **自動化驗證**: `DEPLOY-04`；Playwright 斷言獨立 context 雙向 wss 保存、全新載入相同正文與驗證筆記移入垃圾桶。
- **WHEN** 已登入的兩個獨立 Playwright context 開啟專用驗證筆記，依序輸入不同標記，再關閉 context 並由全新 context 載入
- **THEN** wss 已連線、兩側均收到雙向文字與雲端保存確認，全新 context 仍含最後文字；驗證筆記透過正常垃圾桶流程清理，不影響使用者其他頁面
