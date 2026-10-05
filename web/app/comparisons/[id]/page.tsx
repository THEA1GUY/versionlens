"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import type {
  Change,
  Citation,
  Comparison,
  DocumentContent,
  Facets,
  ReviewStatus,
  Side,
} from "@/lib/types";
import { ChangeCard } from "@/components/ChangeCard";
import { DocumentPane } from "@/components/DocumentPane";
import {
  EMPTY_FILTERS,
  FilterBar,
  type FilterState,
  ProcessingView,
  SectionMapPanel,
  SummaryPanel,
} from "@/components/panels";
import { Disclaimer, EmptyState, Spinner } from "@/components/ui";

type Tab = "summary" | "changes" | "sections";

const TERMINAL = new Set(["COMPLETED", "PARTIAL", "FAILED"]);

export default function ComparisonPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [contentA, setContentA] = useState<DocumentContent | null>(null);
  const [contentB, setContentB] = useState<DocumentContent | null>(null);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [tab, setTab] = useState<Tab>("summary");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ a: Citation | null; b: Citation | null }>({
    a: null,
    b: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [docsOpen, setDocsOpen] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  // Poll while the comparison is still running, then stop.
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const next = await api.getComparison(id);
        if (!active) return;
        setComparison(next);
        if (!TERMINAL.has(next.status)) {
          timer = setTimeout(poll, 900);
        }
      } catch (err) {
        if (active) setError((err as Error).message);
      }
    }
    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  const ready = comparison && (comparison.status === "COMPLETED" || comparison.status === "PARTIAL");

  // Document text powers the side-by-side panes and citation jumps.
  useEffect(() => {
    if (!ready || !comparison) return;
    let active = true;
    void api
      .getDocumentContent(comparison.version_a_document_id)
      .then((c) => active && setContentA(c))
      .catch(() => {});
    void api
      .getDocumentContent(comparison.version_b_document_id)
      .then((c) => active && setContentB(c))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [ready, comparison]);

  const loadChanges = useCallback(
    async (state: FilterState) => {
      const response = await api.getChanges(id, {
        category: state.categories,
        importance: state.importance,
        change_type: state.types,
        review_status: state.reviewStatuses,
        include_minor: state.includeMinor,
        q: state.query || undefined,
      });
      setChanges(response.changes);
      setFacets(response.facets);
    },
    [id],
  );

  useEffect(() => {
    if (!ready) return;
    const handle = setTimeout(() => {
      void loadChanges(filters).catch((err: Error) => setError(err.message));
    }, filters.query ? 220 : 0);
    return () => clearTimeout(handle);
  }, [ready, filters, loadChanges]);

  const selected = useMemo(
    () => changes?.find((c) => c.record_id === selectedId) ?? null,
    [changes, selectedId],
  );

  const selectChange = useCallback((change: Change) => {
    setSelectedId(change.record_id);
    setFocus({ a: change.citation_a, b: change.citation_b });
  }, []);

  const jumpToChange = useCallback(
    async (changeKey: string) => {
      setTab("changes");
      // The key change may be filtered out of the current view; widen first.
      let list = changes;
      if (!list?.some((c) => c.id === changeKey)) {
        setFilters(EMPTY_FILTERS);
        const response = await api.getChanges(id, { include_minor: true });
        setChanges(response.changes);
        setFacets(response.facets);
        list = response.changes;
      }
      const target = list?.find((c) => c.id === changeKey);
      if (!target) return;
      selectChange(target);
      requestAnimationFrame(() => {
        document
          .getElementById(`change-${target.record_id}`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    },
    [changes, id, selectChange],
  );

  async function review(change: Change, status: ReviewStatus, comment?: string) {
    const updated = await api.reviewChange(change.record_id, status, comment);
    setChanges((prev) =>
      prev ? prev.map((c) => (c.record_id === updated.record_id ? updated : c)) : prev,
    );
    // Review counts live on the comparison summary.
    void api.getComparison(id).then(setComparison).catch(() => {});
  }

  function onCitation(side: Side, citation: Citation) {
    setDocsOpen(true);
    setFocus((prev) => ({ ...prev, [side === "A" ? "a" : "b"]: citation }));
  }

  if (error && !comparison) {
    return (
      <div className="mx-auto max-w-[620px] px-4 py-16">
        <EmptyState
          title="Comparison unavailable"
          body={error}
          action={
            <Link href="/" className="mt-2 text-[13px] text-accent hover:underline">
              Back to dashboard
            </Link>
          }
        />
      </div>
    );
  }

  if (!comparison) {
    return (
      <div className="mx-auto max-w-[520px] px-4 py-20">
        <Spinner label="Loading comparison…" />
      </div>
    );
  }

  if (!ready) {
    return (
      <ProcessingView
        status={comparison.status}
        message={comparison.stage_message}
        error={comparison.error}
      />
    );
  }

  const docA = comparison.documents.a;
  const docB = comparison.documents.b;
  const summary = comparison.summary;
  const noMaterialChanges = summary.total_changes > 0 && summary.material_changes === 0;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <header className="border-b border-rule bg-paper px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
          <div className="min-w-0 flex-1">
            <nav className="text-[11.5px] text-ink-faint">
              <Link href="/" className="hover:text-ink hover:underline">
                Dashboard
              </Link>
              <span aria-hidden="true"> / </span>
              <span>Comparison</span>
            </nav>
            <h1 className="serif-title mt-0.5 truncate text-[19px] font-semibold">
              {comparison.name || "Untitled comparison"}
            </h1>
            <p className="mt-0.5 text-[12px] text-ink-soft">
              <span className="font-medium">{docA?.filename}</span>
              <span className="text-ink-faint"> versus </span>
              <span className="font-medium">{docB?.filename}</span>
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-[19px] font-semibold leading-tight tabular-nums">
                {summary.total_changes}
              </div>
              <div className="label-caps">detected changes</div>
            </div>
            <div className="hidden text-[11.5px] leading-snug text-ink-soft sm:block">
              <div>
                <span className="font-semibold text-remove">{summary.high_attention}</span> high
              </div>
              <div>
                <span className="font-semibold text-attention">{summary.medium_attention}</span>{" "}
                medium
              </div>
              <div>
                <span className="font-semibold">{summary.low_attention}</span> minor
              </div>
            </div>
            <ExportMenu id={comparison.id} includeMinor={filters.includeMinor} />
          </div>
        </div>
      </header>

      {comparison.status === "PARTIAL" ? (
        <div className="border-b border-attention/30 bg-attention-soft px-4 py-2 text-[12px] text-attention sm:px-5">
          Some pages could not be read reliably. Changes involving those pages may be
          incomplete — see the summary tab.
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {/* Changes panel */}
        <section
          className="flex min-h-0 w-full flex-col border-r border-rule bg-paper lg:w-[46%] xl:w-[42%]"
          aria-label="Detected changes"
        >
          <div className="flex items-center gap-1 border-b border-rule px-3 pt-2">
            {(
              [
                ["summary", "Summary"],
                ["changes", `Changes${facets ? ` (${facets.total})` : ""}`],
                ["sections", "Section map"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                aria-current={tab === key}
                className={`-mb-px border-b-2 px-2.5 py-1.5 text-[12.5px] transition-colors ${
                  tab === key
                    ? "border-ink font-medium text-ink"
                    : "border-transparent text-ink-soft hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setDocsOpen((v) => !v)}
              className="ml-auto mb-1 hidden text-[11.5px] text-accent hover:underline lg:block"
            >
              {docsOpen ? "Hide documents" : "Show documents"}
            </button>
          </div>

          {tab === "changes" ? (
            <FilterBar
              facets={facets}
              filters={filters}
              onChange={setFilters}
              resultCount={changes?.length ?? 0}
            />
          ) : null}

          <div ref={listRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3">
            {tab === "summary" ? (
              <SummaryPanel comparison={comparison} onJump={jumpToChange} />
            ) : tab === "sections" ? (
              <SectionMapPanel rows={comparison.section_map} />
            ) : !changes ? (
              <Spinner label="Loading changes…" />
            ) : changes.length === 0 ? (
              <NoChanges
                identical={summary.identical}
                noMaterial={noMaterialChanges}
                minorCount={summary.minor_changes}
                filtered={
                  filters.categories.length + filters.importance.length + filters.types.length > 0 ||
                  Boolean(filters.query)
                }
                onShowMinor={() => setFilters({ ...filters, includeMinor: true })}
                onClear={() => setFilters(EMPTY_FILTERS)}
              />
            ) : (
              <div className="space-y-2.5">
                {changes.map((change) => (
                  <ChangeCard
                    key={change.record_id}
                    change={change}
                    selected={change.record_id === selectedId}
                    onSelect={() => selectChange(change)}
                    onReview={(status, comment) => review(change, status, comment)}
                    onCitation={onCitation}
                  />
                ))}
              </div>
            )}
          </div>

          <footer className="border-t border-rule px-3 py-2">
            <Disclaimer text={comparison.disclaimer} />
          </footer>
        </section>

        {/* Side-by-side documents */}
        {docsOpen ? (
          <section
            className="hidden min-h-0 flex-1 lg:flex"
            aria-label="Original documents"
          >
            <div className="min-w-0 flex-1 border-r border-rule bg-paper">
              <DocumentPane
                side="A"
                meta={docA}
                content={contentA}
                citation={focus.a}
                documentId={comparison.version_a_document_id}
                highlightQuery={filters.query}
              />
            </div>
            <div className="min-w-0 flex-1 bg-paper">
              <DocumentPane
                side="B"
                meta={docB}
                content={contentB}
                citation={focus.b}
                documentId={comparison.version_b_document_id}
                highlightQuery={filters.query}
              />
            </div>
          </section>
        ) : null}
      </div>

      {/* Mobile: the documents live behind the selected change (PDD §29). */}
      {selected ? (
        <div className="border-t border-rule bg-paper p-3 lg:hidden">
          <div className="label-caps mb-1">Selected change — source passages</div>
          <div className="grid gap-2">
            {(["A", "B"] as const).map((side) => {
              const citation = side === "A" ? selected.citation_a : selected.citation_b;
              return (
                <div key={side} className="rounded border border-rule-soft bg-canvas p-2">
                  <div className="label-caps">Version {side}</div>
                  {citation ? (
                    <>
                      <div className="text-[11px] text-accent">
                        {citation.section} · page {citation.page}
                      </div>
                      <p className="source-quote mt-1">{citation.text}</p>
                    </>
                  ) : (
                    <p className="text-[12px] text-ink-faint">No corresponding content</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NoChanges({
  identical,
  noMaterial,
  minorCount,
  filtered,
  onShowMinor,
  onClear,
}: {
  identical: boolean;
  noMaterial: boolean;
  minorCount: number;
  filtered: boolean;
  onShowMinor: () => void;
  onClear: () => void;
}) {
  if (filtered) {
    return (
      <EmptyState
        title="No changes match these filters"
        body="Widen the filters to see the rest of the detected changes."
        action={
          <button
            type="button"
            onClick={onClear}
            className="mt-2 rounded border border-rule px-3 py-1.5 text-[12.5px] hover:bg-canvas"
          >
            Clear filters
          </button>
        }
      />
    );
  }
  if (identical) {
    return (
      <EmptyState
        title="The documents are identical"
        body="Both versions produced the same extracted text, so there is nothing to compare."
      />
    );
  }
  if (noMaterial || minorCount > 0) {
    return (
      <EmptyState
        title="No material changes detected"
        body={`We found ${minorCount} minor formatting or wording difference${
          minorCount === 1 ? "" : "s"
        }.`}
        action={
          <button
            type="button"
            onClick={onShowMinor}
            className="mt-2 rounded border border-rule px-3 py-1.5 text-[12.5px] hover:bg-canvas"
          >
            Review minor changes
          </button>
        }
      />
    );
  }
  return (
    <EmptyState
      title="No material changes detected"
      body="Nothing in Version B differs materially from Version A. Enable minor changes to see formatting-level differences."
      action={
        <button
          type="button"
          onClick={onShowMinor}
          className="mt-2 rounded border border-rule px-3 py-1.5 text-[12.5px] hover:bg-canvas"
        >
          Show minor changes
        </button>
      }
    />
  );
}

function ExportMenu({ id, includeMinor }: { id: string; includeMinor: boolean }) {
  const [open, setOpen] = useState(false);
  const formats: { key: "pdf" | "docx" | "csv" | "xlsx"; label: string }[] = [
    { key: "pdf", label: "Comparison report (PDF)" },
    { key: "docx", label: "Comparison report (DOCX)" },
    { key: "xlsx", label: "Change table (XLSX)" },
    { key: "csv", label: "Change table (CSV)" },
  ];
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="rounded-md border border-rule px-3 py-1.5 text-[12.5px] font-medium transition-colors hover:bg-canvas"
      >
        Export
      </button>
      {open ? (
        <>
          <button
            type="button"
            aria-label="Close export menu"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-20 mt-1 w-[232px] overflow-hidden rounded-md border border-rule bg-paper shadow-lg">
            {formats.map((format) => (
              <a
                key={format.key}
                href={api.exportUrl(id, format.key, includeMinor)}
                onClick={() => setOpen(false)}
                className="block border-b border-rule-soft px-3 py-2 text-[12.5px] last:border-0 hover:bg-canvas"
              >
                {format.label}
              </a>
            ))}
            <p className="border-t border-rule bg-canvas px-3 py-1.5 text-[10.5px] text-ink-faint">
              {includeMinor ? "Includes minor changes" : "Material changes only"}
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}
