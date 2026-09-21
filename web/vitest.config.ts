import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 服务层测试连真实 PostgreSQL（本地 5433，docker compose up -d db）
    hookTimeout: 30000,
    testTimeout: 30000
  }
});
