/**
 * 截图：七个关键页面 × 桌面(1280) / 手机(375)，存到 .tmp-shots/ 供人工比对。
 *
 * 顺带做两件廉价但有用的检查：
 * - scrollWidth 是否超过视口（横向溢出）；
 * - 收集 console error（401 是未登录时通知接口的正常结果，不计入）。
 *
 * 用法（需要 next start 已在跑）：
 *   node scripts/screenshots.mjs <teacherCookie> <courseId>
 */
import { mkdirSync } from 'node:fs';
import {
  loadChromium,
  normalizeSessionCookie,
  resolveBaseUrl,
  resolveChromePath
} from './lib/playwright.mjs';

const BASE = resolveBaseUrl();
const [, , rawCookie, courseId = '17'] = process.argv;
if (!rawCookie) {
  console.error('用法: node scripts/screenshots.mjs <teacherCookie> <courseId>');
  process.exit(2);
}
const OUT = process.env.SHOT_DIR ?? 'F:/GitHub/CoPaddle/.tmp-shots';
const CHROME = resolveChromePath();

mkdirSync(OUT, { recursive: true });

const PAGES = [
  { name: 'landing', path: '/', auth: false },
  { name: 'login', path: '/sign-in', auth: false },
  { name: 'dashboard', path: '/dashboard', auth: true },
  { name: 'course', path: `/dashboard/courses/${courseId}`, auth: true },
  { name: 'grouping', path: `/dashboard/courses/${courseId}/grouping`, auth: true },
  { name: 'tasks', path: `/dashboard/courses/${courseId}/tasks`, auth: true },
  { name: 'roster', path: `/dashboard/courses/${courseId}/roster`, auth: true }
];

const VIEWPORTS = [
  { tag: 'desk', width: 1280, height: 900 },
  { tag: 'mobile', width: 375, height: 812 }
];

const chromium = await loadChromium();
const browser = await chromium.launch({ executablePath: CHROME });
let failures = 0;

for (const vp of VIEWPORTS) {
  for (const p of PAGES) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2
    });
    if (p.auth) {
      await ctx.addCookies([
        { name: 'session', value: normalizeSessionCookie(rawCookie), url: BASE }
      ]);
    }
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text().slice(0, 120));
    });
    try {
      const res = await page.goto(`${BASE}${p.path}`, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForTimeout(700);
      await page.screenshot({
        path: `${OUT}/${p.name}-${vp.tag}.png`,
        fullPage: vp.tag === 'desk'
      });
      const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
      const realErrors = errors.filter((e) => !e.includes('401'));
      console.log(
        `${p.name}-${vp.tag}: status=${res?.status()} scrollW=${scrollW} consoleErr=${realErrors.length}`
      );
      if (scrollW > vp.width) {
        console.log(`  OVERFLOW ${p.name}-${vp.tag}: ${scrollW} > ${vp.width}`);
        failures++;
      }
    } catch (e) {
      console.log(`  FATAL ${p.name}-${vp.tag}: ${e.message}`);
      failures++;
    }
    await ctx.close();
  }
}

await browser.close();
console.log(failures === 0 ? `SHOTS OK → ${OUT}` : `SHOTS FAILURES=${failures}`);
process.exit(failures === 0 ? 0 : 1);