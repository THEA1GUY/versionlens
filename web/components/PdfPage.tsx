"use client";

import { useEffect, useRef, useState } from "react";
import type { BBox } from "@/lib/engine/model";

/**
 * Renders one real PDF page to a canvas and paints the cited clause on top of it.
 *
 * This is the "there it is, on the actual page" view. Bounding boxes are captured during
 * extraction in PDF user space with a top-left origin; the overlay converts them to CSS
 * pixels with the same scale the canvas was rendered at, so the rectangle lands on the
 * glyphs it describes rather than near them.
 */
export function PdfPage({
  file,
  pageNumber,
  highlight,
  maxWidth = 560,
}: {
  file: Blob;
  pageNumber: number;
  highlight: BBox | null;
  maxWidth?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ width: number; height: number; scale: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // pdf.js drives its display render with requestAnimationFrame, which browsers stop
  // firing in a background tab. Starting a render there never completes, so the page
  // would sit on "Rendering…" indefinitely. Wait for the tab to come back instead.
  const [hidden, setHidden] = useState(
    () => typeof document !== "undefined" && document.hidden,
  );

  useEffect(() => {
    const onVisibility = (): void => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (hidden) return;
    let cancelled = false;
    let renderTask: { cancel: () => void } | null = null;

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const { loadPdfjs } = await import("@/lib/engine/extract/pdf");
        const pdfjs = await loadPdfjs();
        const buffer = await file.arrayBuffer();
        if (cancelled) return;

        const doc = await pdfjs.getDocument({ data: buffer }).promise;
        if (cancelled) {
          void doc.destroy();
          return;
        }
        const page = await doc.getPage(Math.min(Math.max(1, pageNumber), doc.numPages));
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(maxWidth / base.width, 2);
        const viewport = page.getViewport({ scale });

        const canvas = canvasRef.current;
        if (!canvas || cancelled) {
          void doc.destroy();
          return;
        }
        // Render at device resolution so text stays crisp, then size it down in CSS.
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        const context = canvas.getContext("2d");
        if (!context) {
          void doc.destroy();
          throw new Error("Canvas is unavailable in this browser.");
        }
        context.scale(dpr, dpr);

        renderTask = page.render({ canvasContext: context, viewport });
        await (renderTask as unknown as { promise: Promise<void> }).promise;
        if (cancelled) {
          void doc.destroy();
          return;
        }
        setSize({ width: viewport.width, height: viewport.height, scale });
        setLoading(false);
        void doc.destroy();
      } catch (err) {
        if (cancelled) return;
        // A cancelled render throws; that is not a failure worth showing.
        const message = err instanceof Error ? err.message : String(err);
        if (!/cancel/i.test(message)) setError(message);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [file, pageNumber, maxWidth, hidden]);

  const box = highlight && size ? scaleBox(highlight, size.scale) : null;

  return (
    <div className="relative inline-block max-w-full">
      <canvas
        ref={canvasRef}
        style={size ? { width: size.width, height: size.height } : undefined}
        className="max-w-full rounded border border-rule bg-white shadow-sm"
        aria-label={`Page ${pageNumber}`}
      />
      {box ? (
        <div
          className="pointer-events-none absolute rounded-[2px] border border-accent bg-accent/15"
          style={{
            left: box.left - 2,
            top: box.top - 2,
            width: box.width + 4,
            height: box.height + 4,
          }}
          aria-hidden="true"
        />
      ) : null}
      {hidden ? (
        <div className="absolute inset-0 flex items-center justify-center rounded border border-rule bg-canvas px-4 text-center text-[12px] text-ink-faint">
          Page rendering pauses while this tab is in the background. Return to this tab to
          see page {pageNumber}.
        </div>
      ) : loading ? (
        <div className="absolute inset-0 flex items-center justify-center rounded border border-rule bg-canvas text-[12px] text-ink-faint">
          Rendering page {pageNumber}…
        </div>
      ) : null}
      {error ? (
        <div className="rounded border border-rule bg-canvas p-4 text-[12px] text-remove">
          Could not render this page: {error}
        </div>
      ) : null}
    </div>
  );
}

/** Exported so the coordinate transform can be tested without a canvas. */
export function scaleBox(
  bbox: BBox,
  scale: number,
): { left: number; top: number; width: number; height: number } {
  const [x0, top, x1, bottom] = bbox;
  return {
    left: x0 * scale,
    top: top * scale,
    width: Math.max(2, (x1 - x0) * scale),
    height: Math.max(2, (bottom - top) * scale),
  };
}
