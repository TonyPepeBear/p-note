## Context
側欄「設定」開啟 ApiKeySettings；共用 settings-section 版面已提供標題與間距。

## Goals / Non-Goals
顯示目前 origin 的瀏覽器儲存估計值與配額。此變更不提供清除快取、持久化申請或自動輪詢。

## Decisions
新增獨立 LocalCacheSettings 元件，在設定頁掛載時呼叫 navigator.storage.estimate()，重新進入設定時重讀。使用十進位 B／KB／MB／GB／TB，KB 以上保留一位小數，與使用者範例一致。以功能偵測判斷 API 與 usageDetails，不辨識瀏覽器名稱；僅顯示確實回報的 indexedDB 與 caches 欄位，0 是有效用量。缺少 usage 或 quota 時顯示無法取得提示，不把未知值當成零。載入期間提供狀態提示，拒絕或同步例外也轉為無法取得提示；卸載後忽略非同步結果。

## Risks / Trade-offs
估計值包含同 origin 的儲存，配額由瀏覽器決定且可變動；介面以「已用空間／可用上限」清楚標示，並說明為瀏覽器估計。分項不是跨瀏覽器標準，型別只在元件局部擴充。
