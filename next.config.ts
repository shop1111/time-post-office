import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client"],
  devIndicators: false,
  experimental: { serverActions: { bodySizeLimit: "15mb" } },
  webpack: (config, { dev }) => {
    // 开发时不要监听 data/：SQLite 每次写入都会触发重新编译，页面跟着刷新，演示中途可能整页重载
    if (dev) config.watchOptions = { ...config.watchOptions, ignored: ["**/.git/**", "**/.next/**", "**/node_modules/**", "**/data/**"] };
    return config;
  },
};

export default nextConfig;
