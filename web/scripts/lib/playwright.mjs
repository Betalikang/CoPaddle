/**
 * Playwright 解析助手（供 scripts/perf-measure.mjs 与 scripts/a11y-check.mjs 共用）。
 *
 * 为什么不直接 `import('playwright')`：
 *   项目没有把 playwright 作为依赖（不为验收脚本引入重依赖），通常只有 npx 缓存里有一份。
 *   在 Windows 中文用户名下（例如 C:\Users\浮舟\...），裸模块解析拿到的 `chromium` 是 undefined，
 *   必须用 file:// URL 指向 playwright/index.js 才能拿到真实导出。
 *
 * 查找顺序：
 *   1. 环境变量 PERF_PLAYWRIGHT_PATH（推荐：`file:///C:/.../node_modules/playwright/index.js`）
 *   2. 当前工作目录向上各级的 node_modules/playwright/index.js
 *   3. 裸模块名 'playwright'（项目或全局已安装时）
 */
import { existsSync } from 'node:fs';
import { join, dirname, parse } from 'node:path';
import { pathToFileURL } from 'node:url';

function* ancestors(start) {
  let dir = start;
  const root = parse(dir).root;
  while (true) {
    yield dir;
    if (dir === root) return;
    dir = dirname(dir);
  }
}

/**
 * 把 fixture 打印的 `session=<jwt>` 或裸 `<jwt>` 统一成可传给 addCookies 的 value。
 *
 * perf-fixture.ts 打印的是完整 Cookie 头（带 `session=` 前缀），而 Playwright 的
 * addCookies 需要的是 value 本身。直接把带前缀的串传进去会存成
 * `session=session=<jwt>`，服务端解出无效 token → 所有页面变成未登录的登录页，
 * 指标看起来「很好」（16 个请求、LCP 120ms），其实一页真实数据都没加载。
 */
export function normalizeSessionCookie(raw) {
  if (!raw) return '';
  return raw.startsWith('session=') ? raw.slice('session='.length) : raw;
}

export async function loadChromium() {
  const tried = [];

  const explicit = process.env.PERF_PLAYWRIGHT_PATH;
  if (explicit) {
    tried.push(explicit);
    const pw = await import(explicit).catch(() => null);
    const chromium = pw?.chromium ?? pw?.default?.chromium;
    if (chromium) return chromium;
  }

  for (const dir of ancestors(process.cwd())) {
    const file = join(dir, 'node_modules', 'playwright', 'index.js');
    if (!existsSync(file)) continue;
    const url = pathToFileURL(file).href;
    tried.push(url);
    const pw = await import(url).catch(() => null);
    const chromium = pw?.chromium ?? pw?.default?.chromium;
    if (chromium) return chromium;
  }

  tried.push('playwright');
  const bare = await import('playwright').catch(() => null);
  const chromium = bare?.chromium ?? bare?.default?.chromium;
  if (chromium) return chromium;

  throw new Error(
    '找不到可用的 Playwright。请设置 PERF_PLAYWRIGHT_PATH 指向 playwright/index.js，例如：\n' +
      '  PERF_PLAYWRIGHT_PATH="file:///C:/Users/<you>/AppData/Local/npm-cache/_npx/<hash>/node_modules/playwright/index.js"\n' +
      '已尝试：\n  ' +
      tried.join('\n  ')
  );
}