import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Versions the service worker per deploy (see public/sw.js): Vercel's
  // deployment id, else the commit, else the build's start time.
  env: { SW_VERSION: process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || Date.now().toString(36) },
  // The dev badge sits over the Home tab on phones; compile/runtime errors still surface without it.
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
