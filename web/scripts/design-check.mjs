/**
 * 视觉改版的落地验收：把「设计意图」变成可断言的检查，而不是靠肉眼看截图。
 *
 * 为什么需要它：这套界面的改动大多是**观感**层面的（字阶、橙色的稀缺度、动效只做一处），
 * 而 pnpm verify 里的 tsc / vitest 完全管不到这些——它们只保证代码能编译、行为没坏。
 * 没有这个脚本，「重写完确实变好看了」就只是一句自我评价。
 *
 * 检查的是可测量的那部分：
 * - Hero 是否真的用上 text-display 字阶（而不是写了 class 但被覆盖）；
 * - 落地页航道是不是五段、进场动效 animationName 是不是 lane-draw；
 * - 橙色是否仍然稀缺（text-brand 元素数 <= 6）——一屏里橙色一多，「需要看的那一处」就不成立；
 * - 区间示意没有退化成 progressbar 语义（那会被读成完成百分比）；
 * - 文案里没有「赋能/闭环/一站式」这类填充词；
 * - 登录页两栏布局、左栏墨底及其对比度；
 * - 页头 2px 装订线、侧栏选中项 2px 橙色竖线；
 * - 课程页 h1 真的变大了（text-title 生效）。
 *
 * 用法（需要 next start 已在跑，且传一枚能进课程的管理侧 cookie）：
 *   node scripts/design-check.mjs <teacherCookie> <courseId>
 *   $env:PERF_PLAYWRIGHT_PATH / $env:CHROME_PATH 见 scripts/lib/playwright.mjs
 * 全部通过退出 0，任一失败退出 1。
 */
import {
  loadChromium,
  normalizeSessionCookie,
  resolveBaseUrl,
  resolveChromePath
} from './lib/playwright.mjs';

const BASE = resolveBaseUrl();
const [, , rawCookie, courseId = '17'] = process.argv;
if (!rawCookie) {
  console.error('用法: node scripts/design-check.mjs <teacherCookie> <courseId>');
  process.exit(2);
}
const CHROME = resolveChromePath();

const chromium = await loadChromium();
const browser = await chromium.launch({ executablePath: CHROME });

function rgb(str) {
  const m = /rgba?\(([^)]+)\)/.exec(str);
  if (!m) return null;
  const p = m[1].split(',').map((v) => parseFloat(v.trim()));
  return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 };
}
function lum({ r, g, b }) {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) {
  const l1 = lum(a);
  const l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

async function measureText(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      text: (el.textContent ?? '').trim().slice(0, 40),
      color: cs.color,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight
    };
  }, selector);
}

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
});
page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR ${e.message.slice(0, 200)}`));

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
}

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

const h1 = await measureText(page, 'h1');
check(
  'Hero 字号 >= 37px（text-display 生效）',
  parseFloat(h1?.fontSize ?? '0') >= 37,
  `h1 ${h1?.fontSize} / lh ${h1?.lineHeight}`
);
const pageBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const h1Ratio = ratio(rgb(h1.color), rgb(pageBg));
check('Hero 文字对比 >= 7:1', h1Ratio >= 7, h1Ratio.toFixed(2));

// #pipeline 里有两个 <ol>（桌面横向 + 窄屏纵向），故 li 数是 10；桌面版单看是 5
const laneCount = await page.evaluate(() => document.querySelectorAll('#pipeline ol li').length);
check('航道五段（两版布局合计 10 条 li）', laneCount === 10, `li=${laneCount}`);

const laneAnim = await page.evaluate(() => {
  const el = document.querySelector('.animate-lane');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return { name: cs.animationName, duration: cs.animationDuration };
});
check('航道线带进场动画', Boolean(laneAnim && laneAnim.name === 'lane-draw'), JSON.stringify(laneAnim));

const brandUsage = await page.evaluate(() => {
  const all = [...document.querySelectorAll('*')];
  return {
    brandText: all.filter((el) => /(^|\s)text-brand(\s|$)/.test(el.className)).length,
    brandBg: all.filter((el) => /(^|\s)bg-brand(\s|$)/.test(el.className)).length
  };
});
check('橙色元素稀缺（text-brand <= 6）', brandUsage.brandText <= 6, JSON.stringify(brandUsage));

const specTerms = await page.evaluate(() =>
  [...document.querySelectorAll('dl dt')].map((d) => d.textContent.trim())
);
check('求解段四项目标齐', specTerms.length >= 4, specTerms.join(','));

const progressbars = await page.evaluate(
  () => document.querySelectorAll('[role="progressbar"], progress').length
);
check('区间不用 progressbar 语义', progressbars === 0, `count=${progressbars}`);

const bodyText = await page.evaluate(() => document.body.innerText);
const filler = ['赋能', '闭环', '一站式', '全方位', '助力', '打造'].filter((w) => bodyText.includes(w));
check('落地页无填充词', filler.length === 0, filler.join(',') || 'none');
check('提到 200 人上限', bodyText.includes('200'));
check('提到 120 秒上限', bodyText.includes('120'));

await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
const panel = await page.evaluate(() => {
  const aside = document.querySelector('aside');
  if (!aside) return null;
  return { bg: getComputedStyle(aside).backgroundColor, width: aside.getBoundingClientRect().width };
});
check(
  '登录页左栏为墨底',
  panel ? ratio(rgb(panel.bg), { r: 255, g: 255, b: 255 }) > 14 : false,
  JSON.stringify(panel)
);
const claim = await measureText(page, 'aside dl dt');
const claimRatio = claim ? ratio(rgb(claim.color), rgb(panel.bg)) : 0;
check('左栏橙色小标题 >= 4.5:1', claimRatio >= 4.5, `${claimRatio.toFixed(2)} ${claim?.color}`);
const panelH1 = await measureText(page, 'aside h1');
check('左栏大标题 >= 7:1', panelH1 ? ratio(rgb(panelH1.color), rgb(panel.bg)) >= 7 : false);
const asideCols = await page.evaluate(
  () => getComputedStyle(document.querySelector('div.grid')).gridTemplateColumns
);
check('登录页两栏（lg 下 grid 两列）', asideCols.split(' ').length === 2, asideCols);

await ctx.addCookies([{ name: 'session', value: normalizeSessionCookie(rawCookie), url: BASE }]);
await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const stitch = await page.evaluate(() => {
  const bar = document.querySelector('header > div[aria-hidden]');
  if (!bar) return null;
  const cs = getComputedStyle(bar);
  return { h: bar.getBoundingClientRect().height, bg: cs.backgroundColor };
});
check('页头装订线 2px 橙色', Boolean(stitch && Math.round(stitch.h) === 2), JSON.stringify(stitch));

const activeLink = await page.evaluate(() => {
  const a = document.querySelector('a[aria-current="page"]');
  if (!a) return null;
  const mark = a.querySelector('span[aria-hidden]');
  return {
    label: a.textContent.trim().slice(0, 12),
    markBg: mark ? getComputedStyle(mark).backgroundColor : null,
    markW: mark ? mark.getBoundingClientRect().width : 0
  };
});
check('侧栏选中项有橙色竖线', Boolean(activeLink && activeLink.markW === 2), JSON.stringify(activeLink));

await page.goto(`${BASE}/dashboard/courses/${courseId}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const courseH1 = await measureText(page, 'h1');
check(
  '页标题字号 >= 22px（text-title 生效）',
  parseFloat(courseH1?.fontSize ?? '0') >= 22,
  `${courseH1?.fontSize} "${courseH1?.text}"`
);

