## 設計
以 ref 將最新導覽鎖定與目前文件 URL／history state 提供給只註冊一次的 popstate listener。鎖定時 pushState 回目前文件，不執行卸載設定的 go；解鎖後保留正常上一頁／下一頁行為。全域 Alert 抽出文件 content，在導覽及初始載入版面各自渲染，確保設定不會把提示一起隱藏。

## 驗證
擴充 BACKUP-UI-LOCK-01：建立真正站內歷史紀錄，在還原進行中及中斷後各按返回，斷言設定與 URL 保留、文件隱藏及相同 request ID 重試成功。新增 UI-06 設定頁故障案例，分別斷言備份與 API key 頁的登出／今天儲存失敗可見及關閉後仍保留設定。
