"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Citation, DocumentModel, Side } from "@/lib/engine/model";
import { PdfPage } from "./PdfPage";

type ViewMode = "text" | "page";

/**
 * One version rendered block by block, each keyed by the same id the engine cites.
 * Selecting a change scrolls to the cited block and highlights the exact character span.
 *
 * For a PDF the pane can also show the real page with the clause outlined, which is what
 * a reviewer wants when the formatting itself matters.
 */
export function DocumentPane({
  side,
  model,
  original,
  citation,
  highlightQuery,
}: {
  side: Side;
  model: DocumentModel | null;
  original: Blob | null;
  citation: Citation | null;
  highlightQuery: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<ViewMode>("text");
  const targetId = citation?.blockId ?? null;
  const isPdf = model?.mimeType === "application/pdf";

  const sections = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of model?.sections ?? []) {
      map.set(s.id, s.sectionNumber ? `${s.sectionNumber} ${s.heading}` : s.heading);
    }
    return map;
  }, [model]);

  const problemPages = useMemo(
    () =>
      new Set(
        (model?.pages ?? [])
          .filter((p) => p.status !== "extraction_successful")
          .map((p) => p.pageNumber),
      ),
    [model],
  );

  useEffect(() => {
    if (!targetId || mode !== "text" || !scrollRef.current) return;
    const node = scrollRef.current.querySelector<HTMLElement>(`[data-block="${targetId}"]`);
    node?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [targetId, mode]);

  if (!model) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-[12.5px] text-ink-faint">
        Loading Version {side}…
      </div>
    );
  }

  const citedBlock = targetId ? model.blocks.find((b) => b.id === targetId) : undefined;
  let lastPage = 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-rule bg-canvas px-3 py-2">
        <div className="min-w-0">
          <div className="label-caps">Version {side}</div>
          <div className="truncate text-[12.5px] font-medium" title={model.filename}>
            {model.filename}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isPdf && original ? (
            <div
              className="flex overflow-hidden rounded border border-rule"
              role="group"
              aria-label="View mode"
            >
              {(["text", "page"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
                  className={`px-2 py-[3px] text-[11px] transition-colors ${
                    mode === m ? "bg-action text-on-action" : "bg-paper text-ink-soft hover:text-ink"
                  }`}
                >
                  {m === "text" ? "Text" : "Page"}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      {model.paginationApproximate ? (
        <p className="border-b border-rule-soft bg-attention-soft px-3 py-1 text-[10.5px] text-attention">
          Page numbers are estimated for this file — section references are exact.
        </p>
      ) : null}

      {mode === "page" && original && isPdf ? (
        <div className="scroll-thin min-h-0 flex-1 overflow-auto bg-canvas p-3">
          {citation ? (
            <>
              <div className="label-caps mb-2">
                Page {citation.page} · {citation.section}
              </div>
              <PdfPage file={original} pageNumber={citation.page} highlight={citedBlock?.bbox ?? null} />
              <p className="mt-2 max-w-[560px] text-[11px] leading-relaxed text-ink-faint">
                The outline marks the block the citation points at, placed from
                coordinates captured during extraction.
              </p>
            </>
          ) : (
            <p className="text-[12.5px] text-ink-faint">
              Select a change to see its page here.
            </p>
          )}
        </div>
      ) : (
        <div ref={scrollRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {model.blocks.map((block) => {
            const isNewPage = block.page !== lastPage;
            lastPage = block.page;
            const isTarget = block.id === targetId;
            const sectionName = block.sectionId ? sections.get(block.sectionId) : undefined;

            return (
              <div key={block.id}>
                {isNewPage ? (
                  <div className="mb-2 mt-4 flex items-center gap-2 first:mt-0">
                    <span className="label-caps shrink-0">
                      {model.paginationApproximate ? "~" : ""}Page {block.page}
                    </span>
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
                  {block.blockType === "heading" ? (
                    <h3 className="serif-title mt-1 text-[14px] font-semibold">{block.text}</h3>
                  ) : block.blockType === "table_row" && block.cells ? (
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
                        span={
                          isTarget && citation ? [citation.charStart, citation.charEnd] : null
                        }
                        query={highlightQuery}
                      />
                    </p>
                  )}
                  {block.ocr ? (
                    <div
                      className="mt-0.5 text-[10px] text-attention"
                      title="Transcribed from a page image by a model, not read from the file"
                    >
                      machine-read
                      {typeof block.ocrConfidence === "number"
                        ? ` · ${Math.round(block.ocrConfidence * 100)}% legible`
                        : ""}
                    </div>
                  ) : null}
                  {isTarget && sectionName ? (
                    <div className="mt-0.5 text-[10.5px] text-accent">{sectionName}</div>
                  ) : null}
                </div>
              </div>
            );
          })}
          <div className="h-32" aria-hidden="true" />
        </div>
      )}
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
    if (parts.length > 0) {
      parts.push(text.slice(cursor));
      return <>{parts}</>;
    }
  }
  return <>{text}</>;
}
