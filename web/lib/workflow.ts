/**
 * Application workflow: ingest files, run comparisons, record reviews.
 *
 * This replaces the HTTP client. Every operation runs in the browser against local
 * storage, so there is no network call anywhere in this module except the one the user
 * explicitly enables — their own model provider, called from the engine.
 */

import type { ReviewStatus } from "./engine/changes";
import { type ComparisonResult, type Stage, compareDocuments } from "./engine/compare";
import { extractFile, isSupported } from "./engine/extract";
import type { DocumentModel, Side } from "./engine/model";
import { SemanticAnalyzer } from "./engine/semantic";
import {
  type StoredChain,
  type StoredComparison,
  type StoredDocument,
  applyReview,
  deleteComparison,
  getComparison,
  getDocument,
  getOriginal,
  listComparisons,
  listDocuments,
  getChain,
  listChains,
  newId,
  putChain,
  putComparison,
  putDocument,
  setReview,
} from "./store/db";
import { loadLlmSettings, loadPreferences } from "./store/settings";

export const MAX_FILE_BYTES = 80 * 1024 * 1024;

export class IngestError extends Error {}

/** Read, hash and extract a file, then keep both the original and the model locally. */
export async function ingestFile(file: File, side: Side = "A"): Promise<StoredDocument> {
  if (!isSupported(file.name)) {
    throw new IngestError(
      `${file.name} is not a supported format. Upload a PDF, DOCX or plain text file.`,
    );
  }
  if (file.size === 0) throw new IngestError(`${file.name} is empty.`);
  if (file.size > MAX_FILE_BYTES) {
    throw new IngestError(
      `${file.name} is larger than ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB.`,
    );
  }

  let model: DocumentModel;
  try {
    model = await extractFile(file, side);
  } catch (err) {
    throw new IngestError(
      `Could not read ${file.name}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (model.blocks.length === 0) {
    throw new IngestError(
      `No text could be read from ${file.name}. If it is a scan, it needs OCR first.`,
    );
  }

  const stored: StoredDocument = {
    id: newId("doc"),
    filename: file.name,
    mimeType: model.mimeType,
    sizeBytes: file.size,
    sha256: model.sha256,
    createdAt: new Date().toISOString(),
    model,
  };
  await putDocument(stored, file);
  return stored;
}

export interface RunOptions {
  name?: string;
  documentCategory?: string | null;
  notes?: string | null;
  onProgress?: (stage: Stage, message: string) => void;
}

/**
 * Compare two stored documents and persist the result.
 *
 * The stored model is cloned before use: extraction output is mutated in place by
 * segmentation, and the copy in IndexedDB must stay as it was extracted.
 */
export async function runComparison(
  documentIdA: string,
  documentIdB: string,
  options: RunOptions = {},
): Promise<StoredComparison> {
  const [docA, docB] = await Promise.all([getDocument(documentIdA), getDocument(documentIdB)]);
  if (!docA || !docB) throw new IngestError("One of the documents is no longer stored locally.");

  const [llm, prefs] = await Promise.all([loadLlmSettings(), loadPreferences()]);
  const analyzer = llm.enabled ? new SemanticAnalyzer(llm) : null;

  const comparison: StoredComparison = {
    id: newId("cmp"),
    name: options.name?.trim() || `${docA.filename} vs ${docB.filename}`,
    documentCategory: options.documentCategory ?? null,
    notes: options.notes ?? null,
    documentIds: [docA.id, docB.id],
    createdAt: new Date().toISOString(),
    completedAt: null,
    status: "EXTRACTING",
    stageMessage: "Starting",
    result: null,
    review: {},
  };
  await putComparison(comparison);

  const result = await compareDocuments(
    cloneModel(docA.model, "A"),
    cloneModel(docB.model, "B"),
    {
      labelA: docA.filename,
      labelB: docB.filename,
      analyzer,
      locale: prefs.locale,
      progress: (stage, message) => {
        comparison.status = stage;
        comparison.stageMessage = message;
        options.onProgress?.(stage, message);
      },
    },
  );

  comparison.result = result;
  comparison.status = result.status;
  comparison.stageMessage = result.error ?? "Comparison complete";
  comparison.completedAt = new Date().toISOString();
  await putComparison(comparison);
  return comparison;
}

/** Structured clone, with the side re-stamped for whichever slot it fills. */
function cloneModel(model: DocumentModel, side: Side): DocumentModel {
  const copy =
    typeof structuredClone === "function"
      ? structuredClone(model)
      : (JSON.parse(JSON.stringify(model)) as DocumentModel);
  copy.side = side;
  for (const block of copy.blocks) block.side = side;
  for (const section of copy.sections) section.side = side;
  return copy;
}

export interface ChainOptions {
  name?: string;
  onProgress?: (step: number, totalSteps: number, stage: Stage, message: string) => void;
}

/**
 * Compare an ordered run of versions, consecutively.
 *
 * Each step is an ordinary comparison with its own citations, so nothing about the
 * evidence is weaker than a two-version review. What the chain adds is the ability to
 * read a value across the whole negotiation.
 */
export async function runChain(
  documentIds: string[],
  options: ChainOptions = {},
): Promise<StoredChain> {
  if (documentIds.length < 2) {
    throw new IngestError("A version chain needs at least two documents.");
  }
  const docs = await Promise.all(documentIds.map((id) => getDocument(id)));
  if (docs.some((d) => !d)) {
    throw new IngestError("One of the documents is no longer stored locally.");
  }

  const totalSteps = documentIds.length - 1;
  const comparisonIds: string[] = [];
  for (let i = 0; i < totalSteps; i++) {
    const comparison = await runComparison(documentIds[i]!, documentIds[i + 1]!, {
      name: `${docs[i]!.filename} → ${docs[i + 1]!.filename}`,
      onProgress: (stage, message) => options.onProgress?.(i + 1, totalSteps, stage, message),
    });
    comparisonIds.push(comparison.id);
  }

  const chain: StoredChain = {
    id: newId("chn"),
    name: options.name?.trim() || `${docs[0]!.filename} → ${docs[totalSteps]!.filename}`,
    documentIds,
    comparisonIds,
    createdAt: new Date().toISOString(),
  };
  await putChain(chain);
  return chain;
}

/** Load a chain with its steps resolved, oldest first. */
export async function loadChain(
  id: string,
): Promise<{ chain: StoredChain; steps: StoredComparison[]; names: string[] } | null> {
  const chain = await getChain(id);
  if (!chain) return null;
  const steps = (await Promise.all(chain.comparisonIds.map((c) => getComparison(c)))).filter(
    (c): c is StoredComparison => Boolean(c),
  );
  const docs = await Promise.all(chain.documentIds.map((d) => getDocument(d)));
  return { chain, steps, names: docs.map((d, i) => d?.filename ?? `Version ${i + 1}`) };
}

export async function reviewChange(
  comparisonId: string,
  changeId: string,
  status: ReviewStatus,
  note?: string,
): Promise<StoredComparison | undefined> {
  const prefs = await loadPreferences();
  return setReview(comparisonId, changeId, status, note, prefs.reviewerName || null);
}

export interface ReviewProgress {
  total: number;
  reviewed: number;
  confirmed: number;
  falseAlerts: number;
  needsDiscussion: number;
  resolved: number;
  unreviewed: number;
}

export function reviewProgress(comparison: StoredComparison): ReviewProgress {
  const changes = comparison.result?.changes ?? [];
  const counts: ReviewProgress = {
    total: changes.length,
    reviewed: 0,
    confirmed: 0,
    falseAlerts: 0,
    needsDiscussion: 0,
    resolved: 0,
    unreviewed: 0,
  };
  for (const change of changes) {
    const status = comparison.review[change.id]?.status ?? "unreviewed";
    if (status === "unreviewed") {
      counts.unreviewed += 1;
      continue;
    }
    counts.reviewed += 1;
    if (status === "confirmed") counts.confirmed += 1;
    else if (status === "false_alert") counts.falseAlerts += 1;
    else if (status === "needs_discussion") counts.needsDiscussion += 1;
    else if (status === "resolved") counts.resolved += 1;
  }
  return counts;
}

/** Verify a stored original still hashes to what was recorded when it was ingested. */
export async function verifyIntegrity(documentId: string): Promise<"verified" | "failed" | "missing"> {
  const [doc, blob] = await Promise.all([getDocument(documentId), getOriginal(documentId)]);
  if (!doc || !blob) return "missing";
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex === doc.sha256 ? "verified" : "failed";
}

export async function originalUrl(documentId: string): Promise<string | null> {
  const blob = await getOriginal(documentId);
  return blob ? URL.createObjectURL(blob) : null;
}

export {
  applyReview,
  deleteComparison,
  getChain,
  listChains,
  getComparison,
  getDocument,
  getOriginal,
  listComparisons,
  listDocuments,
  type ComparisonResult,
  type StoredChain,
  type StoredComparison,
  type StoredDocument,
};
