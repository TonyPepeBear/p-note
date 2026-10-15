import type { BlockNoteEditor } from '@blocknote/core';
import type { IndexeddbPersistence } from 'y-indexeddb';
import type YProvider from 'y-partyserver/provider';
import type { Doc } from 'yjs';

declare global {
  interface Window {
    probe?: {
      editor: BlockNoteEditor<any, any, any>;
      doc: Doc;
      provider: YProvider;
      cache: IndexeddbPersistence;
      flush: () => Promise<void>;
      saveCloud: () => Promise<void>;
      localState: () => Promise<Uint8Array>;
      room: string;
    };
    copiedCode?: string;
    delayedReceipts?: string[];
    releaseReceipt?: (index: number) => void;
  }
}
