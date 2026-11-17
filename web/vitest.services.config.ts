import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * 服务层测试专用配置：连真实 PostgreSQL（本地 5433，docker compose up -d db）。
 * 这些测试会插删数据，必须显式跑（pnpm test:services），不能混进默认流水线。
 */
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') }
  },
  test: {
    environment: 'node',
    include: ['tests/services/**/*.test.ts'],
    hookTimeout: 30000,
    testTimeout: 30000,
    // 服务层测试共用同一个库，串行执行避免互相踩数据
    fileParallelism: false
  }
});