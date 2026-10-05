"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import type { Health, UploadedDocument } from "@/lib/types";
import { Disclaimer, Spinner, WarningNote } from "@/components/ui";

type Slot = "a" | "b";

interface SlotState {
  file: File | null;
  uploaded: UploadedDocument | null;
  uploading: boolean;
  error: string | null;
}

const EMPTY: SlotState = { file: null, uploaded: null, uploading: false, error: null };

export default function NewComparisonPage() {
  const router = useRouter();
  const [slots, setSlots] = useState<Record<Slot, SlotState>>({ a: EMPTY, b: EMPTY });
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const [locale, setLocale] = useState<"DMY" | "MDY">("DMY");
  const [useSemantic, setUseSemantic] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  const upload = useCallback(async (slot: Slot, file: File) => {
    setSlots((prev) => ({
      ...prev,
      [slot]: { file, uploaded: null, uploading: true, error: null },
    }));
    try {
      const uploaded = await api.uploadDocument(file);
      setSlots((prev) => ({
        ...prev,
        [slot]: { file, uploaded, uploading: false, error: null },
      }));
      // Suggest a comparison name once both filenames are known.
      setName((current) => current || suggestName(file.name));
    } catch (err) {
      setSlots((prev) => ({
        ...prev,
        [slot]: { file, uploaded: null, uploading: false, error: (err as Error).message },
      }));
    }
  }, []);

  const ready = Boolean(slots.a.uploaded && slots.b.uploaded);
  const sameFile =
    slots.a.uploaded && slots.b.uploaded && slots.a.uploaded.sha256 === slots.b.uploaded.sha256;

  async function submit() {
    if (!slots.a.uploaded || !slots.b.uploaded) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { id } = await api.createComparison({
        version_a_document_id: slots.a.uploaded.id,
        version_b_document_id: slots.b.uploaded.id,
        name: name.trim() || undefined,
        document_category: category || undefined,
        notes: notes.trim() || undefined,
        locale,
        use_semantic: useSemantic,
      });
      router.push(`/comparisons/${id}`);
    } catch (err) {
      setSubmitError((err as Error).message);
      setSubmitting(false);
    }
  }

  const accept = health?.supported_formats.join(",") ?? ".pdf,.docx,.txt";

  return (
    <div className="mx-auto max-w-[860px] px-4 py-10 sm:px-6">
      <nav className="mb-5 text-[12.5px] text-ink-faint">
        <Link href="/" className="hover:text-ink hover:underline">
          Dashboard
        </Link>
        <span aria-hidden="true"> / </span>
        <span>New comparison</span>
      </nav>

      <h1 className="serif-title text-[26px] font-semibold">Compare versions</h1>
      <p className="mt-2 max-w-prose text-[13.5px] text-ink-soft">
        Both originals are stored unchanged and hashed on upload. Neither file is modified.
      </p>

      <div className="mt-7 grid gap-4 sm:grid-cols-2">
        <UploadSlot
          slot="a"
          title="Version A"
          hint="The earlier version"
          state={slots.a}
          accept={accept}
          maxBytes={health?.max_upload_bytes}
          onPick={(file) => upload("a", file)}
          onClear={() => setSlots((prev) => ({ ...prev, a: EMPTY }))}
        />
        <UploadSlot
          slot="b"
          title="Version B"
          hint="The revised version"
          state={slots.b}
          accept={accept}
          maxBytes={health?.max_upload_bytes}
          onPick={(file) => upload("b", file)}
          onClear={() => setSlots((prev) => ({ ...prev, b: EMPTY }))}
        />
      </div>

      {sameFile ? (
        <div className="mt-4">
          <WarningNote>
            Both slots hold the same file — identical SHA-256. The comparison will report no
            changes.
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
          <label className="block">
            <span className="mb-1 block text-[12.5px] font-medium text-ink-soft">
              Numeric date order
            </span>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value as "DMY" | "MDY")}
              className="w-full rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
            >
              <option value="DMY">Day/Month/Year — 15/10/2026</option>
              <option value="MDY">Month/Day/Year — 10/15/2026</option>
            </select>
            <span className="mt-1 block text-[11.5px] text-ink-faint">
              Dates like 04/05/2026 are flagged as low confidence either way.
            </span>
          </label>
          <label className="flex items-start gap-2.5 pt-6">
            <input
              type="checkbox"
              checked={useSemantic}
              disabled={!health?.semantic_available}
              onChange={(e) => setUseSemantic(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 accent-[#1a4fd6]"
            />
            <span className="text-[12.5px]">
              <span className="font-medium">Semantic meaning analysis</span>
              <span className="block text-[11.5px] text-ink-faint">
                {health?.semantic_available
                  ? "Reviews aligned passages for meaning changes a text diff cannot see."
                  : "No analysis model configured — deterministic comparison only."}
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      {submitError ? (
        <p className="mt-4 text-[13px] text-remove">{submitError}</p>
      ) : null}

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={!ready || submitting}
          className="rounded-md bg-ink px-4 py-2 text-[13.5px] font-medium text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:bg-ink-faint"
        >
          {submitting ? "Starting…" : "Compare documents"}
        </button>
        {!ready ? (
          <span className="text-[12.5px] text-ink-faint">Upload both versions to continue.</span>
        ) : null}
      </div>

      {health ? (
        <footer className="mt-10 border-t border-rule pt-4">
          <Disclaimer text={health.disclaimer} />
        </footer>
      ) : null}
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
  accept,
  maxBytes,
  onPick,
  onClear,
}: {
  slot: Slot;
  title: string;
  hint: string;
  state: SlotState;
  accept: string;
  maxBytes: number | undefined;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleFiles(files: FileList | null) {
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
        accept={accept}
        className="sr-only"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {state.uploaded ? (
        <div className="mt-3">
          <div className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-[1px] text-add">
              ✓
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{state.uploaded.filename}</p>
              <p className="text-[11.5px] text-ink-faint">
                {state.uploaded.page_count} page{state.uploaded.page_count === 1 ? "" : "s"} ·{" "}
                {state.uploaded.section_count} sections ·{" "}
                {formatBytes(state.uploaded.size_bytes)}
              </p>
              <p className="mt-1 font-mono text-[10.5px] text-ink-faint">
                sha256 {state.uploaded.sha256.slice(0, 16)}…
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
          {state.uploaded.warnings.length > 0 ? (
            <div className="mt-3">
              <WarningNote>
                <ul className="list-inside list-disc">
                  {state.uploaded.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </WarningNote>
            </div>
          ) : null}
        </div>
      ) : state.uploading ? (
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
            <span className="block font-medium">Upload file</span>
            <span className="mt-0.5 block text-[11.5px] text-ink-faint">
              or drag and drop — PDF, DOCX
              {maxBytes ? `, up to ${formatBytes(maxBytes)}` : ""}
            </span>
          </button>
          {state.error ? (
            <p className="mt-2 text-[12.5px] text-remove">{state.error}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
