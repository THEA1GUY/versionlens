"use client";

import Link from "next/link";
import type { StoredComparison } from "@/lib/store/db";
import { reviewProgress } from "@/lib/workflow";
import { formatDate } from "@/lib/format";
import { ProgressBar } from "./ui";

export function ComparisonTable({ rows }: { rows: StoredComparison[] }) {
  return (
    <div className="card overflow-hidden">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-rule bg-canvas text-left">
            <th scope="col" className="px-4 py-2.5 font-medium text-ink-soft">
              Comparison
            </th>
            <th scope="col" className="hidden px-4 py-2.5 font-medium text-ink-soft sm:table-cell">
              Versions
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
          {rows.map((row) => {
            const docs = row.result?.documents;
            const progress = reviewProgress(row);
            const done = row.status === "COMPLETED" || row.status === "PARTIAL";
            return (
              <tr key={row.id} className="border-b border-rule-soft last:border-0 hover:bg-canvas">
                <td className="px-4 py-3">
                  <Link
                    href={`/comparisons/${row.id}`}
                    className="font-medium text-ink hover:text-accent hover:underline"
                  >
                    {row.name}
                  </Link>
                  <div className="text-[11.5px] text-ink-faint">{formatDate(row.createdAt)}</div>
                </td>
                <td className="hidden max-w-[260px] px-4 py-3 text-ink-soft sm:table-cell">
                  <div className="truncate">{docs?.a.filename ?? "—"}</div>
                  <div className="truncate text-ink-faint">{docs?.b.filename ?? "—"}</div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {done ? progress.total : "—"}
                </td>
                <td className="px-4 py-3">
                  {row.status === "FAILED" ? (
                    <span className="text-[12.5px] text-remove">Failed</span>
                  ) : !done ? (
                    <span className="text-[12.5px] text-ink-faint">
                      {row.stageMessage ?? "Processing…"}
                    </span>
                  ) : progress.total === 0 ? (
                    <span className="text-[12.5px] text-ink-faint">No changes</span>
                  ) : (
                    <div className="w-[130px]">
                      <div className="mb-1 text-[11.5px] text-ink-faint">
                        {progress.reviewed >= progress.total
                          ? "Reviewed"
                          : `${progress.reviewed} / ${progress.total}`}
                      </div>
                      <ProgressBar value={progress.reviewed} total={progress.total} />
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
