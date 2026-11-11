import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every screen is per-user and live (auth-gated, LAN-only), so nothing is prerendered or cached.
  // Cache Components stays off to keep rendering simple and predictable.
  serverExternalPackages: ["pg", "@node-rs/argon2"],
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
