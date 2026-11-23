/**
 * Client → target records: written to memory synchronously and to IndexedDB through
 * `waitUntil`; looked up memory first, then IndexedDB (design D8).
 */
import type { Family } from '../contract.js'
import { IDB_NAME, IDB_STORE } from './constants.js'

export interface ClientTarget {
  fam: Family
  port: string
}

const memory = new Map<string, ClientTarget>()

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(IDB_NAME, 1)
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(IDB_STORE)) open.result.createObjectStore(IDB_STORE)
    }
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(IDB_STORE, mode).objectStore(IDB_STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

/** Remember synchronously; the returned promise is the IndexedDB write (pass it to `waitUntil`). */
export function rememberClient(clientId: string, target: ClientTarget): Promise<void> {
  memory.set(clientId, target)
  return withStore('readwrite', (store) => store.put(target, clientId)).then(() => undefined)
}

export async function lookupClient(clientId: string): Promise<ClientTarget | undefined> {
  const hit = memory.get(clientId)
  if (hit !== undefined) return hit
  if (clientId === '') return undefined
  try {
    const stored = (await withStore('readonly', (store) => store.get(clientId))) as ClientTarget | undefined
    if (stored !== undefined && (stored.fam === 'p' || stored.fam === 'p6') && /^\d+$/.test(stored.port)) {
      memory.set(clientId, stored)
      return stored
    }
  } catch {
    /* unreadable store: treat as unknown (fail closed → 502) */
  }
  return undefined
}

/** Drop records of clients that no longer exist. */
export async function pruneClients(aliveIds: ReadonlySet<string>): Promise<void> {
  const keys = (await withStore('readonly', (store) => store.getAllKeys())) as string[]
  for (const key of keys) {
    if (aliveIds.has(key)) continue
    memory.delete(key)
    await withStore('readwrite', (store) => store.delete(key))
  }
}
