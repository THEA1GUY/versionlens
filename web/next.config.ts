import type { NextConfig } from "next";

/**
 * VersionLens ships as static files.
 *
 * There is no server component to the product: documents are read, compared and stored
 * in the browser, and the only outbound request is the one the user enables to their own
 * model provider. A static export makes that structural — there is no backend to send a
 * document to, even by accident.
 */
const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
  images: { unoptimized: true },
  // Vercel and most static hosts serve /comparison as /comparison.html or /comparison/.
  // Trailing slashes keep deep links working on hosts that do not rewrite extensionless
  // paths.
  trailingSlash: true,
};

export default nextConfig;
