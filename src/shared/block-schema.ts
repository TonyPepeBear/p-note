import { BlockNoteSchema, createBlockSpec, defaultBlockSpecs } from '@blocknote/core';

// 頁面正文只保存引用；共用內容由自己的 Yjs 文件保存。
export const syncedBlockConfig = {
  type: 'syncedBlock',
  propSchema: { syncedBlockId: { default: '' } },
  content: 'none',
} as const;

// Worker 只使用 schema 轉換 JSON／Yjs，實際顯示由前端 React spec 負責。
export const syncedBlockSpec = createBlockSpec(syncedBlockConfig, {
  render() { throw new Error('同步區塊需要前端呈現器'); },
})();

export const blockSchema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, syncedBlock: syncedBlockSpec },
});
export type AppBlock = typeof blockSchema.Block;
export type AppPartialBlock = typeof blockSchema.PartialBlock;
