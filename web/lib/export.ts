/**
 * Exports, generated in the browser.
 *
 * Nothing is uploaded to produce a report: the HTML report is a single self-contained
 * file the user can archive, email or print to PDF. Printing is left to the browser
 * rather than bundling a PDF engine, which keeps the download small and the output
 * identical to what the reviewer saw.
 */

import type { Change } from "./engine/changes";
import { CATEGORY_LABEL, TYPE_LABEL } from "./engine/changes";
import type { ComparisonResult } from "./engine/compare";
import type { StoredComparison } from "./store/db";
import { citationLabel, formatDateTime, formatDelta, formatValue } from "./format";

export const TABLE_HEADERS = [
  "Change ID", "Review priority", "Category", "Change type", "Summary",
  "Version A value", "Version B value", "Change", "A reference", "B reference",
  "Confidence", "Detected by", "Review status", "Reviewer notes",
];

function deltaLabel(change: Change): string {
  const bits = formatDelta(change);
  if (bits.length > 0) return bits.join(" · ");
  const before = formatValue(change.oldValue);
  const after = formatValue(change.newValue);
  if (before !== "—" && after !== "—") return `${before} → ${after}`;
  return change.direction ?? "—";
}

function notesLabel(change: Change): string {
  return [
    ...change.notes,
    ...change.reviewerNotes.map((n) => `${n.author || "Reviewer"}: ${n.body}`),
  ].join(" | ");
}

