# personal-notes-v1

個人筆記與日記第一版：整理需求、技術決策、待確認事項與 OpenSpec 規格草案；尚未授權實作。

- [第一版整理與待確認清單](../../../docs/v1-scope.md)
- [變更提案](proposal.md)
- [技術設計](design.md)
- [能力規格](specs/)
- [後續任務](tasks.md)
- [TDD 與全自動驗證計畫](../../../docs/automated-validation.md)

依新的 AGENTS.md 採 TDD；所有情境與任務都以自動化驗證，規格更新與完成開發後自動提交。此輪僅提交文件，未開始實作。

OpenSpec 驗證與 artifact 狀態只檢查文件，不表示使用者已接受所有草案行為或授權 apply。所有任務維持未執行；本 change 尚未實作或封存成正式能力規格。

## 能力規格

- [個人登入](specs/personal-auth/spec.md)
- [頁面與日記](specs/pages-and-journal/spec.md)
- [區塊編輯](specs/block-editing/spec.md)
- [即時同步](specs/realtime-sync/spec.md)
- [私有圖片](specs/private-assets/spec.md)
- [備份與還原](specs/backup-restore/spec.md)
