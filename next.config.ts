import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: { root: process.cwd() },
};

export default nextConfig;
