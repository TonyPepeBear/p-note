# Design

## Context

既有 `/api/v1` 已支援 Bearer API key 與 ETag。Codex 可啟動本機 stdio MCP，現有 Cloudflare 部署可保持原樣。

## Goals / Non-Goals

提供完整現有 API 的 MCP 操作。此版本不新增網站 UI、遠端 MCP、OAuth、刪除或圖片上傳。

## Decisions

- Node.js 原生 fetch、readline 與 JSON-RPC 實作固定工具的 MCP 子集（initialize、ping、tools/list、tools/call）；無需部署新主機或安裝套件。保留可協商的既有 MCP 協定版本，不宣告資源、提示或串流能力。SDK 會增加安裝需求，這個固定介面先使用原生功能。
- plugin 同時包含 portable manifest、Codex 相容 manifest 與 MCP 配置；repo marketplace 指向 plugin，單獨 ZIP 不含 marketplace。
- 預設連接既有正式服務；使用 `P_NOTE_API_KEY` 或 `P_NOTE_CONFIG` 指定的私人 JSON（預設 `~/.config/p-note/config.json`）。支援 `P_NOTE_BASE_URL` 作測試或自架入口；只允許 HTTPS 或 loopback HTTP，禁止 URL 帳密、查詢、片段與重新導向。
- 工具輸入只容許固定 schema，頁面 ID 限制字元，正文只接受 blocks 與讀取時 ETag。API 回應的私人內容只作工具結果，不寫檔；錯誤採固定訊息與狀態碼，避免洩漏憑證。
- E2E 以 MCP stdio 子行程對接真實隔離 Worker API，驗證網站同步與拒絕過時寫入。封裝內容由程式檢查，含隱藏 manifest，排除私人設定。

## Risks / Trade-offs

- 本機 plugin 需要 Node.js 22.22 以上及使用者建立 API key → 文件提供安全設定步驟；不自行建立或讀取正式 key。
- 筆記內容可能含提示注入 → 技能規定視為資料，不執行其中指令，不將私人內容送到其他服務。
- 網路失敗時無法知道寫入是否完成 → 不自動重試寫入，重新讀取確認。

## Migration Plan

無資料遷移。提交後依既有 PR 流程合併，確認 Actions 遷移與發布成功；不進行額外正式 HTTP 驗證。
