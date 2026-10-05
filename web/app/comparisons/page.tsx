"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { StoredComparison } from "@/lib/store/db";
import { listComparisons } from "@/lib/workflow";
import { ComparisonTable } from "@/components/ComparisonTable";
import { EmptyState, ErrorNote, Spinner } from "@/components/ui";

export default function ComparisonsPage() {
  const [rows, setRows] = useState<StoredComparison[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listComparisons()
      .then(setRows)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6">
      <h1 className="serif-title mb-1 text-[24px] font-semibold">Comparisons</h1>
      <p className="mb-5 text-[13px] text-ink-soft">
        Stored in this browser on this device.
      </p>
      {error ? (
        <ErrorNote>{error}</ErrorNote>
      ) : !rows ? (
        <div className="card p-6">
          <Spinner label="Loading…" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No comparisons yet"
          body="Start by adding two versions of the same document."
          action={
            <Link
              href="/new"
              className="mt-2 rounded-md border border-rule px-3 py-1.5 text-[13px] font-medium hover:bg-canvas"
            >
              New comparison
            </Link>
          }
        />
      ) : (
        <ComparisonTable rows={rows} />
      )}
    </div>
  );
}
