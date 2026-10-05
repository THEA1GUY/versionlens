import type { ReactNode } from "react";
import type { DiffOp, Importance, ReviewStatus } from "@/lib/types";
import { IMPORTANCE_LABEL, REVIEW_LABEL, TYPE_LABEL, TYPE_MARK, categoryLabel } from "@/lib/format";

/** Attention level. Carries a word, not just a colour. */
export function AttentionBadge({ level }: { level: Importance }) {
  const tone =
    level === "HIGH"
      ? "border-remove/30 bg-remove-soft text-remove"
      : level === "MEDIUM"
        ? "border-attention/30 bg-attention-soft text-attention"
        : "border-rule bg-canvas text-ink-faint";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-[2px] text-[10.5px] font-semibold uppercase tracking-[0.06em] ${tone}`}
    >
      {level === "HIGH" ? "▲" : level === "MEDIUM" ? "●" : "○"}
      {IMPORTANCE_LABEL[level]}
    </span>
  );
}

export function CategoryChip({ value }: { value: string }) {
  return (
    <span className="rounded border border-rule bg-canvas px-1.5 py-[2px] text-[10.5px] font-medium uppercase tracking-[0.05em] text-ink-soft">
      {categoryLabel(value)}
    </span>
  );
}

export function TypeChip({ value }: { value: string }) {
  const tone =
    value === "ADDED" || value === "SECTION_ADDED"
      ? "border-add/30 bg-add-soft text-add"
      : value === "REMOVED" || value === "SECTION_REMOVED"
        ? "border-remove/30 bg-remove-soft text-remove"
        : value === "MEANING_CHANGED"
          ? "border-attention/40 bg-attention-soft text-attention"
          : "border-rule bg-canvas text-ink-soft";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-[2px] text-[10.5px] font-medium uppercase tracking-[0.05em] ${tone}`}
    >
      <span aria-hidden="true" className="font-mono">
        {TYPE_MARK[value] ?? "±"}
      </span>
      {TYPE_LABEL[value] ?? value}
    </span>
  );
}

export function ConfidenceTag({
  label,
  score,
  signals,
}: {
  label: string;
  score: number;
  signals?: Record<string, number>;
}) {
  const detail = signals
    ? Object.entries(signals)
        .map(([key, value]) => `${key} ${(value * 100).toFixed(0)}%`)
        .join(", ")
    : undefined;
  return (
    <span
      className="text-[11.5px] text-ink-faint"
      title={detail ? `${(score * 100).toFixed(0)}% — ${detail}` : `${(score * 100).toFixed(0)}%`}
    >
      {label}
    </span>
  );
}

export function ReviewStatusTag({ status }: { status: ReviewStatus }) {
  if (status === "unreviewed") return null;
  const tone =
    status === "confirmed"
      ? "border-add/30 bg-add-soft text-add"
      : status === "false_alert"
        ? "border-rule bg-canvas text-ink-faint line-through"
        : "border-attention/30 bg-attention-soft text-attention";
  return (
    <span className={`rounded border px-1.5 py-[2px] text-[10.5px] font-medium ${tone}`}>
      {REVIEW_LABEL[status]}
    </span>
  );
}

/**
 * Word-level diff. Only the changed tokens are marked, so "the service fee is $20,000"
 * shows a highlight on the amount rather than the whole sentence (PRD §14).
 */
export function DiffText({ ops, side }: { ops: DiffOp[]; side: "a" | "b" }) {
  if (!ops.length) return null;
  return (
    <span>
      {ops.map((op, index) => {
        const text = side === "a" ? op.a : op.b;
        if (!text) return null;
        if (op.op === "equal") return <span key={index}>{text}</span>;
        const isRemoval = side === "a";
        if (op.op === "insert" && side === "a") return null;
        if (op.op === "delete" && side === "b") return null;
        return (
          <mark
            key={index}
            className={
              isRemoval
                ? "bg-remove-soft text-remove decoration-remove/40 [text-decoration-line:line-through]"
                : "bg-add-soft text-add"
            }
          >
            {text}
          </mark>
        );
      })}
    </span>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-start gap-2 p-8">
      <h2 className="serif-title text-[17px] font-semibold">{title}</h2>
      <p className="max-w-prose text-[13px] text-ink-soft">{body}</p>
      {action}
    </div>
  );
}

export function Disclaimer({ text }: { text: string }) {
  return (
    <p className="text-[11.5px] leading-relaxed text-ink-faint">
      <span className="font-semibold">Disclaimer.</span> {text}
    </p>
  );
}

export function WarningNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2 rounded-md border border-attention/30 bg-attention-soft px-3 py-2 text-[12.5px] text-attention">
      <span aria-hidden="true" className="font-semibold">
        !
      </span>
      <div>{children}</div>
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-[13px] text-ink-faint" role="status">
      <svg width="14" height="14" viewBox="0 0 14 14" className="animate-spin" aria-hidden="true">
        <circle cx="7" cy="7" r="5.5" fill="none" stroke="#e4e5e9" strokeWidth="2" />
        <path d="M7 1.5a5.5 5.5 0 0 1 5.5 5.5" fill="none" stroke="#1a4fd6" strokeWidth="2" />
      </svg>
      {label}
    </div>
  );
}

export function ProgressBar({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-rule-soft"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label="Review progress"
      >
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular-nums text-[11.5px] text-ink-faint">{pct}%</span>
    </div>
  );
}
