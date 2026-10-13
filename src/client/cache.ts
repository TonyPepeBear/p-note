import type { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

export function saveLocal(cache: IndexeddbPersistence): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const tx = cache.db!.transaction(['updates', 'custom'], 'readwrite');
      const updates = tx.objectStore('updates');
      const request = updates.getAll();
      request.onsuccess = () => {
        try {
          // 合併其他分頁先前提交，再以原子交易保存完整狀態。
          Y.transact(cache.doc, () => {
            for (const update of request.result) Y.applyUpdate(cache.doc, update);
          }, cache);
          updates.clear();
          updates.add(Y.encodeStateAsUpdate(cache.doc));
          tx.objectStore('custom').put(true, 'downloaded');
        } catch (error) { reject(error); tx.abort(); }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('本機交易中斷'));
    } catch (error) { reject(error); }
  });
}

export function readLocal(cache: IndexeddbPersistence): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const request = cache.db!.transaction('updates', 'readonly').objectStore('updates').getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const doc = new Y.Doc();
      try {
        for (const update of request.result) Y.applyUpdate(doc, update);
        resolve(Y.encodeStateAsUpdate(doc));
      } catch (error) { reject(error); }
      finally { doc.destroy(); }
    };
  });
}
