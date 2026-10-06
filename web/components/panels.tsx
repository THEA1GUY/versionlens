"use client";

import type { Category, Importance } from "@/lib/engine/changes";
import { CATEGORY_LABEL, TYPE_LABEL } from "@/lib/engine/changes";
import type { ComparisonResult, SectionMapRow, Stage } from "@/lib/engine/compare";
import type { StoredComparison } from "@/lib/store/db";
import { formatDateTime } from "@/lib/format";
import { reviewProgress } from "@/lib/workflow";
import { ProgressBar, WarningNote } from "./ui";

/** Business-level changes first, before any text difference. */
export function SummaryPanel({
  comparison,
  result,
  onJump,
}: {
  comparison: StoredComparison;
  result: ComparisonResult;
  onJump: (changeId: string) => void;
}) {
  const s = result.summary;
  const progress = reviewProgress(comparison);
  const maxCategory = Math.max(1, ...Object.values(s.byCategory));

  return (
    <div className="space-y-5">
      <section>
        <p className="text-[14px] leading-relaxed">{s.headline}</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="High attention" value={s.highAttention} tone="high" />
          <Stat label="Medium attention" value={s.mediumAttention} tone="medium" />
          <Stat label="Minor" value={s.lowAttention} tone="low" />
          <Stat label="Total" value={s.totalChanges} tone="low" />
        </div>
      </section>

      {result.warnings.length > 0 ? (
        <section className="space-y-2">
          {result.warnings.map((warning) => (
            <WarningNote key={warning}>{warning}</WarningNote>
          ))}
        </section>
      ) : null}

      {s.keyChanges.length > 0 ? (
        <section>
          <h3 className="label-caps mb-2">Key changes</h3>
          <ol className="space-y-1.5">
            {s.keyChanges.map((item) => (
              <li key={item.changeId}>
                <button
                  type="button"
                  onClick={() => onJump(item.changeId)}
                  className="group w-full rounded border border-rule bg-paper px-3 py-2 text-left transition-colors hover:border-accent hover:bg-accent-soft"
                >
                  <span className="label-caps">
                    <span aria-hidden="true" className="mr-1.5 font-mono text-remove">
                      ▲
                    </span>
                    {CATEGORY_LABEL[item.category]}
                  </span>
                  <span className="mt-0.5 block text-[13px] leading-snug group-hover:text-accent">
                    {item.summary}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {Object.keys(s.byCategory).length > 0 ? (
        <section>
          <h3 className="label-caps mb-2">Changes by category</h3>
          <ul className="space-y-1">
            {Object.entries(s.byCategory)
              .sort((a, b) => b[1] - a[1])
              .map(([key, count]) => (
                <li key={key} className="flex items-baseline gap-2 text-[12.5px]">
                  <span className="w-[130px] shrink-0 text-ink-soft">
                    {CATEGORY_LABEL[key as Category] ?? key}
                  </span>
                  <span className="font-medium tabular-nums">{count}</span>
                  <span
                    className="h-1 rounded-full bg-rule"
                    style={{ width: `${Math.max(4, (count / maxCategory) * 120)}px` }}
                    aria-hidden="true"
                  />
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      {progress.total > 0 ? (
        <section>
          <h3 className="label-caps mb-2">Review progress</h3>
          <div className="mb-2 text-[12.5px] text-ink-soft">
            {progress.reviewed} / {progress.total} reviewed
          </div>
          <ProgressBar value={progress.reviewed} total={progress.total} />
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-[12.5px]">
            <Row label="Confirmed" value={progress.confirmed} />
            <Row label="False alerts" value={progress.falseAlerts} />
            <Row label="Needs discussion" value={progress.needsDiscussion} />
            <Row label="Unreviewed" value={progress.unreviewed} />
          </dl>
        </section>
      ) : null}

      <section>
        <h3 className="label-caps mb-2">Provenance</h3>
        <dl className="grid gap-x-6 gap-y-1 text-[12px]">
          {(["a", "b"] as const).map((side) => {
            const doc = result.documents[side];
            return (
              <div key={side}>
                <dt className="label-caps">Version {side.toUpperCase()}</dt>
                <dd className="text-ink">
                  {doc.filename} · {doc.pageCount} pages · {doc.sectionCount} sections
                  {doc.paginationApproximate ? " · pages estimated" : ""}
                  <span className="mt-0.5 block break-all font-mono text-[10.5px] text-ink-faint">
                    sha256 {doc.sha256}
                  </span>
                </dd>
              </div>
            );
          })}
          <Row label="Engine" value={result.audit.engineVersion} />
          <Row label="Extraction" value={result.audit.extractionVersion} />
          <Row label="Analysis model" value={result.audit.analysisModelVersion} />
          {result.audit.alignmentsArbitrated > 0 ? (
            <Row label="Pairings arbitrated" value={result.audit.alignmentsArbitrated} />
          ) : null}
          <Row label="Completed" value={formatDateTime(result.audit.completedAt)} />
        </dl>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "high" | "medium" | "low";
}) {
  const accent =
    tone === "high" ? "text-remove" : tone === "medium" ? "text-attention" : "text-ink";
  return (
    <div className="rounded border border-rule bg-paper px-3 py-2">
      <div className={`text-[20px] font-semibold leading-tight tabular-nums ${accent}`}>
        {value}
      </div>
      <div className="label-caps mt-0.5">{label}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-rule-soft pb-0.5">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="tabular-nums text-ink">{value}</dd>
    </div>
  );
}

/** Where the changes are concentrated. */
export function SectionMapPanel({ rows }: { rows: SectionMapRow[] }) {
  if (rows.length === 0) {
    return <p className="text-[13px] text-ink-faint">No section structure was detected.</p>;
  }
  return (
    <ul className="divide-y divide-rule-soft">
      {rows.map((row, index) => {
        const label = row.sectionB ?? row.sectionA ?? "(untitled)";
        return (
          <li key={index} className="flex items-start gap-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium" title={label}>
                {label}
              </div>
              <div className="text-[11px] text-ink-faint">
                {row.status === "ADDED" ? (
                  <span className="text-add">New section · page {row.pageB}</span>
                ) : row.status === "REMOVED" ? (
                  <span className="text-remove">Removed · was page {row.pageA}</span>
                ) : (
                  <>
                    {row.sectionA && row.sectionA !== row.sectionB ? (
                      <span>was &ldquo;{row.sectionA}&rdquo; · </span>
                    ) : null}
                    page {row.pageB ?? row.pageA} · matched{" "}
                    {Math.round(row.alignmentConfidence * 100)}%
                    {row.arbitratedByModel ? " · resolved by model" : ""}
                  </>
                )}
              </div>
            </div>
            <div className="shrink-0 pt-0.5 text-right">
              {row.changeCount > 0 ? (
                <span className="text-[12px] font-medium tabular-nums">
                  {row.changeCount} change{row.changeCount === 1 ? "" : "s"}
                </span>
              ) : row.status === "MATCHED" ? (
                <span className="text-[11.5px] text-ink-faint">unchanged</span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export interface FilterState {
  categories: string[];
  importance: Importance[];
  types: string[];
  includeMinor: boolean;
  query: string;
}

export const EMPTY_FILTERS: FilterState = {
  categories: [],
  importance: [],
  types: [],
  includeMinor: false,
  query: "",
};

export function FilterBar({
  facets,
  filters,
  onChange,
  resultCount,
  totalCount,
}: {
  facets: { category: Record<string, number>; importance: Record<string, number>; type: Record<string, number> };
  filters: FilterState;
  onChange: (next: FilterState) => void;
  resultCount: number;
  totalCount: number;
}) {
  const categories = Object.entries(facets.category).sort((a, b) => b[1] - a[1]);
  const types = Object.entries(facets.type).sort((a, b) => b[1] - a[1]);
  const active =
    filters.categories.length +
    filters.importance.length +
    filters.types.length +
    (filters.query ? 1 : 0);

  function toggle<T extends string>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  return (
    <div className="space-y-2.5 border-b border-rule bg-canvas px-3 py-2.5">
      <div className="flex items-center gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Search changes</span>
          <input
            value={filters.query}
            onChange={(e) => onChange({ ...filters, query: e.target.value })}
            placeholder="Search changes, amounts, sections…"
            className="w-full rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent"
          />
        </label>
        {active > 0 ? (
          <button
            type="button"
            onClick={() => onChange({ ...EMPTY_FILTERS, includeMinor: filters.includeMinor })}
            className="shrink-0 text-[11.5px] text-accent hover:underline"
          >
            Clear ({active})
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1">
        <Pill
          label={`All ${totalCount}`}
          active={active === 0}
          onClick={() => onChange({ ...EMPTY_FILTERS, includeMinor: filters.includeMinor })}
        />
        {(["HIGH", "MEDIUM"] as const).map((level) =>
          facets.importance[level] ? (
            <Pill
              key={level}
              label={`${level === "HIGH" ? "Important" : "Medium"} ${facets.importance[level]}`}
              active={filters.importance.includes(level)}
              onClick={() => onChange({ ...filters, importance: toggle(filters.importance, level) })}
            />
          ) : null,
        )}
        {categories.map(([key, count]) => (
          <Pill
            key={key}
            label={`${CATEGORY_LABEL[key as Category] ?? key} ${count}`}
            active={filters.categories.includes(key)}
            onClick={() => onChange({ ...filters, categories: toggle(filters.categories, key) })}
          />
        ))}
        {types
          .filter(([key]) => ["ADDED", "REMOVED", "MODIFIED", "MEANING_CHANGED"].includes(key))
          .map(([key, count]) => (
            <Pill
              key={key}
              label={`${TYPE_LABEL[key as keyof typeof TYPE_LABEL] ?? key} ${count}`}
              active={filters.types.includes(key)}
              onClick={() => onChange({ ...filters, types: toggle(filters.types, key) })}
            />
          ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-[11.5px] text-ink-soft">
          <input
            type="checkbox"
            checked={filters.includeMinor}
            onChange={(e) => onChange({ ...filters, includeMinor: e.target.checked })}
            className="h-3 w-3 accent-[#1a4fd6]"
          />
          Show minor changes
        </label>
        <span className="text-[11.5px] text-ink-faint">{resultCount} shown</span>
      </div>
    </div>
  );
}

function Pill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-2.5 py-[3px] text-[11.5px] transition-colors ${
        active
          ? "border-action bg-action text-on-action"
          : "border-rule bg-paper text-ink-soft hover:border-ink-faint hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

/** Real pipeline stages rather than "AI is thinking…". */
const STAGES: Array<{ key: Stage; label: string }> = [
  { key: "EXTRACTING", label: "Reading both versions" },
  { key: "SEGMENTING", label: "Identifying sections" },
  { key: "ALIGNING", label: "Aligning corresponding sections" },
  { key: "DIFFING", label: "Comparing terms and values" },
  { key: "ANALYZING", label: "Reviewing meaning changes" },
  { key: "GENERATING_RESULTS", label: "Building report" },
];

export function ProcessingView({
  status,
  message,
  error,
}: {
  status: Stage;
  message: string | null;
  error: string | null;
}) {
  const currentIndex = STAGES.findIndex((s) => s.key === status);
  const failed = status === "FAILED";

  return (
    <div className="mx-auto max-w-[520px] px-4 py-16">
      <h1 className="serif-title text-[20px] font-semibold">
        {failed ? "Comparison failed" : "Preparing comparison"}
      </h1>
      {failed ? (
        <p className="mt-2 text-[13px] text-remove">{error ?? message ?? "Unknown error."}</p>
      ) : (
        <>
          <p className="mt-1.5 text-[12.5px] text-ink-faint">
            {message ?? "Working…"} — this runs in your browser, so longer documents take
            longer to align.
          </p>
          <ol className="mt-5 space-y-2">
            {STAGES.map((stage, index) => {
              const done =
                currentIndex > index || status === "COMPLETED" || status === "PARTIAL";
              const active = currentIndex === index;
              return (
                <li key={stage.key} className="flex items-center gap-2.5 text-[13px]">
                  <span
                    aria-hidden="true"
                    className={`w-4 text-center ${
                      done ? "text-add" : active ? "text-accent" : "text-ink-faint"
                    }`}
                  >
                    {done ? "✓" : active ? "●" : "○"}
                  </span>
                  <span className={done || active ? "text-ink" : "text-ink-faint"}>
                    {stage.label}
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}