function rows(changes: Change[], approxA: boolean, approxB: boolean): string[][] {
  return changes.map((c) => [
    c.id,
    c.importance,
    CATEGORY_LABEL[c.category] ?? c.category,
    TYPE_LABEL[c.type] ?? c.type,
    c.summary,
    formatValue(c.oldValue),
    formatValue(c.newValue),
    deltaLabel(c),
    c.citationA ? citationLabel(c.citationA.section, c.citationA.page, approxA) : "—",
    c.citationB ? citationLabel(c.citationB.section, c.citationB.page, approxB) : "—",
    c.confidenceLabel,
    c.detectors.join(", "),
    c.reviewStatus,
    notesLabel(c),
  ]);
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(
  changes: Change[],
  approxA: boolean,
  approxB: boolean,
): Blob {
  const body = [TABLE_HEADERS, ...rows(changes, approxA, approxB)]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
  // The BOM makes Excel open ₦ and → correctly without an import step.
  return new Blob([`﻿${body}`], { type: "text/csv;charset=utf-8" });
}

export function toJson(comparison: StoredComparison, changes: Change[]): Blob {
  const payload = {
    name: comparison.name,
    createdAt: comparison.createdAt,
    completedAt: comparison.completedAt,
    status: comparison.status,
    summary: comparison.result?.summary,
    documents: comparison.result?.documents,
    sectionMap: comparison.result?.sectionMap,
    warnings: comparison.result?.warnings,
    audit: comparison.result?.audit,
    disclaimer: comparison.result?.disclaimer,
    changes,
  };
  return new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
}

const esc = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * A single self-contained HTML report: every claim beside the source text that supports
 * it, printable to PDF from the browser.
 */
export function toHtmlReport(
  comparison: StoredComparison,
  result: ComparisonResult,
  changes: Change[],
): Blob {
  const docA = result.documents.a;
  const docB = result.documents.b;
  const s = result.summary;

  const changeHtml = changes
    .map((c) => {
      const deltas = formatDelta(c);
      const before = formatValue(c.oldValue);
      const after = formatValue(c.newValue);
      const showPair =
        c.oldValue?.unit !== "text" && c.newValue?.unit !== "text" &&
        c.oldValue?.unit !== "section" && c.newValue?.unit !== "section" &&
        !(before === "—" && after === "—");

      const side = (label: string, citation: Change["citationA"], text: string, approx: boolean) => `
        <div class="side">
          <div class="which">Version ${label}</div>
          <div class="cite">${citation ? esc(citationLabel(citation.section, citation.page, approx)) : "No corresponding content"}</div>
          <p class="quote">${esc(text || citation?.text || "—")}</p>
        </div>`;

      return `
      <article class="change ${esc(c.importance)}">
        <div class="tags">
          <span class="tag imp">${esc(c.importance === "HIGH" ? "High attention" : c.importance === "MEDIUM" ? "Medium attention" : "Minor")}</span>
          <span class="tag">${esc(CATEGORY_LABEL[c.category] ?? c.category)}</span>
          <span class="tag">${esc(TYPE_LABEL[c.type] ?? c.type)}</span>
          ${c.reviewStatus !== "unreviewed" ? `<span class="tag review">${esc(c.reviewStatus.replace(/_/g, " "))}</span>` : ""}
          <span class="cid">${esc(c.id)}</span>
        </div>
        <p class="claim">${esc(c.summary)}</p>
        ${showPair ? `<p class="shift">${esc(before)} &rarr; ${esc(after)}</p>` : ""}
        ${deltas.length > 0 ? `<p class="deltas">${esc(deltas.join("  ·  "))}</p>` : ""}
        <div class="spread">
          ${side("A", c.citationA, c.textA, docA.paginationApproximate)}
          ${side("B", c.citationB, c.textB, docB.paginationApproximate)}
        </div>
        ${c.notes.length > 0 ? `<ul class="notes">${c.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
        ${c.reviewerNotes.length > 0 ? `<ul class="notes reviewer">${c.reviewerNotes.map((n) => `<li><b>${esc(n.author || "Reviewer")}</b> · ${esc(formatDateTime(n.createdAt))}<br>${esc(n.body)}</li>`).join("")}</ul>` : ""}
        <div class="foot">${esc(c.confidenceLabel)} · detected by ${esc(c.detectors.join(", "))}</div>
      </article>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Comparison — ${esc(comparison.name)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { --ink:#1a1c21; --soft:#4e535e; --faint:#868c99; --rule:#e0dfda; --ground:#f7f6f3;
          --raise:#8c2f26; --watch:#7a5111; --add:#1f6245; }
  * { box-sizing:border-box }
  body { margin:0; background:#fff; color:var(--ink); line-height:1.55;
         font:14px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif }
  .wrap { max-width:900px; margin:0 auto; padding:32px 20px 64px }
  h1 { font-family:Georgia,"Times New Roman",serif; font-size:24px; font-weight:600; margin:0 0 4px }
  .sub { color:var(--soft); font-size:13px; margin:0 0 16px }
  .tally { display:flex; flex-wrap:wrap; border:1px solid var(--rule); border-radius:4px; overflow:hidden; margin:16px 0 }
  .tally div { flex:1 1 110px; padding:9px 13px; border-right:1px solid var(--rule) }
  .tally div:last-child { border-right:0 }
  .tally .n { font-size:21px; font-weight:600 }
  .tally .k { font-size:10.5px; text-transform:uppercase; letter-spacing:.07em; color:var(--faint) }
  h2 { font-size:11px; text-transform:uppercase; letter-spacing:.1em; color:var(--faint);
       border-bottom:1px solid var(--rule); padding-bottom:6px; margin:32px 0 12px }
  .change { border:1px solid var(--rule); border-radius:4px; padding:14px; margin-bottom:12px;
            break-inside:avoid; page-break-inside:avoid }
  .tags { display:flex; flex-wrap:wrap; gap:5px; align-items:center; margin-bottom:7px }
  .tag { font-size:10.5px; font-weight:600; text-transform:uppercase; letter-spacing:.05em;
         border:1px solid var(--rule); background:var(--ground); border-radius:3px; padding:2px 6px }
  .HIGH .tag.imp { color:var(--raise); border-color:var(--raise) }
  .MEDIUM .tag.imp { color:var(--watch); border-color:var(--watch) }
  .tag.review { color:var(--add); border-color:var(--add) }
  .cid { margin-left:auto; font-family:ui-monospace,Menlo,Consolas,monospace; font-size:10px; color:var(--faint) }
  .claim { font-size:14.5px; margin:0 0 6px }
  .shift { font-family:ui-monospace,Menlo,Consolas,monospace; font-weight:600; margin:0 0 3px }
  .deltas { font-size:12px; color:var(--soft); margin:0 0 10px }
  .spread { display:grid; grid-template-columns:1fr 1fr; gap:10px }
  @media (max-width:640px) { .spread { grid-template-columns:1fr } }
  .side { border:1px solid var(--rule); border-radius:3px; background:var(--ground); padding:9px 10px; min-width:0 }
  .which { font-size:10.5px; text-transform:uppercase; letter-spacing:.07em; color:var(--faint) }
  .cite { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:10.5px; color:var(--soft); margin:3px 0 6px }
  .quote { font-family:Georgia,"Times New Roman",serif; font-size:13px; margin:0; overflow-wrap:anywhere }
  .notes { margin:9px 0 0; padding-left:18px; font-size:11.5px; color:var(--soft) }
  .foot { margin-top:10px; padding-top:8px; border-top:1px solid var(--rule); font-size:11.5px; color:var(--faint) }
  .ledger { font-size:11.5px }
  .ledger div { display:flex; justify-content:space-between; gap:14px; padding:4px 0; border-bottom:1px dotted var(--rule) }
  .ledger dd { margin:0; font-family:ui-monospace,Menlo,Consolas,monospace; font-size:10.5px; overflow-wrap:anywhere; text-align:right }
  .notice { margin-top:28px; padding:12px 14px; border:1px solid var(--rule); border-radius:3px;
            font-size:11.5px; color:var(--soft) }
  .warn { border:1px solid var(--watch); color:var(--watch); border-radius:3px; padding:9px 12px;
          font-size:12px; margin-bottom:10px }
  @media print { .wrap { max-width:none; padding:0 } body { font-size:11px } }
</style></head>
<body><div class="wrap">
  <h1>Document comparison report</h1>
  <p class="sub">${esc(comparison.name)}</p>
  <p class="sub"><b>${esc(docA.filename)}</b> versus <b>${esc(docB.filename)}</b><br>
     Generated ${esc(formatDateTime(new Date().toISOString()))}</p>

  <div class="tally">
    <div><div class="n">${s.highAttention}</div><div class="k">High attention</div></div>
    <div><div class="n">${s.mediumAttention}</div><div class="k">Medium</div></div>
    <div><div class="n">${s.lowAttention}</div><div class="k">Minor</div></div>
    <div><div class="n">${s.totalChanges}</div><div class="k">Total detected</div></div>
  </div>

  <p>${esc(s.headline)}</p>
  ${result.warnings.map((w) => `<p class="warn">${esc(w)}</p>`).join("")}

  <h2>Changes (${changes.length} shown)</h2>
  ${changeHtml || "<p>No changes were recorded for this comparison.</p>"}

  <h2>Provenance</h2>
  <dl class="ledger">
    <div><dt>Version A</dt><dd>${esc(docA.filename)}</dd></div>
    <div><dt>Version A SHA-256</dt><dd>${esc(docA.sha256)}</dd></div>
    <div><dt>Version B</dt><dd>${esc(docB.filename)}</dd></div>
    <div><dt>Version B SHA-256</dt><dd>${esc(docB.sha256)}</dd></div>
    <div><dt>Comparison engine</dt><dd>${esc(result.audit.engineVersion)}</dd></div>
    <div><dt>Extraction engine</dt><dd>${esc(result.audit.extractionVersion)}</dd></div>
    <div><dt>Analysis model</dt><dd>${esc(result.audit.analysisModelVersion)}</dd></div>
    <div><dt>Completed</dt><dd>${esc(formatDateTime(result.audit.completedAt))}</dd></div>
  </dl>

  <p class="notice"><b>Disclaimer.</b> ${esc(result.disclaimer)}</p>
</div></body></html>`;

  return new Blob([html], { type: "text/html;charset=utf-8" });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function safeStem(name: string): string {
  const cleaned = [...name].map((c) => (/[\p{L}\p{N}\-_ ]/u.test(c) ? c : "-")).join("").trim();
  return (cleaned.split(/\s+/).join("-") || "versionlens").slice(0, 80);
}
