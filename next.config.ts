import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Loaded at runtime from node_modules (PGlite ships its own WASM/data files).
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
};

export default nextConfig;
