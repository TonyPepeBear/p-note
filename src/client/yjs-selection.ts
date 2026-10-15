import { useEffect } from 'react';
import type { BlockNoteEditor } from '@blocknote/core';
import { ySyncPluginKey } from 'y-prosemirror';
import type * as Y from 'yjs';

export function useSafeRemoteNodeSelection(editor: BlockNoteEditor<any, any, any>, doc: Y.Doc) {
  useEffect(() => {
    const beforeTransaction = (transaction: Y.Transaction) => {
      const view = editor.prosemirrorView;
      if (transaction.local || view.composing) return;
      const binding = ySyncPluginKey.getState(view.state)?.binding;
      const selection = binding?.beforeTransactionSelection;
      if (selection?.type !== 'node') return;
      // API 整份替換正文時，原節點的相對位置可能指向沒有 nodeAfter 的文件末端。
      // y-prosemirror 1.3.7 的 NodeSelection 還原未檢查這個情況；改走會尋找鄰近有效位置的分支。
      // 一般文字選取與中文選字期間仍沿用原本的相對選取，不改動正在編輯的內容。
      binding.beforeTransactionSelection = { ...selection, type: 'text' };
    };
    doc.on('beforeTransaction', beforeTransaction);
    return () => { doc.off('beforeTransaction', beforeTransaction); };
  }, [editor, doc]);
}
