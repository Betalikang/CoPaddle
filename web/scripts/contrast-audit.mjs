/**
 * 全站文字对比度审计（WCAG AA）：浅色与深色两套主题、八个关键页面。
 *
 * 为什么不能只看 globals.css 里的 token 数值：
 * 1. 半透明底会骗人。`bg-brand-soft/40`、`text-white/65` 这类写法在源码里看不出最终对比，
 *    必须把祖先链上的多层半透明背景逐层合成，才能得到「这段文字实际压在什么上面」。
 * 2. 深色主题会翻转。浅色下 4.8:1 的橙，在深色下用的是另一个 token（提亮到 60% 那支），
 *    只验一边等于没验。
 * 3. 真正的失败往往不在 token 上，而在某处 `text-muted-foreground` 压在了 `bg-muted` 上。
 *
 * 用法（需要 next start 已在跑）：
 *   node scripts/contrast-audit.mjs <teacherCookie> <courseId>
 * 全部达标退出 0，否则退出 1 并列出是哪段文字、什么颜色、压在哪。
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
  console.error('用法: node scripts/contrast-audit.mjs <teacherCookie> <courseId>');
  process.exit(2);
}
const CHROME = resolveChromePath();

const chromium = await loadChromium();
const browser = await chromium.launch({ executablePath: CHROME });

function parse(str) {
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
function flatten(fg, bg) {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1
  };
}

const SCAN = `(() => {
  function parse(str) {
    const m = /rgba?\\(([^)]+)\\)/.exec(str);
    if (!m) return null;
    const p = m[1].split(',').map((v) => parseFloat(v.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 };
  }
  function effectiveBg(el) {
    const stack = [];
    let cur = el;
    while (cur) {
      const c = parse(getComputedStyle(cur).backgroundColor);
      if (c && c.a > 0) {
        stack.push(c);
        if (c.a > 0.99) break;
      }
      cur = cur.parentElement;
    }
    if (!stack.length) return { r: 255, g: 255, b: 255, a: 1 };
    let base = stack[stack.length - 1].a > 0.99 ? stack[stack.length - 1] : { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 2; i >= 0; i--) {
      const c = stack[i];
      base = {
        r: c.r * c.a + base.r * (1 - c.a),
        g: c.g * c.a + base.g * (1 - c.a),
        b: c.b * c.a + base.b * (1 - c.a),
        a: 1
      };
    }
    return base;
  }
  const out = [];
  const seen = new Set();
  let scanned = 0;
  for (const el of document.querySelectorAll('body *')) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    if (!own) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.1) continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    scanned++;
    const bg = effectiveBg(el);
    // 去重键只按「文字色 + 实际底色 + 字号 + 字重」：
    // 同一组合重复几十次时，对比度结论完全一样，没必要重复算；
    // 但元素总数要单独统计，否则「抽样 10 处」会被误读成整页只有 10 段文字。
    const key = cs.color + '|' + JSON.stringify(bg) + '|' + cs.fontSize + '|' + cs.fontWeight;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      text: el.textContent.trim().slice(0, 24),
      fg,
      bg,
      fontSize: parseFloat(cs.fontSize),
      fontWeight: cs.fontWeight,
      tag: el.tagName.toLowerCase()
    });
  }
  return { items: out, scanned };
})()`;

const PAGES = [
  { name: '落地页', path: '/', auth: false },
  { name: '登录页', path: '/sign-in', auth: false },
  { name: '课程工作台', path: '/dashboard', auth: true },
  { name: '课程首页', path: `/dashboard/courses/${courseId}`, auth: true },
  { name: '分组工作台', path: `/dashboard/courses/${courseId}/grouping`, auth: true },
  { name: '任务页', path: `/dashboard/courses/${courseId}/tasks`, auth: true },
  { name: '名单页', path: `/dashboard/courses/${courseId}/roster`, auth: true },
  { name: '账号设置', path: '/dashboard/general', auth: true }
];

let totalBad = 0;

for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  if (theme === 'dark') {
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('copaddle-theme', 'dark');
      } catch {}
    });
  }
  await ctx.addCookies([{ name: 'session', value: normalizeSessionCookie(rawCookie), url: BASE }]);
  const page = await ctx.newPage();

  for (const p of PAGES) {
    await page.goto(`${BASE}${p.path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    if (theme === 'dark') {
      const actualDark = await page.evaluate(() =>
        document.documentElement.classList.contains('dark')
      );
      if (!actualDark) console.log(`!! ${p.name} 深色类未生效，本轮深色结论不可信`);
    }
    const { items, scanned } = await page.evaluate(SCAN);
    const bad = [];
    for (const it of items) {
      const fg = it.fg.a < 1 ? flatten(it.fg, it.bg) : it.fg;
      const r = ratio(fg, it.bg);
      const large = it.fontSize >= 24 || (it.fontSize >= 18.66 && Number(it.fontWeight) >= 700);
      const need = large ? 3 : 4.5;
      if (r < need) {
        bad.push({
          text: it.text,
          r: Number(r.toFixed(2)),
          need,
          fontSize: it.fontSize,
          color: `rgb(${Math.round(it.fg.r)},${Math.round(it.fg.g)},${Math.round(it.fg.b)})`,
          bg: `rgb(${Math.round(it.bg.r)},${Math.round(it.bg.g)},${Math.round(it.bg.b)})`,
          tag: it.tag
        });
      }
    }
    const label = `${theme === 'dark' ? '深色' : '浅色'} / ${p.name}`;
    console.log(
      `--- ${label}：扫描 ${scanned} 段文字（去重后 ${items.length} 种配色组合），不合格 ${bad.length} 处`
    );
    for (const b of bad.slice(0, 8)) {
      console.log(`  FAIL ${b.r}:1 (需 ${b.need}) ${b.fontSize}px <${b.tag}> "${b.text}"  ${b.color} on ${b.bg}`);
    }
    totalBad += bad.length;
  }
  await ctx.close();
}

await browser.close();
console.log(
  `\n${totalBad === 0 ? 'CONTRAST PASS（两种主题全部达到 WCAG AA）' : `CONTRAST FAILED total=${totalBad}`}`
);
process.exit(totalBad === 0 ? 0 : 1);