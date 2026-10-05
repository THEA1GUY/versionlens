"use client";

import Link from "next/link";
import type { StoredChain } from "@/lib/store/db";
import { formatDate } from "@/lib/format";

export function ChainTable({ rows }: { rows: StoredChain[] }) {
  return (
    <div className="card overflow-hidden">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-rule bg-canvas text-left">
            <th scope="col" className="px-4 py-2.5 font-medium text-ink-soft">
              Version chain
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium text-ink-soft">
              Versions
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium text-ink-soft">
              Steps
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-rule-soft last:border-0 hover:bg-canvas">
              <td className="px-4 py-3">
                <Link
                  href={`/chain?id=${row.id}`}
                  className="font-medium text-ink hover:text-accent hover:underline"
                >
                  {row.name}
                </Link>
                <div className="text-[11.5px] text-ink-faint">{formatDate(row.createdAt)}</div>
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{row.documentIds.length}</td>
              <td className="px-4 py-3 text-right tabular-nums">{row.comparisonIds.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
