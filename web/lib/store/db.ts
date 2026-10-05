/**
 * Local-first storage. Everything lives in this browser's IndexedDB.
 *
 * There is no server in this path: original files, extracted text and comparison
 * results never leave the machine. That is the privacy guarantee — structural, not a
 * promise — and it is also why there is no account system to log into.
 */

import type { Change, ReviewStatus, ReviewerNote } from "../engine/changes";
import type { ComparisonResult } from "../engine/compare";
import type { DocumentModel } from "../engine/model";

const DB_NAME = "versionlens";
const DB_VERSION = 1;

export const STORE_DOCS = "documents";
export const STORE_FILES = "files";
export const STORE_COMPARISONS = "comparisons";
export const STORE_SETTINGS = "settings";

export interface StoredDocument {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  /** The extracted model: pages, sections, blocks, all provenance intact. */
  model: DocumentModel;
}

export interface StoredComparison {
  id: string;
  name: string;
  documentCategory: string | null;
  notes: string | null;
  /** Ordered oldest-first. Two entries today; more for a version lineage. */
  documentIds: string[];
  createdAt: string;
  completedAt: string | null;
  status: ComparisonResult["status"];
  stageMessage: string | null;
  result: ComparisonResult | null;
  /** Review state lives outside `result` so re-running a comparison can preserve it. */
  review: Record<string, { status: ReviewStatus; reviewedAt: string; notes: ReviewerNote[] }>;
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("This browser has no IndexedDB, so nothing can be saved."));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_DOCS)) {
          db.createObjectStore(STORE_DOCS, { keyPath: "id" });
        }
        // Original bytes kept separately so listing documents never loads them.
        if (!db.objectStoreNames.contains(STORE_FILES)) {
          db.createObjectStore(STORE_FILES);
        }
        if (!db.objectStoreNames.contains(STORE_COMPARISONS)) {
          const store = db.createObjectStore(STORE_COMPARISONS, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt");
        }
        if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
          db.createObjectStore(STORE_SETTINGS);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not open local storage."));
      request.onblocked = () =>
        reject(new Error("Local storage is blocked by another open tab. Close it and retry."));
    });
  }
  return dbPromise;
}

/**
 * Run writes in one transaction and resolve when it commits.
 *
 * Resolving on `oncomplete` rather than on each request matters: IndexedDB reports a
 * request as successful before the transaction commits, so resolving early would let
 * a caller read back data that a later abort rolls away.
 */
function write(
  storeNames: string | string[],
  run: (stores: IDBObjectStore[]) => void,
): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const names = Array.isArray(storeNames) ? storeNames : [storeNames];
        const transaction = db.transaction(names, "readwrite");
        try {
          run(names.map((n) => transaction.objectStore(n)));
        } catch (err) {
          transaction.abort();
          reject(err);
          return;
        }
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () =>
          reject(transaction.error ?? new Error("Storage write was aborted."));
      }),
  );
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ---------------------------------------------------------------- documents */

export async function putDocument(doc: StoredDocument, original: Blob): Promise<void> {
  await write([STORE_DOCS, STORE_FILES], ([docs, files]) => {
    docs!.put(doc);
    files!.put(original, doc.id);
  });
}

export async function getDocument(id: string): Promise<StoredDocument | undefined> {
  const db = await openDb();
  return request(db.transaction(STORE_DOCS).objectStore(STORE_DOCS).get(id));
}

export async function getOriginal(id: string): Promise<Blob | undefined> {
  const db = await openDb();
  return request(db.transaction(STORE_FILES).objectStore(STORE_FILES).get(id));
}

export async function listDocuments(): Promise<StoredDocument[]> {
  const db = await openDb();
  const all = await request<StoredDocument[]>(
    db.transaction(STORE_DOCS).objectStore(STORE_DOCS).getAll(),
  );
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteDocument(id: string): Promise<void> {
  await write([STORE_DOCS, STORE_FILES], ([docs, files]) => {
    docs!.delete(id);
    files!.delete(id);
  });
}

/* -------------------------------------------------------------- comparisons */

export async function putComparison(comparison: StoredComparison): Promise<void> {
  await write(STORE_COMPARISONS, ([store]) => {
    store!.put(comparison);
  });
}

export async function getComparison(id: string): Promise<StoredComparison | undefined> {
  const db = await openDb();
  return request(db.transaction(STORE_COMPARISONS).objectStore(STORE_COMPARISONS).get(id));
}

export async function listComparisons(): Promise<StoredComparison[]> {
  const db = await openDb();
  const all = await request<StoredComparison[]>(
    db.transaction(STORE_COMPARISONS).objectStore(STORE_COMPARISONS).getAll(),
  );
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteComparison(id: string): Promise<void> {
  await write(STORE_COMPARISONS, ([store]) => {
    store!.delete(id);
  });
}

/** Review decisions are stored per comparison, keyed by the engine's change id. */
export async function setReview(
  comparisonId: string,
  changeId: string,
  status: ReviewStatus,
  note?: string,
  author?: string | null,
): Promise<StoredComparison | undefined> {
  const comparison = await getComparison(comparisonId);
  if (!comparison) return undefined;

  const existing = comparison.review[changeId];
  const notes = existing?.notes ? [...existing.notes] : [];
  if (note?.trim()) {
    notes.push({
      author: author ?? null,
      body: note.trim(),
      createdAt: new Date().toISOString(),
    });
  }
  comparison.review[changeId] = { status, reviewedAt: new Date().toISOString(), notes };
  await putComparison(comparison);
  return comparison;
}

/** Fold stored review state onto the engine's changes for display. */
export function applyReview(comparison: StoredComparison): Change[] {
  const changes = comparison.result?.changes ?? [];
  return changes.map((change) => {
    const review = comparison.review[change.id];
    if (!review) return change;
    return {
      ...change,
      reviewStatus: review.status,
      reviewedAt: review.reviewedAt,
      reviewerNotes: review.notes,
    };
  });
}

/* ----------------------------------------------------------------- settings */

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return request<T>(db.transaction(STORE_SETTINGS).objectStore(STORE_SETTINGS).get(key));
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  await write(STORE_SETTINGS, ([store]) => {
    store!.put(value, key);
  });
}

/* -------------------------------------------------------------------- admin */

export interface StorageUsage {
  documents: number;
  comparisons: number;
  bytesUsed: number | null;
  bytesQuota: number | null;
}

export async function storageUsage(): Promise<StorageUsage> {
  const [docs, comparisons] = await Promise.all([listDocuments(), listComparisons()]);
  let bytesUsed: number | null = null;
  let bytesQuota: number | null = null;
  if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      bytesUsed = estimate.usage ?? null;
      bytesQuota = estimate.quota ?? null;
    } catch {
      // Storage estimates are advisory; failing to read one is not an error.
    }
  }
  return {
    documents: docs.length,
    comparisons: comparisons.length,
    bytesUsed,
    bytesQuota,
  };
}

/** Erase everything this browser holds. Irreversible, and entirely local. */
export async function eraseAll(): Promise<void> {
  await write([STORE_DOCS, STORE_FILES, STORE_COMPARISONS], ([docs, files, comparisons]) => {
    docs!.clear();
    files!.clear();
    comparisons!.clear();
  });
}

export function newId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      : Math.random().toString(36).slice(2, 18);
  return `${prefix}_${rand}`;
}
