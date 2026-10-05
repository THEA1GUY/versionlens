"use client";

import { useState } from "react";
import type { Change } from "@/lib/engine/changes";
import type { StoredComparison } from "@/lib/store/db";
import { downloadBlob, safeStem, toCsv, toHtmlReport, toJson } from "@/lib/export";

export function ExportMenu({
  comparison,
  changes,
  includeMinor,
}: {
  comparison: StoredComparison;
  changes: Change[];
  includeMinor: boolean;
}) {
  const [open, setOpen] = useState(false);
  const result = comparison.result;
  const selected = includeMinor ? changes : changes.filter((c) => c.importance !== "LOW");
  const stem = safeStem(comparison.name);

  function run(kind: "html" | "csv" | "json"): void {
    if (!result) return;
    if (kind === "html") {
      downloadBlob(toHtmlReport(comparison, result, selected), `${stem}-report.html`);
    } else if (kind === "csv") {
      downloadBlob(
        toCsv(selected, result.documents.a.paginationApproximate, result.documents.b.paginationApproximate),
        `${stem}-changes.csv`,
      );
    } else {
      downloadBlob(toJson(comparison, changes), `${stem}-comparison.json`);
    }
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        disabled={!result}
        className="rounded-md border border-rule px-3 py-1.5 text-[12.5px] font-medium transition-colors hover:bg-canvas disabled:opacity-50"
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
          <div className="absolute right-0 z-20 mt-1 w-[268px] overflow-hidden rounded-md border border-rule bg-paper shadow-lg">
            <MenuItem
              title="Comparison report (HTML)"
              hint="Self-contained file — open in a browser, print to PDF"
              onClick={() => run("html")}
            />
            <MenuItem
              title="Change table (CSV)"
              hint="Opens in Excel or Sheets"
              onClick={() => run("csv")}
            />
            <MenuItem
              title="Full data (JSON)"
              hint="Every change, citation and audit field"
              onClick={() => run("json")}
            />
            <p className="border-t border-rule bg-canvas px-3 py-1.5 text-[10.5px] text-ink-faint">
              {includeMinor ? "Includes minor changes" : "Material changes only"} ·{" "}
              {selected.length} change{selected.length === 1 ? "" : "s"} · generated on this
              device
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}

function MenuItem({
  title,
  hint,
  onClick,
}: {
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full border-b border-rule-soft px-3 py-2 text-left last:border-0 hover:bg-canvas"
    >
      <span className="block text-[12.5px] font-medium">{title}</span>
      <span className="block text-[11px] text-ink-faint">{hint}</span>
    </button>
  );
}
