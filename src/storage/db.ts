// アプリ全体で1つの IndexedDB（このPCのこのブラウザの中だけに残る）。
// 版を上げるときは onupgradeneeded に足していく。既存のデータは消さない。

const DB_NAME = 'sight-reader';
/** 1: 回答記録（answers）、2: 曲のライブラリ（songs）を追加 */
const DB_VERSION = 2;

export type StoreName = 'answers' | 'songs';

let db: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('answers')) {
        d.createObjectStore('answers', { keyPath: 'id', autoIncrement: true }).createIndex('timestamp', 'timestamp');
      }
      if (!d.objectStoreNames.contains('songs')) {
        d.createObjectStore('songs', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return db;
}

/** 1つのストアに対するトランザクション。完了したら fn が返したリクエストの結果を返す */
export async function withStore<T>(
  name: StoreName,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const d = await openDb();
  return new Promise((resolve, reject) => {
    const t = d.transaction(name, mode);
    const req = fn(t.objectStore(name));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