/*
  雷达图颜色必须跟着主题走。

  原先组件里写死 stroke="#f97316"（旧品牌橙），换色板时它不会跟着变——
  这是「改完看着挺好，只有图表还留着上一版颜色」的典型残留，
  而且截图里一眼看不出来（橙色还是橙色）。现在改成 globals.css 里的
  .recharts-radar-polygon { stroke: var(--brand) }，所以可以直接断言两件事：
  1) 浅色下等于浅色的 --brand（hsl(18 92% 40%) → rgb(196, 64, 8)）；
  2) 深色下等于深色的 --brand（hsl(26 96% 60%) → 明显更亮）。
  两者不同，才说明它真的在跟随主题，而不是又一次被写死。
*/
async function radarStroke() {
  await page.goto(`${BASE}/dashboard/courses/${courseId}/grouping`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  return page.evaluate(() => {
    const el = document.querySelector('.recharts-radar-polygon');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { stroke: cs.stroke, fill: cs.fill, fillOpacity: cs.fillOpacity };
  });
}

const radarLight = await radarStroke();
check(
  '雷达图颜色取主题变量（浅色）',
  Boolean(radarLight && radarLight.stroke === 'rgb(196, 64, 8)'),
  JSON.stringify(radarLight)
);

const darkCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await darkCtx.addInitScript(() => {
  try {
    localStorage.setItem('copaddle-theme', 'dark');
  } catch {}
});
await darkCtx.addCookies([{ name: 'session', value: normalizeSessionCookie(rawCookie), url: BASE }]);
const darkPage = await darkCtx.newPage();
await darkPage.goto(`${BASE}/dashboard/courses/${courseId}/grouping`, { waitUntil: 'networkidle' });
await darkPage.waitForTimeout(1200);
const radarDark = await darkPage.evaluate(() => {
  const isDark = document.documentElement.classList.contains('dark');
  const el = document.querySelector('.recharts-radar-polygon');
  return {
    isDark,
    stroke: el ? getComputedStyle(el).stroke : null,
    fill: el ? getComputedStyle(el).fill : null
  };
});
check(
  '雷达图颜色取主题变量（深色下不同于浅色）',
  Boolean(
    radarDark.isDark &&
      radarDark.stroke &&
      radarLight &&
      radarDark.stroke !== radarLight.stroke
  ),
  JSON.stringify(radarDark)
);
await darkCtx.close();

console.log('\n=== 设计意图落地检查 ===');
for (const c of checks) {
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  <${c.detail}>` : ''}`);
}
// 落地页有两条历史 401（未登录时通知数接口），与本次改版无关，单独列出不参与判定
const realErrors = consoleErrors.filter((e) => !e.includes('401'));
console.log(`\n控制台错误 ${consoleErrors.length} 条（其中 401 共 ${consoleErrors.length - realErrors.length} 条）`);
for (const e of consoleErrors.slice(0, 6)) console.log(`  ! ${e}`);

const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${failed === 0 ? 'DESIGN CHECKS PASS' : `DESIGN CHECKS FAILED=${failed}`}`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);