"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { StoredDocument } from "@/lib/store/db";
import { deleteDocument } from "@/lib/store/db";
import { listDocuments, originalUrl, verifyIntegrity } from "@/lib/workflow";
import { formatBytes, formatDateTime } from "@/lib/format";
import { EmptyState, ErrorNote, LocalBadge, Spinner } from "@/components/ui";

type Integrity = "checking" | "verified" | "failed" | "missing";

export default function DocumentsPage() {
  const [rows, setRows] = useState<StoredDocument[] | null>(null);
  const [integrity, setIntegrity] = useState<Record<string, Integrity>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listDocuments()
      .then(async (docs) => {
        setRows(docs);
        // Re-hash each stored original and compare with what was recorded at ingest.
        const results = await Promise.all(
          docs.map(async (d) => [d.id, await verifyIntegrity(d.id)] as const),
        );
        setIntegrity(Object.fromEntries(results));
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  async function open(id: string): Promise<void> {
    const url = await originalUrl(id);
    if (url) window.open(url, "_blank", "noopener");
  }

  async function remove(id: string): Promise<void> {
    await deleteDocument(id);
    load();
  }

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="serif-title text-[24px] font-semibold">Documents</h1>
        <LocalBadge />
      </div>
      <p className="mb-5 mt-1 max-w-prose text-[13px] text-ink-soft">
        Originals are stored unchanged in this browser. Each file&rsquo;s SHA-256 is
        recorded when it is added and re-checked here, so a file altered in storage is
        reported rather than quietly used.
      </p>

      {error ? (
        <ErrorNote>{error}</ErrorNote>
      ) : !rows ? (
        <div className="card p-6">
          <Spinner label="Loading…" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No documents stored"
          body="Documents appear here once you start a comparison."
          action={
            <Link
              href="/new"
              className="mt-2 rounded-md border border-rule px-3 py-1.5 text-[13px] font-medium hover:bg-canvas"
            >
              Add documents
            </Link>
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-rule bg-canvas text-left">
                <th scope="col" className="px-4 py-2.5 font-medium text-ink-soft">File</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium text-ink-soft">
                  Pages
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium text-ink-soft">
                  Size
                </th>
                <th scope="col" className="hidden px-4 py-2.5 font-medium text-ink-soft md:table-cell">
                  Added
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium text-ink-soft">Integrity</th>
                <th scope="col" className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-rule-soft last:border-0 hover:bg-canvas">
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => void open(row.id)}
                      className="text-left font-medium hover:text-accent hover:underline"
                    >
                      {row.filename}
                    </button>
                    <div className="font-mono text-[10.5px] text-ink-faint">
                      sha256 {row.sha256.slice(0, 24)}…
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {row.model.pages.length}
                    {row.model.paginationApproximate ? (
                      <span className="text-ink-faint" title="Estimated pagination">
                        {" "}
                        ~
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatBytes(row.sizeBytes)}
                  </td>
                  <td className="hidden px-4 py-3 text-ink-soft md:table-cell">
                    {formatDateTime(row.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <IntegrityCell state={integrity[row.id]} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => void remove(row.id)}
                      className="text-[12px] text-ink-faint hover:text-remove hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function IntegrityCell({ state }: { state: Integrity | undefined }) {
  if (!state || state === "checking") {
    return <span className="text-[12px] text-ink-faint">Checking…</span>;
  }
  if (state === "verified") return <span className="text-[12px] text-add">Verified</span>;
  if (state === "missing") {
    return <span className="text-[12px] text-attention">Original missing</span>;
  }
  return (
    <span className="text-[12px] font-medium text-remove" title="Stored bytes no longer match the recorded hash">
      Hash mismatch
    </span>
  );
}
