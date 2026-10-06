"use client";

import { Suspense } from "react";
import { ComparisonPage } from "@/components/ComparisonWorkspace";
import { Spinner } from "@/components/ui";

export default function ComparisonRoute() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[520px] px-4 py-20">
          <Spinner label="Loading comparison…" />
        </div>
      }
    >
      <ComparisonPage />
    </Suspense>
  );
}
