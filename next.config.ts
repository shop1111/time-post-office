import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client"],
  devIndicators: false,
  experimental: { serverActions: { bodySizeLimit: "15mb" } },
  // 旧网址：记录 / 时间线 / 信箱 → 胶囊 / 邮件（查询参数会自动带上）
  async redirects() {
    return [
      { source: "/record", destination: "/capsules/new", permanent: false },
      { source: "/timeline", destination: "/capsules", permanent: false },
      { source: "/entry/:id", destination: "/capsules/:id", permanent: false },
      { source: "/mailbox", destination: "/mail", permanent: false },
      { source: "/mailbox/:id", destination: "/mail/:id", permanent: false },
    ];
  },
};

export default nextConfig;
