import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  distDir: process.env.POLICYPULSE_TEST === "1" ? ".next-test" : ".next",
  outputFileTracingRoot: path.resolve(process.cwd()),
};
export default nextConfig;
