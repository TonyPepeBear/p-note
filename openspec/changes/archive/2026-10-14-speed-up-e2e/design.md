# Design

## 隔離方式：按 port 分組

worker 槽位 `i`（Playwright `TEST_PARALLEL_INDEX`）與位移 `O`（`E2E_PORT_OFFSET`，預設 0）：

| 服務 | port |
| --- | --- |
| vite preview | 5173＋O＋i |
| 測試 Worker（wrangler dev） | 8787＋O＋i，`--persist-to .wrangler/test-state-i` |
| wrangler inspector | 9229＋O＋i |
| 全部就緒訊號 | 5172＋O |

每組 wrangler 以 `--var BETTER_AUTH_URL:` 對應自己的 preview 來源；preview 以環境變數 `P_NOTE_API` 決定 proxy 目標。不採用「同一個 Worker 內依 namespace 隔離」：產品是單一擁有者，reset、時鐘與故障注入都是全域的，改成 namespace 會碰到產品程式並留下漏網的共用狀態。

Playwright 會在每個 worker 行程重新載入設定檔，`baseURL` 因此可直接依 `TEST_PARALLEL_INDEX` 計算；port 公式集中在 `tests/e2e/ports.ts`，設定、測試與服務腳本共用。

## 服務腳本

`scripts/e2e-servers.mjs` 先建置一次，再平行啟動 N 組服務，全部就緒後才開啟就緒 port；任何子行程異常結束即整體結束。`--watch` 額外執行 `vite build --watch`（preview 以 sirv dev 模式即時提供新檔，wrangler dev 自行監看 Worker 原始碼）。Playwright `reuseExistingServer` 在非 CI 時為 true，若已有常駐服務就直接使用。

## 限制

- 常駐服務的 worker 數須不少於本次執行的 worker 數。
- 其他 worktree 同時執行需設定不同的 `E2E_PORT_OFFSET`，否則會重用到別人的服務。
