## MODIFIED Requirements

### Requirement: 上傳驗證與引用

系統 MUST 驗證圖片實際內容、支援格式與大小；只有上傳成功才建立可保存的正式文件引用。JPEG／PNG／WebP／GIF，每檔最多 10 MiB，保留原圖且不壓縮；不支援 SVG／HEIC。 JPEG EOI 後附加資料 MUST 可上傳；上傳後 MUST 去除 JPEG／PNG／WebP EXIF 個資及 XMP 與 JPEG 尾端資料，EXIF 僅可白名單保留顯示方向，保留壓縮像素及動畫。

#### Scenario: 上傳中斷

- **WHEN** 圖片上傳失敗或中斷
- **THEN** 系統顯示失敗與重試入口，文件不把不存在的檔案顯示為已成功保存
- **自動化驗證**: `ASSET-02`；Workers 整合＋Playwright：中斷上傳或注入 R2 寫入失敗，斷言錯誤／重試入口、正文沒有不存在原檔的正式引用。

#### Scenario: 超限或格式不符

- **WHEN** 圖片超過設定大小或實際內容不符支援格式
- **THEN** 系統拒絕上傳並說明限制，不只信任檔名或用戶端宣告
- **自動化驗證**: `ASSET-03`；Workers 整合：參數化大小邊界、偽造 MIME／副檔名與不支援內容 fixture，斷言拒絕且未建立資產或正文引用。
