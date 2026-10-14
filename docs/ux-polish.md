# 工作區可用性修正

依 Mantine 改版後的 UI/UX 審查，修正會干擾寫作或造成誤解的介面問題。規格與任務見 [OpenSpec change](../openspec/changes/polish-workspace-usability/proposal.md)。

## 修正內容

- 保存狀態：打字時狀態列不跳動，重試按鈕只在失敗、離線或本機保存失敗時出現；輔助技術只播報結果變化；雲端圖示依已儲存、同步中、離線、失敗切換並輸出 `data-state`。
- 離線恢復：斷網時 `disconnect()` 讓舊 WebSocket 卡在 CLOSING，provider 仍視為已連線，恢復網路後 `connect()` 直接略過，離線修改一直停在「同步中」。重連前若舊連線已在關閉，重設 provider 連線狀態並攔下它遲到的 close，讓新連線同步後照常送出保存確認。
- 標題：H1 只顯示標題並可直接編輯，Enter／失焦保存、Escape 取消；空白、超過 200 字或保存失敗會恢復原值並說明。類型改為中文標籤，瀏覽器分頁標題同步更新。
- 新頁面：新筆記與子頁面預設「未命名」，開啟後標題聚焦並全選；以一次性 `new=1` 參數傳遞，載入後即移除。
- 區塊操作：改為錨定在工具列的選單，上移／下移不關閉選單並標示目前區塊；刪除後可用 Ctrl／⌘+Z 復原；非程式碼區塊停用「複製程式碼」並說明原因。選單啟用 flip／shift／size，手機鍵盤佔位時仍可捲動到所有項目。
- 文案：移除「世代」「隔離」等內部術語與英文類型標籤，修正隔離提示黏字與日記清單日期重複，移除每頁副標語與 header 宣傳文字，縮短手機首屏間距。
- 導覽：側欄頁面樹可收合並保存在本機，目前頁面的祖先自動展開；移動上層選項依階層縮排並排除自己與子孫；麵包屑以「筆記／日記」開頭並可回到入口；日記面板開啟即載入當月；Ctrl／⌘+K 開啟搜尋。
- 垃圾桶與備份：還原按鈕固定顯示「還原」，可及名稱帶標題；還原成功或重新載入失敗都有回饋。選擇備份還原時高亮該卡片、捲到確認區並可取消。全域錯誤可關閉，舊本機草稿提示可「稍後再說」，「還原此頁」附說明。
- 對比：Mantine `dimmed` 改為 4.5:1 以上的深灰，eyebrow 改為 12px，搜尋按鈕與側欄空狀態文字加深。

不在本次範圍：SPA 內換頁、深色模式、永久刪除、拖曳排序、圖片上傳取消與進度。

## 自動化驗收

[UX-01～15 測試](../tests/e2e/workspace-usability.spec.ts)在 chromium 桌面、chromium 手機與 webkit 手機執行；UX-10 會把 viewport 設為 375×812，三個環境都量手機首屏。WebKit 的 `page.route` 攔不到受 Service Worker 控制頁面的請求，故障注入改為在頁面內包裝 `fetch`。

- 有效 Red：[覆蓋腳本 UX 前綴](tdd/red-ux-coverage.log)、[UX 情境 44 個失敗](tdd/red-ux.log)，失敗原因皆為缺少新元素、屬性或文字，以及 UX-10 首屏 408px 超過 365px。
- Green：[覆蓋腳本](tdd/green-ux-coverage.log)、[UX 情境](tdd/green-ux.log)。
- [第一次完整回歸](tdd/ux-full-e2e.log)：205 通過、7 失敗。AUTH-01／PAGE-04 是既有測試仍找舊 H1 前綴、舊預設標題，且未等待頁面操作對話框關閉；webkit EDIT-04 揭露區塊選單在 390×340 視窗超出畫面，屬本次回歸，已加入 flip／size 與捲動修正。[針對性回歸](tdd/ux-targeted-regression.log) 75 個通過。
- [UX 情境 Green](tdd/green-ux.log) 時 UX-10 在桌面被略過，覆蓋檢查將略過判為未通過；UX-10 本身已設定手機 viewport，移除略過後三個環境皆執行。

## 最終結果

2026-10-14，以最終程式碼執行：

- [完整瀏覽器回歸](tdd/ux-final-e2e.log)：213 個全部通過，零重試。
- [單元](tdd/ux-unit.log) 6 個、[Workers 整合](tdd/ux-integration.log) 92 個、[真實建置 smoke](tdd/ux-build-smoke.log) 2 個通過。
- 情境覆蓋：[UX](tdd/ux-coverage.log) 45／45、[Mantine 介面](tdd/ux-ui-coverage.log) 18／18、[完整產品](tdd/ux-product-coverage.log) 129／129。
- [型別](tdd/ux-types.log)、[文件契約](tdd/ux-contract.log)、[OpenSpec 嚴格驗證](tdd/ux-openspec.log)通過。

本次只在本機驗收，尚未部署至正式網站。

![新版桌面工作區](screenshots/ui/after-chromium-desktop-workspace.png)
