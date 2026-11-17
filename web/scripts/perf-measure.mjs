/**
 * 性能与移动端实测脚本（对应 docs/性能基线-实测.md）。
 *
 * 前置：生产构建已 `next build` 并 `next start -p 3000` 运行，数据库指向隔离库，
 * 数据由 `npx tsx scripts/perf-fixture.ts` 造（24 组 / 216 任务）。
 *
 * 用法：
 *   node scripts/perf-measure.mjs <courseId> <teacherCookie> <captainCookie>
 *
 * 输出：每页 × 375/1280 的 LCP、CLS、longtask、请求数、JS/CSS/文档传输字节、横向溢出；
 * 以及任务页「选组前 / 选组后」的 reactflow 按需加载差值。
 */
const [, , courseId, rawTeacherCookie, rawCaptainCookie] = process.argv;
const BASE = resolveBaseUrl();

if (!courseId || !rawTeacherCookie) {
  console.error('用法: node scripts/perf-measure.mjs <courseId> <teacherCookie> [captainCookie]');
  process.exit(2);
}

// fixture 打印的是 `session=<jwt>`，Playwright addCookies 要的是 value 本身
const teacherCookie = normalizeSessionCookie(rawTeacherCookie);
const captainCookie = normalizeSessionCookie(rawCaptainCookie);

const PAGES = [
  ['课程工作台', '/dashboard'],
  ['课程首页', `/dashboard/courses/${courseId}`],
  ['分组工作台', `/dashboard/courses/${courseId}/grouping`],
  ['学生名单', `/dashboard/courses/${courseId}/roster`],
  ['任务与依赖', `/dashboard/courses/${courseId}/tasks`],
  ['成绩导出', `/dashboard/courses/${courseId}/grades`],
  ['账号设置', '/dashboard/general'],
  ['登录页', '/sign-in', null]
];

const VITALS = `(() => new Promise((resolve) => {
  const out = { lcp: 0, cls: 0, longTasks: 0, longMs: 0, requests: 0, jsKB: 0, cssKB: 0, docKB: 0, overflow: 0, errs: [] };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) out.lcp = Math.max(out.lcp, e.startTime); }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) out.cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { out.longTasks += 1; out.longMs += e.duration; } }).observe({ type: 'longtask', buffered: true }); } catch {}
  setTimeout(() => {
    const rs = performance.getEntriesByType('resource');
    out.requests = rs.length;
    let js = 0, css = 0;
    for (const r of rs) {
      const s = r.encodedBodySize || r.transferSize || 0;
      if (/\\.js(\\?|$)/.test(r.name) || r.name.includes('/_next/static/chunks/')) js += s;
      else if (/\\.css(\\?|$)/.test(r.name) || r.name.includes('/_next/static/css/')) css += s;
    }
    const nav = performance.getEntriesByType('navigation')[0];
    out.jsKB = +(js / 1024).toFixed(1);
    out.cssKB = +(css / 1024).toFixed(1);
    out.docKB = nav ? +((nav.encodedBodySize || nav.transferSize || 0) / 1024).toFixed(1) : 0;
    out.cls = +out.cls.toFixed(4);
    out.lcp = Math.round(out.lcp);
    out.longMs = Math.round(out.longMs);
    out.overflow = Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
    resolve(out);
  }, 2000);
}))()`;

/** 任务页 DAG 快照：reactflow 只在 DAG 真正渲染时下载。 */
const FLOW_SNAP = `(() => {
  const rs = performance.getEntriesByType('resource');
  let js = 0, flow = 0;
  for (const r of rs) {
    const s = r.encodedBodySize || r.transferSize || 0;
    if (/\\.js(\\?|$)/.test(r.name) || r.name.includes('/_next/static/chunks/')) js += s;
    if (/4ad41dfc6a7cd604|34f7a480985f790d/.test(r.name)) flow += 1;
  }
  return { requests: rs.length, jsKB: +(js / 1024).toFixed(1), flowAssets: flow, dag: !!document.querySelector('.react-flow') };
})()`;

