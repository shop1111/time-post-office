import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client"],
  devIndicators: false,
  experimental: { serverActions: { bodySizeLimit: "15mb" } },
  // 开发时编译过的页面多留一会儿：默认只留 5 个、闲置 1 分钟就丢，来回点页面会反复重新编译
  onDemandEntries: { maxInactiveAge: 60 * 60 * 1000, pagesBufferLength: 100 },
  webpack: (config, { dev }) => {
    // 开发时不要监听 data/：SQLite 每次写入都会触发重新编译，页面跟着刷新，演示中途可能整页重载
    if (dev) config.watchOptions = { ...config.watchOptions, ignored: ["**/.git/**", "**/.next/**", "**/node_modules/**", "**/data/**"] };
    return config;
  },
};

export default nextConfig;
