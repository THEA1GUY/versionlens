"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ComparisonListItem, Health } from "@/lib/types";
import { Disclaimer, EmptyState, Spinner } from "@/components/ui";
import { ComparisonTable } from "@/components/ComparisonTable";

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
