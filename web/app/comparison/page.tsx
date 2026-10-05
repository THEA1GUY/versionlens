"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { Change, ReviewStatus } from "@/lib/engine/changes";
import type { Citation, DocumentModel, Side } from "@/lib/engine/model";
import type { StoredComparison } from "@/lib/store/db";
import { loadPreferences } from "@/lib/store/settings";
import {
  applyReview,
  getComparison,
  getDocument,
  getOriginal,
  reviewChange,
} from "@/lib/workflow";
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
import { Disclaimer, EmptyState, LocalBadge, Spinner } from "@/components/ui";
import { ExportMenu } from "@/components/ExportMenu";

type Tab = "summary" | "changes" | "sections";

/**
 * The comparison id travels in the query string rather than the path. The app ships as
 * static files, and ids are created in the browser, so there is no route to pre-render.
 */
export default function ComparisonRoute() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[520px] px-4 py-20">
          <Spinner label="Loading comparison…" />
        </div>
      }
    >
      <ComparisonPage />
    </Suspense>
  );
}

function ComparisonPage() {
  const search = useSearchParams();
  const id = search.get("id") ?? "";

  const [comparison, setComparison] = useState<StoredComparison | null>(null);
  const [models, setModels] = useState<{ a: DocumentModel | null; b: DocumentModel | null }>({
    a: null,
    b: null,
  });
  const [originals, setOriginals] = useState<{ a: Blob | null; b: Blob | null }>({
    a: null,
    b: null,
  });
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [tab, setTab] = useState<Tab>("summary");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ a: Citation | null; b: Citation | null }>({
    a: null,
    b: null,
  });
  const [docsOpen, setDocsOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setError("No comparison was specified.");
      return;
    }
    let active = true;
    void (async () => {
      try {
        const [record, prefs] = await Promise.all([getComparison(id), loadPreferences()]);
        if (!active) return;
        if (!record) {
          setError("This comparison is not stored in this browser.");
          return;
        }
        setComparison(record);
        setFilters((f) => ({ ...f, includeMinor: prefs.showMinorByDefault }));

        const [docA, docB] = await Promise.all(
          record.documentIds.map((docId) => getDocument(docId)),
        );
        if (!active) return;
        setModels({ a: docA?.model ?? null, b: docB?.model ?? null });

        const [blobA, blobB] = await Promise.all(
          record.documentIds.map((docId) => getOriginal(docId)),
        );
        if (!active) return;
        setOriginals({ a: blobA ?? null, b: blobB ?? null });
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  const allChanges = useMemo(
    () => (comparison ? applyReview(comparison) : []),
    [comparison],
  );

  const facets = useMemo(() => {
    const category: Record<string, number> = {};
    const importance: Record<string, number> = {};
    const type: Record<string, number> = {};
    for (const c of allChanges) {
      for (const cat of c.categories) category[cat] = (category[cat] ?? 0) + 1;
      importance[c.importance] = (importance[c.importance] ?? 0) + 1;
      type[c.type] = (type[c.type] ?? 0) + 1;
    }
    return { category, importance, type };
  }, [allChanges]);

  const visible = useMemo(() => {
    const needle = filters.query.trim().toLowerCase();
    return allChanges.filter((c) => {
      if (!filters.includeMinor && c.importance === "LOW") return false;
      if (filters.importance.length > 0 && !filters.importance.includes(c.importance)) return false;
      if (filters.types.length > 0 && !filters.types.includes(c.type)) return false;
      if (
        filters.categories.length > 0 &&
        !c.categories.some((cat) => filters.categories.includes(cat))
      ) {
        return false;
      }
      if (needle) {
        const haystack = [
          c.summary, c.textA, c.textB, c.sectionA ?? "", c.sectionB ?? "",
          String(c.oldValue?.sourceText ?? ""), String(c.newValue?.sourceText ?? ""),
        ].join(" ").toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [allChanges, filters]);

  const selectChange = useCallback((change: Change) => {
    setSelectedId(change.id);
    setFocus({ a: change.citationA, b: change.citationB });
  }, []);

  const jumpToChange = useCallback(
    (changeId: string) => {
      setTab("changes");
      const target = allChanges.find((c) => c.id === changeId);
      if (!target) return;
      if (target.importance === "LOW" && !filters.includeMinor) {
        setFilters((f) => ({ ...f, includeMinor: true }));
      }
      selectChange(target);
      requestAnimationFrame(() => {
        document
          .getElementById(`change-${changeId}`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    },
    [allChanges, filters.includeMinor, selectChange],
  );

  async function review(change: Change, status: ReviewStatus, note?: string): Promise<void> {
    const updated = await reviewChange(id, change.id, status, note);
    if (updated) setComparison({ ...updated });
  }

  function onCitation(side: Side, citation: Citation): void {
    setDocsOpen(true);
    setFocus((prev) => ({ ...prev, [side === "A" ? "a" : "b"]: citation }));
  }

  if (error) {
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

  const result = comparison.result;
  if (!result || comparison.status === "FAILED") {
    return (
      <ProcessingView
        status={comparison.status}
        message={comparison.stageMessage}
        error={result?.error ?? comparison.stageMessage}
      />
    );
  }

  const summary = result.summary;
  const docA = result.documents.a;
  const docB = result.documents.b;

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
              {comparison.name}
            </h1>
            <p className="mt-0.5 text-[12px] text-ink-soft">
              <span className="font-medium">{docA.filename}</span>
              <span className="text-ink-faint"> versus </span>
              <span className="font-medium">{docB.filename}</span>
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-[19px] font-semibold leading-tight tabular-nums">
                {summary.totalChanges}
              </div>
              <div className="label-caps">detected changes</div>
            </div>
            <div className="hidden text-[11.5px] leading-snug text-ink-soft sm:block">
              <div>
                <span className="font-semibold text-remove">{summary.highAttention}</span> high
              </div>
              <div>
                <span className="font-semibold text-attention">{summary.mediumAttention}</span>{" "}
                medium
              </div>
              <div>
                <span className="font-semibold">{summary.lowAttention}</span> minor
              </div>
            </div>
            <ExportMenu
              comparison={comparison}
              changes={allChanges}
              includeMinor={filters.includeMinor}
            />
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
        <section
          className="flex min-h-0 w-full flex-col border-r border-rule bg-paper lg:w-[46%] xl:w-[42%]"
          aria-label="Detected changes"
        >
          <div className="flex items-center gap-1 border-b border-rule px-3 pt-2">
            {(
              [
                ["summary", "Summary"],
                ["changes", `Changes (${allChanges.length})`],
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
              resultCount={visible.length}
              totalCount={allChanges.length}
            />
          ) : null}

          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3">
            {tab === "summary" ? (
              <SummaryPanel comparison={comparison} result={result} onJump={jumpToChange} />
            ) : tab === "sections" ? (
              <SectionMapPanel rows={result.sectionMap} />
            ) : visible.length === 0 ? (
              <NoChanges
                identical={summary.identical}
                minorCount={summary.minorChanges}
                filtered={
                  filters.categories.length + filters.importance.length + filters.types.length > 0 ||
                  Boolean(filters.query)
                }
                onShowMinor={() => setFilters({ ...filters, includeMinor: true })}
                onClear={() => setFilters({ ...EMPTY_FILTERS, includeMinor: true })}
              />
            ) : (
              <div className="space-y-2.5">
                {visible.map((change) => (
                  <ChangeCard
                    key={change.id}
                    change={change}
                    selected={change.id === selectedId}
                    approximatePageA={docA.paginationApproximate}
                    approximatePageB={docB.paginationApproximate}
                    onSelect={() => selectChange(change)}
                    onReview={(status, note) => review(change, status, note)}
                    onCitation={onCitation}
                  />
                ))}
              </div>
            )}
          </div>

          <footer className="flex items-center gap-3 border-t border-rule px-3 py-2">
            <LocalBadge />
            <Disclaimer text={result.disclaimer} />
          </footer>
        </section>

        {docsOpen ? (
          <section className="hidden min-h-0 flex-1 lg:flex" aria-label="Original documents">
            <div className="min-w-0 flex-1 border-r border-rule bg-paper">
              <DocumentPane
                side="A"
                model={models.a}
                original={originals.a}
                citation={focus.a}
                highlightQuery={filters.query}
              />
            </div>
            <div className="min-w-0 flex-1 bg-paper">
              <DocumentPane
                side="B"
                model={models.b}
                original={originals.b}
                citation={focus.b}
                highlightQuery={filters.query}
              />
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function NoChanges({
  identical,
  minorCount,
  filtered,
  onShowMinor,
  onClear,
}: {
  identical: boolean;
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
  return (
    <EmptyState
      title="No material changes detected"
      body={
        minorCount > 0
          ? `We found ${minorCount} minor formatting or wording difference${minorCount === 1 ? "" : "s"}.`
          : "Nothing in Version B differs materially from Version A."
      }
      action={
        <button
          type="button"
          onClick={onShowMinor}
          className="mt-2 rounded border border-rule px-3 py-1.5 text-[12.5px] hover:bg-canvas"
        >
          {minorCount > 0 ? "Review minor changes" : "Show minor changes"}
        </button>
      }
    />
  );
}
