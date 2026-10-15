# MCP 發布依賴安裝修補

2026-10-15，change `fix-mcp-ci-install`。

[首次發布 workflow](https://github.com/TonyPepeBear/p-note/actions/runs/38675094206) 在 npm ci 回報 Wrangler 可選 workers-types peer 缺漏；遷移與發布皆未執行。

- Red：本機相同 Node 22.22.3／npm 10.9.8 的 npm ci dry-run 同樣失敗。CICD-01 新增版本與執行順序斷言後，相關 Chromium 案例因缺少固定 npm 步驟失敗。
- Green：相同 package.json／lockfile 在隔離暫存目錄以 npm 11.21.0 真正乾淨安裝成功，結束後刪除暫存目錄。CI 在 npm ci 前安裝這個固定版本，不略過 peer 檢查。
- `npm run test:e2e:fast -- tests/e2e/deployment.spec.ts` 的 CICD-01／02／03 全部通過。只改部署工具版本，不重跑產品 E2E；規格與型別檢查由既有部署流程持續執行。

未修改產品程式、產品規格、資料遷移或 lockfile。封存後透過修補 PR 合併，再以 master Actions 發布；不執行本機正式部署或發布後網站 HTTP 檢查。
