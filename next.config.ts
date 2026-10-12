import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: { root: process.cwd() },
  // A shared wall sends both its base and edited snapshot. Bound the drawings
  // in the action, while allowing the two validated documents and form overhead.
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
  // Avoid advertising the framework in every response. This is only a
  // hardening measure; keeping dependencies patched remains the real defense.
  poweredByHeader: false,
};

export default nextConfig;
