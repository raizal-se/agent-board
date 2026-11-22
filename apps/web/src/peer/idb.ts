/** A small key-value store in IndexedDB: the browser peer's copy of the board, its device key and its name. */
const DB = 'agent-board';
const STORE = 'kv';

let opened: Promise<IDBDatabase> | undefined;

function db(): Promise<IDBDatabase> {
  opened ??= new Promise((ok, fail) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
  return opened;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((ok, fail) => {
        const req = fn(d.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => ok(req.result as T);
        req.onerror = () => fail(req.error);
      }),
  );
}

export const idbGet = <T>(key: string) => run<T | undefined>('readonly', (s) => s.get(key));
export const idbSet = (key: string, value: unknown) => run<void>('readwrite', (s) => s.put(value, key));
export const idbDel = (key: string) => run<void>('readwrite', (s) => s.delete(key));
