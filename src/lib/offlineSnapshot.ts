// IndexedDB snapshot of the last-known public market state (spot/vol), keyed
// by wallet address ("anon" when signed out). Holds no tokens and no authed
// account data, and is wiped on disconnect/sign-out.
const DB = "zenith-offline";
const STORE = "snapshots";

export interface MarketSnapshot<T = unknown> { savedAt: number; data: T }

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<R>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<R> | void): Promise<R | undefined> {
  try {
    const db = await open();
    return await new Promise<R | undefined>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const r = fn(t.objectStore(STORE));
      t.oncomplete = () => { db.close(); resolve(r ? (r as IDBRequest<R>).result : undefined); };
      t.onerror = () => { db.close(); reject(t.error); };
    });
  } catch {
    return undefined; // IndexedDB unavailable (private mode etc.) — snapshots are best-effort
  }
}

export const saveSnapshot = <T,>(key: string, data: T) =>
  tx("readwrite", (s) => { s.put({ savedAt: Date.now(), data } satisfies MarketSnapshot<T>, key); });
export const loadSnapshot = <T,>(key: string) => tx<MarketSnapshot<T>>("readonly", (s) => s.get(key) as IDBRequest<MarketSnapshot<T>>);
export const clearSnapshots = () => tx("readwrite", (s) => { s.clear(); });
