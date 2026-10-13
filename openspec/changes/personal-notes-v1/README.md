# personal-notes-v1

個人筆記與日記第一版：整理需求、技術決策、待確認事項與 OpenSpec 規格；已完成本機技術驗證，接續資料結構與 Better Auth＋magic link 登入 TDD；以測試寄件匣驗證，暫不部署。

- [第一版整理與待確認清單](../../../docs/v1-scope.md)
- [變更提案](proposal.md)
- [技術設計](design.md)
- [能力規格](specs/)
- [後續任務](tasks.md)
- [TDD 與全自動驗證計畫](../../../docs/automated-validation.md)

依新的 AGENTS.md 採 TDD；所有情境與任務都以自動化驗證，規格更新與完成開發後自動提交。已先提交確認後規格（d632447），再完成上述技術驗證。

OpenSpec 驗證與 artifact 狀態只檢查文件，不表示使用者已接受所有草案行為或授權 apply。任務依實際報告更新；本 change 已有本機原型，但完整產品尚未完成，不封存成正式能力規格。

## 能力規格

- [個人登入](specs/personal-auth/spec.md)
- [頁面與日記](specs/pages-and-journal/spec.md)
- [區塊編輯](specs/block-editing/spec.md)
- [即時同步](specs/realtime-sync/spec.md)
- [私有圖片](specs/private-assets/spec.md)
- [備份與還原](specs/backup-restore/spec.md)

- [本次技術結果與 TDD 證據](../../../docs/tdd/README.md)
