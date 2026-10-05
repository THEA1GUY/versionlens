"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { CATEGORY_LABEL } from "@/lib/engine/changes";
import { type TimelineRow, buildTimeline, summariseChain } from "@/lib/chain";
import type { StoredChain, StoredComparison } from "@/lib/store/db";
import { loadChain } from "@/lib/workflow";
import { formatDateTime } from "@/lib/format";
import { Disclaimer, EmptyState, LocalBadge, Spinner } from "@/components/ui";
import { DISCLAIMER } from "@/lib/engine/compare";

export default function ChainRoute() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[520px] px-4 py-20">
          <Spinner label="Loading version chain…" />
        </div>
      }
    >
      <ChainPage />
    </Suspense>
  );
}

function ChainPage() {
  const id = useSearchParams().get("id") ?? "";
  const [data, setData] = useState<{
    chain: StoredChain;
    steps: StoredComparison[];
    names: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setError("No version chain was specified.");
      return;
    }
    let active = true;
    loadChain(id)
      .then((loaded) => {
        if (!active) return;
        if (!loaded) setError("This version chain is not stored in this browser.");
        else setData(loaded);
      })
      .catch((err: Error) => active && setError(err.message));
    return () => {
      active = false;
    };
  }, [id]);

  const timeline = useMemo(() => (data ? buildTimeline(data.steps) : []), [data]);
  const summary = useMemo(
    () => (data ? summariseChain(data.steps, data.names) : null),
    [data],
  );

  if (error) {
    return (
      <div className="mx-auto max-w-[620px] px-4 py-16">
        <EmptyState
          title="Version chain unavailable"
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
  if (!data || !summary) {
    return (
      <div className="mx-auto max-w-[520px] px-4 py-20">
        <Spinner label="Loading version chain…" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6">
      <nav className="mb-5 text-[12.5px] text-ink-faint">
        <Link href="/" className="hover:text-ink hover:underline">
          Dashboard
        </Link>
        <span aria-hidden="true"> / </span>
        <span>Version chain</span>
      </nav>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="serif-title text-[26px] font-semibold">{data.chain.name}</h1>
        <LocalBadge />
      </div>
      <p className="mt-1 text-[13px] text-ink-soft">
        {summary.versions} versions · {summary.totalChanges} changes across{" "}
        {summary.perStep.length} steps · {formatDateTime(data.chain.createdAt)}
      </p>

      {/* ------------------------------------------------------- the versions */}
      <section className="mt-7">
        <h2 className="label-caps mb-2">Versions</h2>
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-[12.5px]">
          {data.names.map((name, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="rounded border border-rule bg-paper px-2 py-1">
                <span className="label-caps mr-1.5">v{i + 1}</span>
                {name}
              </span>
              {i < data.names.length - 1 ? (
                <span aria-hidden="true" className="text-ink-faint">
                  →
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      {/* -------------------------------------------------------- the timeline */}
      <section className="mt-7">
        <h2 className="label-caps mb-2">How values moved</h2>
        {timeline.length === 0 ? (
          <p className="card p-5 text-[13px] text-ink-soft">
            No numeric value changed across these versions. The per-step comparisons below
            still list every wording, scope and obligation change.
          </p>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-rule bg-canvas text-left">
                  <th scope="col" className="px-4 py-2.5 font-medium text-ink-soft">
                    Value
                  </th>
                  {data.names.map((name, i) => (
                    <th
                      key={i}
                      scope="col"
                      className="px-3 py-2.5 text-right font-medium text-ink-soft"
                      title={name}
                    >
                      v{i + 1}
                    </th>
                  ))}
                  <th scope="col" className="px-4 py-2.5 text-right font-medium text-ink-soft">
                    Net
                  </th>
                </tr>
              </thead>
              <tbody>
                {timeline.map((row) => (
                  <TimelineRowView key={row.key} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-faint">
          Values are stitched across steps by matching a step&rsquo;s new value to the next
          step&rsquo;s old value for the same kind of thing. A blank cell means that value
          did not change in that round, not that it was absent.
        </p>
      </section>

      {/* ------------------------------------------------------------- steps */}
      <section className="mt-8">
        <h2 className="label-caps mb-2">Each step</h2>
        <div className="card overflow-hidden">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-rule bg-canvas text-left">
                <th scope="col" className="px-4 py-2.5 font-medium text-ink-soft">
                  Step
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium text-ink-soft">
                  Changes
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium text-ink-soft">
                  High attention
                </th>
                <th scope="col" className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {summary.perStep.map((step) => (
                <tr
                  key={step.comparisonId}
                  className="border-b border-rule-soft last:border-0 hover:bg-canvas"
                >
                  <td className="px-4 py-3">{step.label}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{step.total}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {step.high > 0 ? (
                      <span className="font-medium text-remove">{step.high}</span>
                    ) : (
                      step.high
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/comparison?id=${step.comparisonId}`}
                      className="text-[12.5px] text-accent hover:underline"
                    >
                      Review step
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="mt-10 border-t border-rule pt-4">
        <Disclaimer text={DISCLAIMER} />
      </footer>
    </div>
  );
}

function TimelineRowView({ row }: { row: TimelineRow }) {
  const rising = (row.netAbsolute ?? 0) > 0;
  const net =
    row.netAbsolute === null
      ? "—"
      : `${rising ? "+" : "−"}${Math.abs(row.netAbsolute).toLocaleString(undefined, {
          maximumFractionDigits: 2,
        })}${row.netPercentage !== null ? ` (${rising ? "+" : "−"}${Math.abs(row.netPercentage)}%)` : ""}`;

  return (
    <tr className="border-b border-rule-soft last:border-0 hover:bg-canvas">
      <td className="px-4 py-3">
        <div className="font-medium">{row.label}</div>
        <div className="label-caps">{CATEGORY_LABEL[row.category] ?? row.category}</div>
      </td>
      {row.points.map((point, i) => (
        <td key={i} className="px-3 py-3 text-right font-mono text-[12.5px] tabular-nums">
          {point ? (
            point.display
          ) : (
            <span className="text-ink-faint" title="Unchanged this round">
              ·
            </span>
          )}
        </td>
      ))}
      <td
        className={`px-4 py-3 text-right text-[12.5px] tabular-nums ${
          row.netAbsolute === null ? "text-ink-faint" : rising ? "text-remove" : "text-add"
        }`}
      >
        {net}
      </td>
    </tr>
  );
}
