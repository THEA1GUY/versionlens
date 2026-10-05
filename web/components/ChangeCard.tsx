"use client";

import { useState } from "react";
import type { Change, Citation, ReviewStatus, Side } from "@/lib/types";
import { citationLabel, formatDateTime, formatDelta, valuePair } from "@/lib/format";
import {
  AttentionBadge,
  CategoryChip,
  ConfidenceTag,
  DiffText,
  ReviewStatusTag,
  TypeChip,
} from "./ui";

const REVIEW_ACTIONS: { status: ReviewStatus; label: string }[] = [
  { status: "confirmed", label: "Confirm" },
  { status: "false_alert", label: "False alert" },
  { status: "needs_discussion", label: "Needs discussion" },
];

const DETECTOR_LABEL: Record<string, string> = {
  text_diff: "Text difference",
  structured_extraction: "Structured value comparison",
  semantic_analysis: "Semantic analysis",
  section_alignment: "Section alignment",
};

export function ChangeCard({
  change,
  selected,
  onSelect,
  onReview,
  onCitation,
}: {
  change: Change;
  selected: boolean;
  onSelect: () => void;
  onReview: (status: ReviewStatus, comment?: string) => Promise<void>;
  onCitation: (side: Side, citation: Citation) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [saving, setSaving] = useState<ReviewStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pair = valuePair(change);
  const deltas = formatDelta(change);

  async function act(status: ReviewStatus) {
    setSaving(status);
    setError(null);
    try {
      await onReview(status, noteDraft.trim() || undefined);
      setNoteDraft("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(null);
    }
  }

  return (
    <article
      id={`change-${change.record_id}`}
      onClick={onSelect}
      className={`card scroll-mt-4 cursor-pointer p-3.5 transition-shadow ${
        selected ? "border-accent shadow-[0_0_0_1px_var(--color-accent)]" : "hover:border-ink-faint"
      } ${change.review_status === "false_alert" ? "opacity-60" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <AttentionBadge level={change.importance} />
        <CategoryChip value={change.category} />
        <TypeChip value={change.type} />
        <ReviewStatusTag status={change.review_status} />
        <span className="ml-auto font-mono text-[10px] text-ink-faint">{change.id}</span>
      </div>

      <h3 className="mt-2 text-[13.5px] font-medium leading-snug">{change.summary}</h3>

      {pair ? (
        <p className="mt-1.5 font-mono text-[13px] font-semibold tabular-nums text-ink">{pair}</p>
      ) : null}

      {deltas.length > 0 ? (
        <p className="mt-0.5 text-[12px] text-ink-soft">{deltas.join(" · ")}</p>
      ) : null}

      <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
        <SidePanel
          side="A"
          citation={change.citation_a}
          text={change.text_a}
          ops={change.word_diff}
          section={change.section_a}
          onCitation={onCitation}
        />
        <SidePanel
          side="B"
          citation={change.citation_b}
          text={change.text_b}
          ops={change.word_diff}
          section={change.section_b}
          onCitation={onCitation}
        />
      </div>

      {change.notes.length > 0 ? (
        <ul className="mt-2.5 space-y-1">
          {change.notes.map((note) => (
            <li key={note} className="text-[11.5px] leading-snug text-ink-soft">
              {note}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-rule-soft pt-2.5">
        <ConfidenceTag
          label={change.confidence_label}
          score={change.confidence}
          signals={change.confidence_signals}
        />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          className="text-[11.5px] text-accent hover:underline"
          aria-expanded={expanded}
        >
          {expanded ? "Hide detail" : "Detail"}
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {REVIEW_ACTIONS.map((action) => {
            const active = change.review_status === action.status;
            return (
              <button
                key={action.status}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void act(action.status);
                }}
                disabled={saving !== null}
                className={`rounded border px-2 py-1 text-[11.5px] transition-colors disabled:opacity-50 ${
                  active
                    ? "border-ink bg-ink text-white"
                    : "border-rule text-ink-soft hover:border-ink-faint hover:text-ink"
                }`}
              >
                {saving === action.status ? "Saving…" : action.label}
              </button>
            );
          })}
        </div>
      </div>

      {error ? <p className="mt-1.5 text-[11.5px] text-remove">{error}</p> : null}

      {expanded ? (
        <div
          className="mt-3 space-y-3 border-t border-rule-soft pt-3"
          onClick={(e) => e.stopPropagation()}
        >
          <dl className="grid gap-x-6 gap-y-1.5 text-[12px] sm:grid-cols-2">
            <Detail label="Detected by">
              {change.detectors.map((d) => DETECTOR_LABEL[d] ?? d).join(", ")}
            </Detail>
            <Detail label="Confidence">
              {change.confidence_label} ({Math.round(change.confidence * 100)}%)
            </Detail>
            {change.direction ? (
              <Detail label="Direction">{change.direction.replace(/_/g, " ")}</Detail>
            ) : null}
            <Detail label="Review priority score">{change.importance_score}</Detail>
            {change.categories.length > 1 ? (
              <Detail label="All categories">{change.categories.join(", ")}</Detail>
            ) : null}
            {change.reviewed_by ? (
              <Detail label="Reviewed by">
                {change.reviewed_by} · {formatDateTime(change.reviewed_at)}
              </Detail>
            ) : null}
          </dl>

          {Object.keys(change.confidence_signals).length > 0 ? (
            <div>
              <div className="label-caps mb-1">Confidence signals</div>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink-soft">
                {Object.entries(change.confidence_signals).map(([key, value]) => (
                  <li key={key}>
                    {key} <span className="tabular-nums">{Math.round(value * 100)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {change.reviewer_notes.length > 0 ? (
            <div>
              <div className="label-caps mb-1">Reviewer notes</div>
              <ul className="space-y-1.5">
                {change.reviewer_notes.map((note, i) => (
                  <li key={i} className="rounded bg-canvas px-2 py-1.5 text-[12px]">
                    <div className="text-[10.5px] text-ink-faint">
                      {note.author ?? "Reviewer"} · {formatDateTime(note.created_at)}
                    </div>
                    {note.body}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <label className="block">
            <span className="label-caps mb-1 block">Add a note with your decision</span>
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              rows={2}
              placeholder="Confirmed with finance team. New price was agreed on 29 September."
              className="w-full resize-y rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent"
            />
          </label>
        </div>
      ) : null}
    </article>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="label-caps">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

function SidePanel({
  side,
  citation,
  text,
  ops,
  section,
  onCitation,
}: {
  side: Side;
  citation: Citation | null;
  text: string;
  ops: Change["word_diff"];
  section: string | null;
  onCitation: (side: Side, citation: Citation) => void;
}) {
  const hasContent = Boolean(citation || text);
  return (
    <div className="rounded border border-rule-soft bg-canvas p-2.5">
      <div className="label-caps mb-1">Version {side}</div>
      {citation ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCitation(side, citation);
          }}
          className="mb-1.5 block text-left text-[11.5px] text-accent hover:underline"
          title="Open this passage in the document pane"
        >
          {citationLabel(citation.section ?? section, citation.page)}
        </button>
      ) : (
        <div className="mb-1.5 text-[11.5px] text-ink-faint">No corresponding content</div>
      )}
      {hasContent ? (
        <p className="source-quote text-ink">
          {ops.length > 0 && text ? (
            <DiffText ops={ops} side={side === "A" ? "a" : "b"} />
          ) : (
            text || citation?.text
          )}
        </p>
      ) : (
        <p className="source-quote text-ink-faint">—</p>
      )}
    </div>
  );
}
