import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/docs/regimes", destination: "/docs/market-status", permanent: true },
      { source: "/docs/router", destination: "/docs/borrowing-rules", permanent: true },
    ];
  },
};

export default nextConfig;
