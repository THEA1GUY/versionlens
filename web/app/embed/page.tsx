"use client";

import { Suspense, useEffect, useState } from "react";
import { seedSample } from "@/lib/embed/sample";
import { ComparisonPage } from "@/components/ComparisonWorkspace";
import { ErrorNote, Spinner } from "@/components/ui";

/**
 * The embedded demo, as shown inside the portfolio's project demo player.
 *
 * Why a dedicated route rather than a flag on the dashboard: the site header carries
 * links to Settings and New comparison, and neither belongs in a demo that must not ask
 * a visitor for an API key. A separate route suppresses that chrome in its own
 * prerendered markup, so there is no frame in which a Settings link is visible or
 * clickable. Nothing on the standalone routes changes.
 */
export default function EmbedRoute() {
  return (
    <>
      {/* Prerendered, so the site chrome never paints inside the frame. */}
      <style>{"body > div > header { display: none }"}</style>
      <Suspense
        fallback={
          <div className="mx-auto max-w-[520px] px-4 py-20">
            <Spinner label="Preparing the sample comparison…" />
          </div>
        }
      >
        <EmbeddedDemo />
      </Suspense>
    </>
  );
}

function EmbeddedDemo() {
  const [comparisonId, setComparisonId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    seedSample()
      .then((comparison) => active && setComparisonId(comparison.id))
      .catch((err: Error) => active && setError(err.message));
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <Banner />
      {error ? (
        <div className="mx-auto max-w-[620px] px-4 py-16">
          <ErrorNote>Could not prepare the sample comparison: {error}</ErrorNote>
        </div>
      ) : comparisonId ? (
        <ComparisonPage id={comparisonId} embedded />
      ) : (
        <div className="mx-auto max-w-[520px] px-4 py-20">
          <Spinner label="Comparing the sample documents…" />
        </div>
      )}
    </>
  );
}

/** 2.5rem tall, which is what `ComparisonPage`'s embedded height calculation assumes. */
function Banner() {
  return (
    <div className="flex h-10 items-center gap-2 overflow-hidden border-b border-rule bg-canvas px-4 text-[11.5px] text-ink-soft">
      <strong className="font-medium text-ink">Demo</strong>
      <span className="truncate">
        A fictional sample contract, compared by the real engine. No API key needed and
        nothing is saved.
      </span>
      <a
        href="/"
        target="_blank"
        rel="noreferrer"
        className="ml-auto shrink-0 text-accent hover:underline"
      >
        Open the full app
      </a>
    </div>
  );
}
