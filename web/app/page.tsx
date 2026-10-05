"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { ComparisonListItem, Health } from "@/lib/types";
import { Disclaimer, EmptyState, ProgressBar, Spinner } from "@/components/ui";

export default function DashboardPage() {
  const [comparisons, setComparisons] = useState<ComparisonListItem[] | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([api.listComparisons(), api.health()])
      .then(([list, info]) => {
        if (!active) return;
        setComparisons(list);
        setHealth(info);
      })
      .catch((err: Error) => active && setError(err.message));
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6">
      <section className="mb-10">
        <h1 className="serif-title max-w-2xl text-[30px] font-semibold leading-[1.18]">
          See exactly what changed between document versions.
        </h1>
        <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-ink-soft">
          Compare proposals, agreements and contracts side by side. VersionLens highlights
          changes to pricing, scope, deadlines, responsibilities and key terms, with
          references back to both original documents.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Link
            href="/new"
            className="rounded-md bg-ink px-4 py-2 text-[13.5px] font-medium text-white transition-colors hover:bg-black"
          >
            Compare two documents
          </Link>
          {health ? (
            <span className="text-[12px] text-ink-faint">
              Engine {health.engine_version} ·{" "}
              {health.semantic_available
                ? `semantic analysis on (${health.semantic_model})`
                : "deterministic analysis only"}
            </span>
          ) : null}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="label-caps">Recent comparisons</h2>
          {comparisons && comparisons.length > 0 ? (
            <Link href="/comparisons" className="text-[12.5px] text-accent hover:underline">
              View all
            </Link>
          ) : null}
        </div>

        {error ? (
          <div className="card p-4 text-[13px] text-remove">
            Could not reach the comparison service: {error}
          </div>
        ) : !comparisons ? (
          <div className="card p-6">
            <Spinner label="Loading comparisons…" />
          </div>
        ) : comparisons.length === 0 ? (
          <EmptyState
            title="No comparisons yet"
            body="Upload two versions of a proposal, contract or statement of work to see a traceable change review."
            action={
              <Link
                href="/new"
                className="mt-2 rounded-md border border-rule px-3 py-1.5 text-[13px] font-medium text-ink transition-colors hover:bg-canvas"
              >
                Start a comparison
              </Link>
            }
          />
        ) : (
          <ComparisonTable rows={comparisons.slice(0, 10)} />
        )}
      </section>

      {health ? (
        <footer className="mt-10 border-t border-rule pt-4">
          <Disclaimer text={health.disclaimer} />
        </footer>
      ) : null}
    </div>
  );
}

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
    return <span className="text-[12.5px] text-ink-faint">{row.stage_message || "Processing…"}</span>;
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
