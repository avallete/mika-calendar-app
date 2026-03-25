import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite"],
  allowedDevOrigins: ['100.102.46.17', '192.168.1.18'],
};

export default nextConfig;
