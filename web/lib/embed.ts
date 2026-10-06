/**
 * Embedded demo mode.
 *
 * VersionLens is framed by the portfolio's project demo player. Inside a cross-origin
 * frame two things the standalone app relies on stop being safe to assume:
 *
 *   1. IndexedDB may be partitioned per top-level site, or blocked outright (Safari and
 *      Firefox in their stricter modes). See `lib/store/db.ts` for the fallback.
 *   2. Asking a casual visitor for a model API key is the wrong thing to do, and paying
 *      for their model calls is not on offer either.
 *
 * So embedded mode is read-only-ish: fictional sample data, no key prompt, no paid calls.
 * It is opt-in via a query parameter, which means the standalone app cannot accidentally
 * enter it — every check below is false unless the URL says otherwise.
 */

export const EMBED_PARAM = "embed";

/** `trailingSlash: true` means the deployed path is `/embed/`. */
const EMBED_PATH = /\/embed\/?$/;

/**
 * Whether this page is running as the embedded demo.
 *
 * Returns false during static prerendering, which is correct: the prerendered HTML is
 * the standalone shell, and the embed chrome mounts on the client.
 */
export function isEmbedded(): boolean {
  if (typeof window === "undefined") return false;
  // The /embed route is itself the signal, so the player needs no query string and the
  // storage fallback is in place before the route's own code runs. The parameter exists
  // for the case where the demo ever needs to hand off to another route.
  if (EMBED_PATH.test(window.location.pathname)) return true;
  return new URLSearchParams(window.location.search).get(EMBED_PARAM) === "1";
}

/** Carry the flag across in-app navigation, so a link cannot drop out of demo mode. */
export function embedHref(path: string): string {
  if (!isEmbedded()) return path;
  return path.includes("?") ? `${path}&${EMBED_PARAM}=1` : `${path}?${EMBED_PARAM}=1`;
}
