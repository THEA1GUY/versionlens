"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Stage } from "@/lib/engine/compare";
import type { LlmSettings } from "@/lib/engine/providers";
import { providerById } from "@/lib/engine/providers";
import type { StoredDocument } from "@/lib/store/db";
import { loadLlmSettings } from "@/lib/store/settings";
import { MAX_FILE_BYTES, ingestFile, runComparison } from "@/lib/workflow";
import { formatBytes } from "@/lib/format";
import { ErrorNote, LocalBadge, Spinner, WarningNote } from "@/components/ui";
import { ProcessingView } from "@/components/panels";

type Slot = "a" | "b";

interface SlotState {
  file: File | null;
  stored: StoredDocument | null;
  busy: boolean;
  error: string | null;
}

const EMPTY: SlotState = { file: null, stored: null, busy: false, error: null };

export default function NewComparisonPage() {
  const router = useRouter();
  const [slots, setSlots] = useState<Record<Slot, SlotState>>({ a: EMPTY, b: EMPTY });
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const [llm, setLlm] = useState<LlmSettings | null>(null);
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<{ stage: Stage; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadLlmSettings().then(setLlm).catch(() => setLlm(null));
  }, []);

  const ingest = useCallback(async (slot: Slot, file: File) => {
    setSlots((prev) => ({ ...prev, [slot]: { file, stored: null, busy: true, error: null } }));
    try {
      const stored = await ingestFile(file, slot === "a" ? "A" : "B");
      setSlots((prev) => ({ ...prev, [slot]: { file, stored, busy: false, error: null } }));
      setName((current) => current || suggestName(file.name));
    } catch (err) {
      setSlots((prev) => ({
        ...prev,
        [slot]: {
          file,
          stored: null,
          busy: false,
          error: err instanceof Error ? err.message : String(err),
        },
      }));
    }
  }, []);

  const ready = Boolean(slots.a.stored && slots.b.stored);
  const sameFile =
    slots.a.stored && slots.b.stored && slots.a.stored.sha256 === slots.b.stored.sha256;

  async function submit(): Promise<void> {
    if (!slots.a.stored || !slots.b.stored) return;
    setRunning(true);
    setError(null);
    try {
      const comparison = await runComparison(slots.a.stored.id, slots.b.stored.id, {
        name,
        documentCategory: category || null,
        notes: notes.trim() || null,
        onProgress: (s, message) => setStage({ stage: s, message }),
      });
      router.push(`/comparisons/${comparison.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRunning(false);
    }
  }

  if (running) {
    return (
      <ProcessingView
        status={stage?.stage ?? "EXTRACTING"}
        message={stage?.message ?? "Starting"}
        error={error}
      />
    );
  }

  const provider = llm ? providerById(llm.provider) : null;

  return (
    <div className="mx-auto max-w-[860px] px-4 py-10 sm:px-6">
      <nav className="mb-5 text-[12.5px] text-ink-faint">
        <Link href="/" className="hover:text-ink hover:underline">
          Dashboard
        </Link>
        <span aria-hidden="true"> / </span>
        <span>New comparison</span>
      </nav>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="serif-title text-[26px] font-semibold">Compare versions</h1>
        <LocalBadge />
      </div>
      <p className="mt-2 max-w-prose text-[13.5px] text-ink-soft">
        Both files are read in this browser, hashed, and stored on this device. Neither
        file is uploaded or modified.
      </p>

      <div className="mt-7 grid gap-4 sm:grid-cols-2">
        <UploadSlot
          slot="a"
          title="Version A"
          hint="The earlier version"
          state={slots.a}
          onPick={(file) => void ingest("a", file)}
          onClear={() => setSlots((prev) => ({ ...prev, a: EMPTY }))}
        />
        <UploadSlot
          slot="b"
          title="Version B"
          hint="The revised version"
          state={slots.b}
          onPick={(file) => void ingest("b", file)}
          onClear={() => setSlots((prev) => ({ ...prev, b: EMPTY }))}
        />
      </div>

      {sameFile ? (
        <div className="mt-4">
          <WarningNote>
            Both slots hold the same file — identical SHA-256. The comparison will report
            no changes.
          </WarningNote>
        </div>
      ) : null}

      <fieldset className="card mt-6 p-5">
        <legend className="label-caps px-1">Comparison details (optional)</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[12.5px] font-medium text-ink-soft">
              Comparison name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Partnership Agreement — September Revision"
              className="w-full rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12.5px] font-medium text-ink-soft">
              Document category
            </span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
            >
              <option value="">Not specified</option>
              <option value="proposal">Proposal</option>
              <option value="partnership_agreement">Partnership agreement</option>
              <option value="contract">Contract</option>
              <option value="statement_of_work">Statement of work</option>
              <option value="service_agreement">Service agreement</option>
              <option value="procurement">Procurement document</option>
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[12.5px] font-medium text-ink-soft">Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Context for reviewers — what prompted this revision?"
              className="w-full resize-y rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
            />
          </label>
        </div>
      </fieldset>

      <p className="mt-3 text-[12px] text-ink-soft">
        {llm?.enabled && provider ? (
          <>
            Semantic analysis is <span className="font-medium text-ink">on</span>, using{" "}
            {provider.label} ({llm.model}). Aligned passages are sent to that provider with
            your key.
          </>
        ) : (
          <>
            Semantic analysis is off — comparison will use deterministic signals only.{" "}
            <Link href="/settings" className="text-accent hover:underline">
              Add a model key
            </Link>{" "}
            to enable meaning-change detection.
          </>
        )}
      </p>

      {error ? (
        <div className="mt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      ) : null}

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!ready}
          className="rounded-md bg-ink px-4 py-2 text-[13.5px] font-medium text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:bg-ink-faint"
        >
          Compare documents
        </button>
        {!ready ? (
          <span className="text-[12.5px] text-ink-faint">Add both versions to continue.</span>
        ) : null}
      </div>
    </div>
  );
}

function suggestName(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
  return stem.replace(/\b(v?\d+|final|draft|rev\w*)\b/gi, "").trim();
}

function UploadSlot({
  slot,
  title,
  hint,
  state,
  onPick,
  onClear,
}: {
  slot: Slot;
  title: string;
  hint: string;
  state: SlotState;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleFiles(files: FileList | null): void {
    const file = files?.[0];
    if (file) onPick(file);
  }

  return (
    <div
      className={`card p-4 transition-colors ${dragging ? "border-accent bg-accent-soft" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      <div className="flex items-baseline justify-between">
        <h2 className="text-[13.5px] font-semibold">{title}</h2>
        <span className="text-[11.5px] text-ink-faint">{hint}</span>
      </div>

      <input
        ref={inputRef}
        id={`file-${slot}`}
        type="file"
        accept=".pdf,.docx,.txt,.md"
        className="sr-only"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {state.stored ? (
        <div className="mt-3">
          <div className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-[1px] text-add">
              ✓
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{state.stored.filename}</p>
              <p className="text-[11.5px] text-ink-faint">
                {state.stored.model.pages.length} page
                {state.stored.model.pages.length === 1 ? "" : "s"} ·{" "}
                {state.stored.model.blocks.length} blocks ·{" "}
                {formatBytes(state.stored.sizeBytes)}
              </p>
              <p className="mt-1 font-mono text-[10.5px] text-ink-faint">
                sha256 {state.stored.sha256.slice(0, 16)}…
              </p>
            </div>
            <button
              type="button"
              onClick={onClear}
              className="text-[12px] text-ink-faint hover:text-remove hover:underline"
            >
              Replace
            </button>
          </div>
          {state.stored.model.warnings.length > 0 ? (
            <div className="mt-3">
              <WarningNote>
                <ul className="list-inside list-disc space-y-0.5">
                  {state.stored.model.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </WarningNote>
            </div>
          ) : null}
        </div>
      ) : state.busy ? (
        <div className="mt-4">
          <Spinner label={`Reading ${state.file?.name ?? "document"}…`} />
        </div>
      ) : (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="w-full rounded-md border border-dashed border-rule px-3 py-6 text-[13px] text-ink-soft transition-colors hover:border-accent hover:bg-canvas hover:text-ink"
          >
            <span className="block font-medium">Choose file</span>
            <span className="mt-0.5 block text-[11.5px] text-ink-faint">
              or drag and drop — PDF, DOCX, up to {formatBytes(MAX_FILE_BYTES)}
            </span>
          </button>
          {state.error ? (
            <div className="mt-2">
              <ErrorNote>{state.error}</ErrorNote>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
