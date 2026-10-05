"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ComparisonListItem } from "@/lib/types";
import { EmptyState, Spinner } from "@/components/ui";
import { ComparisonTable } from "../page";

export default function ComparisonsPage() {
  const [rows, setRows] = useState<ComparisonListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listComparisons()
      .then(setRows)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6">
      <h1 className="serif-title mb-5 text-[24px] font-semibold">Comparisons</h1>
      {error ? (
        <div className="card p-4 text-[13px] text-remove">{error}</div>
      ) : !rows ? (
        <div className="card p-6">
          <Spinner label="Loading…" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No comparisons yet"
          body="Start by uploading two versions of the same document."
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
