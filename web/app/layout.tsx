import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "VersionLens — see exactly what changed",
  description:
    "Compare proposals, agreements and contracts side by side, with references back to both original documents.",
};

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/comparisons", label: "Comparisons" },
  { href: "/documents", label: "Documents" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-paper focus:px-3 focus:py-2 focus:text-accent focus:shadow"
        >
          Skip to content
        </a>
        <div className="min-h-screen">
          <header className="sticky top-0 z-30 border-b border-rule bg-paper/95 backdrop-blur-sm">
            <div className="mx-auto flex h-14 max-w-[1680px] items-center gap-6 px-4 sm:px-6">
              <Link href="/" className="flex items-center gap-2.5">
                <Mark />
                <span className="serif-title text-[17px] font-semibold">VersionLens</span>
              </Link>
              <nav aria-label="Main" className="hidden items-center gap-1 sm:flex">
                {NAV.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded px-2.5 py-1.5 text-[13px] text-ink-soft transition-colors hover:bg-canvas hover:text-ink"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              <div className="ml-auto flex items-center gap-3">
                <span className="hidden text-[11.5px] text-ink-faint md:inline">
                  Review aid — not legal advice
                </span>
                <Link
                  href="/new"
                  className="rounded-md bg-ink px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-black"
                >
                  New comparison
                </Link>
              </div>
            </div>
          </header>
          <main id="main">{children}</main>
        </div>
      </body>
    </html>
  );
}

function Mark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="1.5" y="2.5" width="7" height="15" rx="1.5" fill="none" stroke="#16181d" strokeWidth="1.3" />
      <rect x="11.5" y="2.5" width="7" height="15" rx="1.5" fill="none" stroke="#1a4fd6" strokeWidth="1.3" />
      <path d="M3.6 7h3.8M3.6 10h3.8M3.6 13h2.4" stroke="#818a99" strokeWidth="1.1" strokeLinecap="round" />
      <path d="M13.6 7h3.8M13.6 10h3.8M13.6 13h3.1" stroke="#1a4fd6" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}
