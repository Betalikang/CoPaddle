import type { NextConfig } from 'next';

// dev 与 build 使用不同产物目录，避免互相清空导致的
// "Cannot find module [turbopack]_runtime.js" 全站 500。
// dev 时设置 NEXT_DIST_DIR=.next-dev（见 package.json dev 脚本）；
// 不设置时（build/start）仍用默认 .next。
const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  experimental: {
    ppr: true,
    clientSegmentCache: true
  }
};

export default nextConfig;
