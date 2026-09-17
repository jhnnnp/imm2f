import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: { root: process.cwd() },
  // Avoid advertising the framework in every response. This is only a
  // hardening measure; keeping dependencies patched remains the real defense.
  poweredByHeader: false,
};

export default nextConfig;
