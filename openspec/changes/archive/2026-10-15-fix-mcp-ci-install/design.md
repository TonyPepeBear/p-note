# Design

Node 22.22.3 的 npm 10.9.8 可重現相同安裝錯誤，npm 11.21.0 dry-run 通過。CI 明確固定已驗證版本後執行原 npm ci；不以 legacy-peer-deps 或 force 略過依賴約束。以隔離目錄乾淨安裝及 CICD-01 斷言驗證，不重跑產品 E2E。完成後封存此 change，修補 PR 合併後由 Actions 重試 migration 與發布。
