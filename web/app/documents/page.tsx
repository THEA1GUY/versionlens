"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatBytes, formatDateTime } from "@/lib/format";
import { EmptyState, Spinner } from "@/components/ui";

interface DocumentRow {
  id: string;
  filename: string;
  size_bytes: number;
  sha256: string;
  created_at: string;
  uploaded_by: string | null;
  page_count: number | null;
  extraction_status: string | null;
}

export default function DocumentsPage() {
  const [rows, setRows] = useState<DocumentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/documents")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((body: { documents: DocumentRow[] }) => setRows(body.documents))
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6">
      <h1 className="serif-title text-[24px] font-semibold">Documents</h1>
      <p className="mb-5 mt-1 text-[13px] text-ink-soft">
        Originals are stored unchanged. Each file&rsquo;s SHA-256 is recorded on upload and
        re-checked before the file is served or compared.
      </p>

      {error ? (
        <div className="card p-4 text-[13px] text-remove">{error}</div>
      ) : !rows ? (
        <div className="card p-6">
          <Spinner label="Loading…" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No documents uploaded"
          body="Documents appear here once you start a comparison."
          action={
            <Link
              href="/new"
              className="mt-2 rounded-md border border-rule px-3 py-1.5 text-[13px] font-medium hover:bg-canvas"
            >
              Upload documents
            </Link>
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-rule bg-canvas text-left">
                <th scope="col" className="px-4 py-2.5 font-medium text-ink-soft">
                  File
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium text-ink-soft">
                  Pages
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium text-ink-soft">
                  Size
                </th>
                <th
                  scope="col"
                  className="hidden px-4 py-2.5 font-medium text-ink-soft md:table-cell"
                >
                  Uploaded
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium text-ink-soft">
                  Integrity
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-rule-soft last:border-0 hover:bg-canvas">
                  <td className="px-4 py-3">
                    <a
                      href={`/api/documents/${row.id}/file`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium hover:text-accent hover:underline"
                    >
                      {row.filename}
                    </a>
                    <div className="font-mono text-[10.5px] text-ink-faint">
                      sha256 {row.sha256.slice(0, 24)}…
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{row.page_count ?? "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatBytes(row.size_bytes)}
                  </td>
                  <td className="hidden px-4 py-3 text-ink-soft md:table-cell">
                    {formatDateTime(row.created_at)}
                    {row.uploaded_by ? (
                      <span className="block text-[11px] text-ink-faint">{row.uploaded_by}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    {row.extraction_status === "extraction_successful" ? (
                      <span className="text-[12px] text-add">Readable</span>
                    ) : row.extraction_status === "partial" ? (
                      <span className="text-[12px] text-attention">Partially readable</span>
                    ) : (
                      <span className="text-[12px] text-ink-faint">
                        {row.extraction_status ?? "—"}
                      </span>
                    )}
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
