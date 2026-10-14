# Design

## Context

`redesign-mantine-workspace` 已用 Mantine AppShell、Modal 與 BlockNote 完成改版，UI-01～06 通過。審查發現的問題集中在 `src/client/`：`editor.tsx` 的 `flush()` 每次更新都把雲端狀態設為「同步中」，導致重試按鈕與 `aria-live` 隨每次按鍵變動；`main.tsx` 把類型前綴接在 H1；`navigation.tsx` 以按鈕文字作為新頁面標題、以平面清單提供移動選項、日記面板需手動查詢；區塊工具放在每次操作後都會關閉的 Modal。伺服器標題規則為 1～200 字元，不接受空白標題。

## Goals / Non-Goals

**Goals:** 修正審查列出的問題，維持既有同步、草稿保護、權限與備份還原行為；以 UX-01～15 自動化斷言驗收，並更新受影響的 UI／EDIT 測試。

**Non-Goals:** SPA 內換頁、深色模式、永久刪除、拖曳排序、圖片上傳取消與進度、後端 API 或資料格式變更。

## Decisions

- **保存狀態**：把「顯示狀態」與「重試可見性」分開。重試按鈕只依 `failed`／`offline`／本機失敗決定，不再用 `cloud !== "雲端已儲存"`。`aria-live` 只放在一個隱藏的結果文字節點，且只在進入「已儲存」「失敗」「離線」時更新，避免逐鍵播報。圖示依狀態切換 `IconCloudCheck`／`IconCloudUpload`／`IconCloudOff`／`IconCloudX`，並輸出 `data-state` 供測試斷言。狀態列保留固定最小高度。
- **標題編輯**：H1 改為無框 `TextInput`／`contentEditable` 外觀的受控輸入，沿用 `/api/pages/:id/title` 與 `changed()` 回呼；空白或超長在前端擋下，失敗時回滾。類型改由 Badge 顯示「筆記」「日記」。`Editor` 的 `title` prop 改傳純標題與 `kind`，不再用 `startsWith("日記 ")` 判斷類型。頁面操作 Modal 保留改名欄位作為替代入口。
- **新頁面焦點**：建立時送出「未命名」，導向新頁時在 URL 加上 `&new=1`；載入後若有此參數就聚焦標題並全選，然後以 `history.replaceState` 移除參數，避免重新整理時再次觸發。選 URL 參數是因為目前換頁為整頁重載，React 狀態無法跨頁保留。
- **區塊操作**：以 Mantine `Menu` 取代 Modal。上移／下移設定 `closeMenuOnClick={false}`；開啟期間在目前區塊外層加上 `data-active-block` 與 CSS 外框。復原依賴 BlockNote／Yjs 既有的 undo manager，不另行實作。複製程式碼依 `currentBlock().type` 停用並附說明。手機觸控沿用同一個選單，符合 EDIT-04「不只依賴懸停或拖曳」。
- **文案**：集中替換使用者可見字串（例如「頁面世代已變更，本機內容已隔離」改為「這頁在其他地方被更新，你的本機修改已另外保留」）。測試以「不含術語」與關鍵語句斷言，避免綁死整段文字。移除每頁副標語與 header caption；側欄頁尾只保留一處私人空間提示。
- **導覽**：樹狀收合狀態存在 `localStorage`（`p-note-collapsed`，只存 ID），目前頁面的祖先強制展開。移動選項以 DFS 產生，用全形空白依深度縮排，並在前端排除子孫；伺服器既有的循環檢查保留為最後防線。日記面板開啟時自動查詢目前月份。⌘K 在 `window` 註冊 `keydown`，攔截 Meta/Ctrl+K。
- **垃圾桶與備份**：還原按鈕可見文字為「還原」，`aria-label` 為「還原 {title}」；重新載入時檢查 `response.ok`。備份卡片以 `aria-current` 與邊框高亮，確認區塊出現後呼叫 `scrollIntoView({ block: "nearest" })`，並加上「取消」按鈕清空選擇。全域 Alert 加上 `withCloseButton`。舊本機草稿面板加「稍後再說」，以 `sessionStorage` 記住本分頁內已忽略。
- **對比**：在 theme 覆寫 `dimmed` 對應色為 4.5:1 以上的深灰，eyebrow 字級提高到 12px 並改用較深色；UX-15 以實際計算的色值把關。

## Risks / Trade-offs

- [既有 E2E 依賴區塊 Modal、還原按鈕文字與「筆記 標題」H1] → 在同一任務內更新 helper 與斷言，跑完整 e2e 回歸。
- [標題輸入與 BlockNote 焦點互搶] → 標題只在 Enter／失焦時保存；Enter 後焦點移到正文開頭，以 UX-03／05 斷言。
- [停用逐鍵 live 播報後，輔助技術使用者錯過「同步中」] → 這是刻意取捨：只播報結果，同步中仍可在畫面上看到。
- [`&new=1` 參數殘留] → 載入後立即移除，重新整理不會再次全選。
- [收合狀態殘留已刪除頁面的 ID] → 讀取時只套用仍存在的 ID，無需清理。
