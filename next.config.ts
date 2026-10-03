import type { NextConfig } from "next";

// A per-build id lets open tabs notice a new deployment (see /api/version) and gives the
// service worker a fresh cache for every release.
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 10) || Date.now().toString(36);

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
};

export default nextConfig;
