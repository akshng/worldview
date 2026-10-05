import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Loaded at runtime from node_modules (PGlite ships its own WASM/data files).
  // node-llama-cpp ships native llama.cpp binaries.
  serverExternalPackages: ["@electric-sql/pglite", "pg", "node-llama-cpp"],
};

export default nextConfig;
