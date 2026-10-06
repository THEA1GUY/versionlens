"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DISCLAIMER } from "@/lib/engine/compare";
import type { StoredChain, StoredComparison } from "@/lib/store/db";
import { listChains, listComparisons } from "@/lib/workflow";
import { ComparisonTable } from "@/components/ComparisonTable";
import { ChainTable } from "@/components/ChainTable";
import { Disclaimer, EmptyState, ErrorNote, LocalBadge, Spinner } from "@/components/ui";

export default function DashboardPage() {
  const [rows, setRows] = useState<StoredComparison[] | null>(null);
  const [chains, setChains] = useState<StoredChain[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([listComparisons(), listChains()])
      .then(([list, chainList]) => {
        if (!active) return;
        setRows(list);
        setChains(chainList);
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
        <p className="mt-2 max-w-2xl text-[13px] text-ink-soft">
          Your documents are read and compared inside this browser and saved on this device
          only. Nothing is uploaded.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Link
            href="/new"
            className="rounded-md bg-action px-4 py-2 text-[13.5px] font-medium text-on-action transition-colors duration-[120ms] hover:bg-action-hover"
          >
            Compare two documents
          </Link>
          <LocalBadge />
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="label-caps">Recent comparisons</h2>
          {rows && rows.length > 0 ? (
            <Link href="/comparisons" className="text-[12.5px] text-accent hover:underline">
              View all
            </Link>
          ) : null}
        </div>

        {error ? (
          <ErrorNote>Could not open local storage: {error}</ErrorNote>
        ) : !rows ? (
          <div className="card p-6">
            <Spinner label="Loading comparisons…" />
          </div>
        ) : rows.length === 0 ? (
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
          <ComparisonTable rows={rows.slice(0, 10)} />
        )}
      </section>

      {chains.length > 0 ? (
        <section className="mt-8">
          <h2 className="label-caps mb-3">Version chains</h2>
          <ChainTable rows={chains.slice(0, 10)} />
        </section>
      ) : null}

      <footer className="mt-10 border-t border-rule pt-4">
        <Disclaimer text={DISCLAIMER} />
      </footer>
    </div>
  );
}