/**
 * 解析 Playwright：项目没装 playwright 依赖（不为一个验收脚本引入重依赖），
 * 详见 scripts/lib/playwright.mjs 的查找顺序与 Windows 中文路径注意事项。
 */
import { loadChromium, normalizeSessionCookie, resolveBaseUrl } from './lib/playwright.mjs';

async function main() {
  const chromium = await loadChromium();
  // 优先用 CHROME_PATH 指定的浏览器；没给就退回本机已装的 Chrome 通道
  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : { channel: process.env.PERF_CHANNEL || 'chrome' }),
    headless: true
  });

  // 先确认 cookie 真的能登录：否则每页都测成「登录页」，指标会好得离谱却毫无意义
  {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: 'session', value: teacherCookie, domain: new URL(BASE).hostname, path: '/' }]);
    const probe = await ctx.newPage();
    const res = await probe.goto(`${BASE}/api/user`, { timeout: 60000 }).catch(() => null);
    const status = res?.status() ?? 0;
    await ctx.close();
    if (status !== 200) {
      console.error(
        `FATAL cookie 未能登录（GET /api/user → ${status || '未响应'}）。\n` +
          '  指标会全部退化成登录页，先修 cookie 再测：\n' +
          '  1) perf-fixture.ts 与服务端必须使用同一个 AUTH_SECRET；\n' +
          '  2) 传参传 fixture 打印的 `session=...` 或裸 JWT 均可（脚本会自动去前缀）。'
      );
      await browser.close();
      process.exit(2);
    }
  }

  console.log('=== 页面指标 ===');
  console.log(['page', 'vp', 'LCP', 'CLS', 'longTasks', 'longMs', '请求数', 'JS_KB', 'CSS_KB', '文档_KB', 'overflow'].join('\t'));
  for (const vp of [{ w: 375, h: 812, mobile: true }, { w: 1280, h: 900, mobile: false }]) {
    for (const [name, path, cookieOverride] of PAGES) {
      const cookie = cookieOverride === null ? null : teacherCookie;
      const ctx = await browser.newContext({
        viewport: { width: vp.w, height: vp.h },
        isMobile: vp.mobile,
        hasTouch: vp.mobile
      });
      if (cookie) {
        await ctx.addCookies([{ name: 'session', value: cookie, domain: new URL(BASE).hostname, path: '/' }]);
      }
      const page = await ctx.newPage();
      await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => null);
      const v = await page.evaluate(VITALS).catch(() => null);
      console.log(
        v
          ? [name, vp.w, v.lcp, v.cls, v.longTasks, v.longMs, v.requests, v.jsKB, v.cssKB, v.docKB, v.overflow].join('\t')
          : [name, vp.w, 'ERR'].join('\t')
      );
      await ctx.close();
    }
  }

  console.log('\n=== reactflow 按需加载（任务页，教师视角）===');
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addCookies([{ name: 'session', value: teacherCookie, domain: new URL(BASE).hostname, path: '/' }]);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/dashboard/courses/${courseId}/tasks`, { waitUntil: 'networkidle', timeout: 90000 });
    await page.waitForTimeout(1500);
    const before = await page.evaluate(FLOW_SNAP);
    // 教师默认不选组：先在「选择小组」面板里点一个组，DAG 才出现
    await page
      .getByRole('button', { name: /组/ })
      .first()
      .click({ timeout: 15000 })
      .catch(() => null);
    await page.waitForTimeout(3500);
    const after = await page.evaluate(FLOW_SNAP);
    console.log('阶段\t请求数\tJS_KB\treactflow资源\tDAG渲染');
    console.log(['选组前', before.requests, before.jsKB, before.flowAssets, before.dag].join('\t'));
    console.log(['选组后', after.requests, after.jsKB, after.flowAssets, after.dag].join('\t'));
    await ctx.close();
  }

  await browser.close();
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});