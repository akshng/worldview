import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Loaded at runtime from node_modules (PGlite ships its own WASM/data files).
  // node-llama-cpp ships native llama.cpp binaries.
  serverExternalPackages: ["@electric-sql/pglite", "pg", "node-llama-cpp"],
  // next/image isn't used; turning the optimizer off removes /_next/image entirely
  // (it was the attack surface of a Next.js security advisory).
  images: { unoptimized: true },
};

export default nextConfig;
