"use client";

import Link from "next/link";
import type { ComparisonListItem } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { ProgressBar } from "./ui";

export function ComparisonTable({ rows }: { rows: ComparisonListItem[] }) {
  return (
    <div className="card overflow-hidden">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-rule bg-canvas text-left">
            <th scope="col" className="px-4 py-2.5 font-medium text-ink-soft">
              Comparison
            </th>
            <th scope="col" className="hidden px-4 py-2.5 font-medium text-ink-soft sm:table-cell">
              Version A
            </th>
            <th scope="col" className="hidden px-4 py-2.5 font-medium text-ink-soft sm:table-cell">
              Version B
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium text-ink-soft">
              Changes
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium text-ink-soft">
              Review
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-rule-soft last:border-0 hover:bg-canvas">
              <td className="px-4 py-3">
                <Link
                  href={`/comparisons/${row.id}`}
                  className="font-medium text-ink hover:text-accent hover:underline"
                >
                  {row.name || "Untitled comparison"}
                </Link>
                <div className="text-[11.5px] text-ink-faint">{formatDate(row.created_at)}</div>
              </td>
              <td className="hidden max-w-[180px] truncate px-4 py-3 text-ink-soft sm:table-cell">
                {row.version_a_filename}
              </td>
              <td className="hidden max-w-[180px] truncate px-4 py-3 text-ink-soft sm:table-cell">
                {row.version_b_filename}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {row.status === "COMPLETED" || row.status === "PARTIAL" ? row.change_count : "—"}
              </td>
              <td className="px-4 py-3">
                <StatusCell row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusCell({ row }: { row: ComparisonListItem }) {
  if (row.status === "FAILED") {
    return <span className="text-[12.5px] text-remove">Failed</span>;
  }
  if (row.status !== "COMPLETED" && row.status !== "PARTIAL") {
    return (
      <span className="text-[12.5px] text-ink-faint">{row.stage_message || "Processing…"}</span>
    );
  }
  if (row.change_count === 0) {
    return <span className="text-[12.5px] text-ink-faint">No changes</span>;
  }
  const done = row.reviewed_count >= row.change_count;
  return (
    <div className="w-[130px]">
      <div className="mb-1 text-[11.5px] text-ink-faint">
        {done ? "Reviewed" : `${row.reviewed_count} / ${row.change_count}`}
      </div>
      <ProgressBar value={row.reviewed_count} total={row.change_count} />
    </div>
  );
}
