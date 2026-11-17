import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * 测试分两类，默认只跑离线那类：
 *
 *   tests/api/**、tests/lib/**   —— 纯离线，Node 环境，mock fetch
 *   tests/ui/**                  —— 纯离线，happy-dom 环境，渲染真实组件
 *   tests/services/**            —— 连真实 PostgreSQL（本地 5433，docker compose up -d db）
 *
 * 原因：优化计划 P2 要求「CI 顺序 = 类型检查 → 离线单测 → 隔离临时库服务测试 → 构建」，
 * 而 `pnpm test` 若默认连库，没起数据库的人（和 CI 的前半段）就一条测试都跑不了。
 * 服务层测试改用 `pnpm test:services` 显式触发。
 *
 * 用 projects 而不是全局 environment，是因为组件测试需要 DOM 而纯函数测试不需要：
 * 全局开 happy-dom 会让每个 api/lib 测试都多背一份 DOM 初始化成本与全局污染风险。
 */
const alias = { '@': path.resolve(__dirname, '.') };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/api/**/*.test.ts', 'tests/lib/**/*.test.ts']
        }
      },
      {
        resolve: { alias },
        test: {
          name: 'ui',
          environment: 'happy-dom',
          include: ['tests/ui/**/*.test.tsx', 'tests/ui/**/*.test.ts'],
          setupFiles: ['tests/ui/setup.ts'],
          // React 19 + happy-dom 下 act() 需要这个标记，否则每次渲染都打警告
          globals: true
        }
      }
    ],
    exclude: ['node_modules', 'tests/services/**'],
    hookTimeout: 30000,
    testTimeout: 30000
  }
});