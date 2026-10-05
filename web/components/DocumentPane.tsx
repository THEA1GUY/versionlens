"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Citation, DocumentContent, DocumentMeta, Side } from "@/lib/types";

/**
 * One version rendered block by block, each block keyed by the same id the engine cites.
 * Selecting a change scrolls this pane to the cited block and highlights the exact
 * character span (PDD §13-14), so the reviewer verifies against the source rather than
 * trusting the summary.
 */
export function DocumentPane({
  side,
  meta,
  content,
  citation,
  documentId,
  highlightQuery,
}: {
  side: Side;
  meta: DocumentMeta | undefined;
  content: DocumentContent | null;
  citation: Citation | null;
  documentId: string;
  highlightQuery: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const targetId = citation?.block_id ?? null;

  const sections = useMemo(() => {
    const map = new Map<string, string>();
    for (const section of content?.sections ?? []) map.set(section.id, section.label);
    return map;
  }, [content]);

  const problemPages = useMemo(
    () => new Set((content?.pages ?? []).filter((p) => p.status !== "extraction_successful").map((p) => p.page_number)),
    [content],
  );

  useEffect(() => {
    if (!targetId || !scrollRef.current) return;
    const node = scrollRef.current.querySelector<HTMLElement>(`[data-block="${targetId}"]`);
    if (!node) return;
    node.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [targetId]);

  if (!content) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-[12.5px] text-ink-faint">
        Loading {side === "A" ? "Version A" : "Version B"}…
      </div>
    );
  }

  let lastPage = 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-baseline justify-between gap-2 border-b border-rule bg-canvas px-3 py-2">
        <div className="min-w-0">
          <div className="label-caps">Version {side}</div>
          <div className="truncate text-[12.5px] font-medium" title={meta?.filename}>
            {meta?.filename ?? "—"}
          </div>
        </div>
        <a
          href={`/api/documents/${documentId}/file`}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-[11.5px] text-accent hover:underline"
        >
          Open original
        </a>
      </header>

      <div ref={scrollRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {content.blocks.map((block) => {
          const isNewPage = block.page !== lastPage;
          lastPage = block.page;
          const isTarget = block.id === targetId;
          const sectionLabel = block.section_id ? sections.get(block.section_id) : undefined;

          return (
            <div key={block.id}>
              {isNewPage ? (
                <div className="mb-2 mt-4 flex items-center gap-2 first:mt-0">
                  <span className="label-caps shrink-0">Page {block.page}</span>
                  <span className="h-px flex-1 bg-rule-soft" />
                  {problemPages.has(block.page) ? (
                    <span className="shrink-0 text-[10.5px] font-semibold text-attention">
                      low confidence
                    </span>
                  ) : null}
                </div>
              ) : null}

              <div
                data-block={block.id}
                className={`scroll-mt-16 rounded px-2 py-1 ${isTarget ? "block-focus" : ""}`}
              >
                {block.block_type === "heading" ? (
                  <h3 className="serif-title mt-1 text-[14px] font-semibold">{block.text}</h3>
                ) : block.block_type === "table_row" && block.cells ? (
                  <div className="flex flex-wrap gap-x-3 font-mono text-[11.5px] text-ink-soft">
                    {block.cells.map((cell, i) => (
                      <span key={i} className={i === 0 ? "font-medium text-ink" : ""}>
                        {cell}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="source-quote text-ink">
                    <Marked
                      text={block.text}
                      span={isTarget && citation ? [citation.char_start, citation.char_end] : null}
                      query={highlightQuery}
                    />
                  </p>
                )}
                {isTarget && sectionLabel ? (
                  <div className="mt-0.5 text-[10.5px] text-accent">{sectionLabel}</div>
                ) : null}
              </div>
            </div>
          );
        })}
        <div className="h-32" aria-hidden="true" />
      </div>
    </div>
  );
}

/** Marks the cited character span, or every occurrence of the search term. */
function Marked({
  text,
  span,
  query,
}: {
  text: string;
  span: [number, number] | null;
  query: string;
}) {
  if (span && span[1] > span[0] && span[1] <= text.length && span[1] - span[0] < text.length) {
    return (
      <>
        {text.slice(0, span[0])}
        <mark className="rounded-sm bg-accent-soft px-0.5 font-semibold text-accent">
          {text.slice(span[0], span[1])}
        </mark>
        {text.slice(span[1])}
      </>
    );
  }
  if (query.length >= 2) {
    const lower = text.toLowerCase();
    const needle = query.toLowerCase();
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    let found = lower.indexOf(needle, cursor);
    while (found !== -1) {
      parts.push(text.slice(cursor, found));
      parts.push(
        <mark key={found} className="rounded-sm bg-attention-soft px-0.5 text-attention">
          {text.slice(found, found + needle.length)}
        </mark>,
      );
      cursor = found + needle.length;
      found = lower.indexOf(needle, cursor);
    }
    if (parts.length) {
      parts.push(text.slice(cursor));
      return <>{parts}</>;
    }
  }
  return <>{text}</>;
}
