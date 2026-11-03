import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client"],
  devIndicators: false,
  experimental: { serverActions: { bodySizeLimit: "15mb" } },
};

export default nextConfig;
