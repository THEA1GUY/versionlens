/**
 * An ephemeral stand-in for IndexedDB, used only by the embedded demo.
 *
 * Inside a cross-origin frame IndexedDB can be unavailable entirely. Rather than branch
 * all fourteen accessors in `db.ts`, this implements the narrow slice of the IndexedDB
 * surface those accessors actually touch — `transaction`, `objectStore`, `put`, `get`,
 * `getAll`, `delete`, `clear` — so every bit of real storage logic above it (the
 * commit-on-complete transaction wrapper, the sort order, review folding) runs unchanged
 * and stays covered by the existing tests.
 *
 * Data lives in module scope: it survives client-side navigation and dies on reload.
 * That is the intent — nothing a visitor does in the demo should persist.
 */

type Store = Map<string, unknown>;

const stores = new Map<string, Store>();

function storeFor(name: string): Store {
  let store = stores.get(name);
  if (!store) {
    store = new Map<string, unknown>();
    stores.set(name, store);
  }
  return store;
}

interface FakeRequest<T> {
  result: T | undefined;
  error: DOMException | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}

/**
 * Resolve on a microtask, because `db.ts` attaches `onsuccess` after the call returns.
 * Firing synchronously would run before any handler exists and hang the caller.
 */
function succeed<T>(value: T): FakeRequest<T> {
  const req: FakeRequest<T> = { result: value, error: null, onsuccess: null, onerror: null };
  queueMicrotask(() => req.onsuccess?.());
  return req;
}

class FakeObjectStore {
  constructor(
    private readonly name: string,
    private readonly tx: FakeTransaction,
  ) {}

  /**
   * Every keyPath store in `db.ts` keys on `id`, and the out-of-line stores always pass
   * an explicit key, so no per-store keyPath table is needed.
   */
  put(value: unknown, key?: string): FakeRequest<string> {
    const inline =
      value && typeof value === "object" && "id" in value
        ? String((value as { id: unknown }).id)
        : undefined;
    const resolved = key ?? inline;
    if (resolved === undefined) {
      // A real IndexedDB store throws DataError here rather than storing junk.
      throw new Error(`${this.name} needs a key`);
    }
    this.tx.pending.push(() => storeFor(this.name).set(resolved, value));
    return succeed(resolved);
  }

  get(key: string): FakeRequest<unknown> {
    return succeed(storeFor(this.name).get(key));
  }

  getAll(): FakeRequest<unknown[]> {
    return succeed([...storeFor(this.name).values()]);
  }

  delete(key: string): FakeRequest<undefined> {
    this.tx.pending.push(() => storeFor(this.name).delete(key));
    return succeed(undefined);
  }

  clear(): FakeRequest<undefined> {
    this.tx.pending.push(() => storeFor(this.name).clear());
    return succeed(undefined);
  }
}

class FakeTransaction {
  /** Writes are buffered and applied on commit, so `abort()` really does roll back. */
  readonly pending: Array<() => void> = [];
  error: DOMException | null = null;
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private aborted = false;

  constructor() {
    // A timer, not a microtask: the caller's synchronous body queues its request
    // microtasks first, and commit must land after all of them.
    setTimeout(() => {
      if (this.aborted) return;
      for (const apply of this.pending) apply();
      this.oncomplete?.();
    }, 0);
  }

  objectStore(name: string): FakeObjectStore {
    return new FakeObjectStore(name, this);
  }

  abort(): void {
    this.aborted = true;
    this.pending.length = 0;
    this.onabort?.();
  }
}

/**
 * A fake `IDBDatabase`. Cast at the boundary because only `transaction()` is ever used;
 * implementing the rest of the interface would be dead code.
 */
export function memoryDatabase(): IDBDatabase {
  const db = { transaction: () => new FakeTransaction() };
  return db as unknown as IDBDatabase;
}

/** Test helper: forget everything the demo put here. */
export function resetMemoryDatabase(): void {
  stores.clear();
}
