export interface RootRecord { key: 'root'; handle: FileSystemDirectoryHandle; name: string; pickedAt: string; }

const DB_NAME = 'bidmate';
const STORE = 'handles';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      // 쓰기는 트랜잭션 완료 시점에 확정된다.
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error ?? req.error);
      t.onabort = () => reject(t.error ?? new DOMException('IDB transaction aborted', 'AbortError'));
    });
  } finally {
    db.close();
  }
}

export async function saveRootHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const rec: RootRecord = { key: 'root', handle, name: handle.name, pickedAt: new Date().toISOString() };
  await tx('readwrite', (s) => s.put(rec));
}

export async function loadRootRecord(): Promise<RootRecord | undefined> {
  return (await tx('readonly', (s) => s.get('root'))) as RootRecord | undefined;
}
