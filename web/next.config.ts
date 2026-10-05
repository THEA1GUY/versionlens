import type { NextConfig } from "next";

const apiBase = process.env.VERSIONLENS_API_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The browser talks to /api/* on its own origin; Next forwards to the Python service.
  // Keeps the API off the public internet in dev and avoids CORS entirely.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiBase}/api/:path*` }];
  },
};

export default nextConfig;
