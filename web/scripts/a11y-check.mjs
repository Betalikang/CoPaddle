/**
 * 移动端与无障碍验收脚本（对应 docs/性能基线-实测.md 第 4 节，计划第 30 行第 6 项）。
 *
 * 覆盖：
 *   1. 全 dashboard 路由的 375px 巡检：HTTP 状态、横向溢出、过小热区、过小字号、console error
 *   2. 移动抽屉：触发 → 焦点移入 → Tab 不逃出 → Esc 关闭 → 焦点回到触发按钮 → 抽屉内跳转并收起
 *   3. 桌面键盘：Tab 可达侧栏导航
 *   4. 分组台：点选成员后 aria-pressed 与常驻 live region 文本都更新
 *   5. 队长任务页：375px 无溢出、DAG 渲染、清单/看板切换后仍无溢出
 *
 * 前置：生产构建已 next start -p 3000，数据由 scripts/perf-fixture.ts 造。
 * 用法：node scripts/a11y-check.mjs <courseId> <teacherCookie> <captainCookie>
 * 退出码：0 = 全部 PASS，1 = 有 FAIL（可直接进 CI）。
 */
import { loadChromium, normalizeSessionCookie, resolveBaseUrl } from './lib/playwright.mjs';

const [, , courseId, rawTeacherCookie, rawCaptainCookie] = process.argv;
const BASE = resolveBaseUrl();

if (!courseId || !rawTeacherCookie || !rawCaptainCookie) {
  console.error('用法: node scripts/a11y-check.mjs <courseId> <teacherCookie> <captainCookie>');
  process.exit(2);
}

// fixture 打印 `session=<jwt>`，Playwright addCookies 要 value 本身
const teacherCookie = normalizeSessionCookie(rawTeacherCookie);
const captainCookie = normalizeSessionCookie(rawCaptainCookie);

const HOST = new URL(BASE).hostname;
const results = [];
function log(name, pass, detail) {
  results.push({ name, pass });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
}

const ROUTES = [
  ['课程工作台', '/dashboard'],
  ['活动流', '/dashboard/activity'],
  ['审计日志', '/dashboard/audit'],
  ['新建课程', '/dashboard/courses/new'],
  ['课程首页', `/dashboard/courses/${courseId}`],
  ['预警', `/dashboard/courses/${courseId}/alerts`],
  ['成果物', `/dashboard/courses/${courseId}/artifacts`],
  ['冲突', `/dashboard/courses/${courseId}/conflicts`],
  ['贡献度', `/dashboard/courses/${courseId}/contributions`],
  ['成绩导出', `/dashboard/courses/${courseId}/grades`],
  ['分组工作台', `/dashboard/courses/${courseId}/grouping`],
  ['重规划', `/dashboard/courses/${courseId}/replans`],
  ['互评轮次', `/dashboard/courses/${courseId}/reviews`],
  ['我的互评', `/dashboard/courses/${courseId}/reviews/mine`],
  ['学生名单', `/dashboard/courses/${courseId}/roster`],
  ['课程设置', `/dashboard/courses/${courseId}/settings`],
  ['技能卡', `/dashboard/courses/${courseId}/skill-card`],
  ['任务与依赖', `/dashboard/courses/${courseId}/tasks`],
  ['我的任务', '/dashboard/my-tasks'],
  ['通知', '/dashboard/notifications'],
  ['安全', '/dashboard/security'],
  ['账号设置', '/dashboard/general']
];

const AUDIT = `(() => {
  const de = document.documentElement;
  const out = { scrollW: de.scrollWidth, innerW: window.innerWidth, smallTaps: [], smallFonts: [], wide: [] };
  for (const el of document.querySelectorAll('a, button, input[type=checkbox], input[type=radio], [role=button]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    // label 包裹的 checkbox 由 label 提供大热区，不是问题
    const inLabel = el.closest('label');
    if (r.height < 24 && !inLabel) {
      out.smallTaps.push(el.tagName + (el.className ? '.' + String(el.className).slice(0, 30) : '') + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
      if (out.smallTaps.length >= 4) break;
    }
  }
  for (const el of document.querySelectorAll('body *')) {
    if (!el.childElementCount) {
      const t = (el.textContent || '').trim();
      if (!t) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs > 0 && fs < 11.5) {
        out.smallFonts.push(el.tagName + ' ' + fs.toFixed(1) + 'px "' + t.slice(0, 18) + '"');
        if (out.smallFonts.length >= 4) break;
      }
    }
  }
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && Math.round(r.right) > 376) {
      out.wide.push(el.tagName + ' right=' + Math.round(r.right));
      if (out.wide.length >= 3) break;
    }
  }
  return out;
})()`;

async function main() {
  const chromium = await loadChromium();
  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : { channel: process.env.PERF_CHANNEL || 'chrome' }),
    headless: true
  });

  // cookie 无效时每页都会落到登录页：巡检会全部「PASS」却什么也没验，所以先确认登录态
  {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: 'session', value: teacherCookie, domain: HOST, path: '/' }]);
    const probePage = await ctx.newPage();
    const res = await probePage.goto(`${BASE}/api/user`, { timeout: 60000 }).catch(() => null);
    const status = res?.status() ?? 0;
    await ctx.close();
    if (status !== 200) {
      console.error(
        `FATAL cookie 未能登录（GET /api/user → ${status || '未响应'}）。\n` +
          '  巡检会把登录页当通过，先确认 perf-fixture.ts 与服务端使用同一个 AUTH_SECRET。'
      );
      await browser.close();
      process.exit(2);
    }
  }

  /* ---------- 1. 全路由 375px 巡检 ---------- */
  const problems = [];
  for (const [name, path] of ROUTES) {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
    await ctx.addCookies([{ name: 'session', value: teacherCookie, domain: HOST, path: '/' }]);
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errs.push(m.text().slice(0, 160));
    });
    const resp = await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => null);
    await page.waitForTimeout(700);
    const a = await page.evaluate(AUDIT).catch(() => ({}));
    const status = resp ? resp.status() : -1;
    if (status !== 200) problems.push(`[${name}] HTTP ${status}`);
    if ((a.scrollW ?? 0) > 376) problems.push(`[${name}] 横向溢出 scrollW=${a.scrollW}`);
    if ((a.smallTaps || []).length) problems.push(`[${name}] 热区 <24px: ${a.smallTaps.slice(0, 3).join(' ; ')}`);
    if ((a.smallFonts || []).length) problems.push(`[${name}] 字号 <11.5px: ${a.smallFonts.slice(0, 3).join(' ; ')}`);
    if (errs.length) problems.push(`[${name}] console error: ${errs[0]}`);
    await ctx.close();
  }
  log(
    `${ROUTES.length} 条路由 375px 巡检无溢出/无过小热区/无过小字号/无 console error`,
    problems.length === 0,
    problems.length ? problems.join(' | ') : ''
  );

  const mk = async (path, cookie) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
    await ctx.addCookies([{ name: 'session', value: cookie, domain: HOST, path: '/' }]);
    const page = await ctx.newPage();
    await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 60000 });
    return { ctx, page };
  };

  /* ---------- 2. 移动抽屉 ---------- */
  {
    const { ctx, page } = await mk(`/dashboard/courses/${courseId}`, teacherCookie);
    const trigger = page.getByRole('button', { name: '打开导航菜单' });
    log('抽屉触发按钮存在且可见', (await trigger.count()) === 1 && (await trigger.isVisible()));

    await trigger.click();
    await page.waitForTimeout(400);
    const dialogCount = await page.getByRole('dialog').count();
    log('点击后出现 role=dialog 抽屉', dialogCount === 1);

    if (dialogCount === 1) {
      const focusInDialog = await page.evaluate(() => {
        const d = document.querySelector('[role="dialog"]');
        return !!d && !!document.activeElement && d.contains(document.activeElement);
      });
      log('焦点移入抽屉面板', focusInDialog);

      let stayed = true;
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Tab');
        const inside = await page.evaluate(() => {
          const d = document.querySelector('[role="dialog"]');
          return !!d && !!document.activeElement && d.contains(document.activeElement);
        });
        if (!inside) {
          stayed = false;
          break;
        }
      }
      log('Tab 12 次焦点不逃出抽屉（焦点陷阱）', stayed);

      const hasOverlay = await page.evaluate(() => {
        const main = document.querySelector('main');
        return {
          overlay:
            !!document.querySelector('[data-slot="sheet-overlay"]') ||
            !!document.querySelector('[data-radix-dialog-overlay]'),
          mainHidden: main ? main.getAttribute('aria-hidden') === 'true' || !!main.closest('[aria-hidden="true"]') : null
        };
      });
      log('抽屉有遮罩且背景内容对读屏隐藏', hasOverlay.overlay && hasOverlay.mainHidden === true, JSON.stringify(hasOverlay));

      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      log('Esc 可关闭抽屉', (await page.getByRole('dialog').count()) === 0);
      const focusBack = await page.evaluate(() => {
        const el = document.activeElement;
        return el ? (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 20) : '';
      });
      log('关闭后焦点回到触发按钮', focusBack === '打开导航菜单', `activeElement="${focusBack}"`);

      await trigger.click();
      await page.waitForTimeout(400);
      // 用精确名称定位：抽屉里课程名本身也可能含「任务」二字，正则匹配会点到课程首页链接
      const navLink = page.getByRole('dialog').getByRole('link', { name: '任务与契约', exact: true }).first();
      if (await navLink.count()) {
        await navLink.click();
        await page.waitForTimeout(1500);
        const url = page.url().replace(BASE, '');
        log('抽屉内导航可跳转且抽屉自动收起', url.includes('/tasks') && (await page.getByRole('dialog').count()) === 0, url);
      } else {
        log('抽屉内能找到「任务与契约」导航链接', false);
      }
    }
    await ctx.close();
  }

  /* ---------- 3. 桌面键盘可达侧栏 ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addCookies([{ name: 'session', value: teacherCookie, domain: HOST, path: '/' }]);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle', timeout: 60000 });
    let reached = false;
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      const label = await page.evaluate(() => {
        const el = document.activeElement;
        return el ? (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24) : '';
      });
      if (/课程工作台|所有课程|导航/.test(label)) {
        reached = true;
        break;
      }
    }
    log('桌面键盘 Tab 可达侧栏导航项', reached);
    await ctx.close();
  }

  /* ---------- 4. 分组台：点选成员的可感知反馈 ---------- */
  {
    const { ctx, page } = await mk(`/dashboard/courses/${courseId}/grouping`, teacherCookie);
    const live = page.locator('[data-testid="grouping-status-live"]');
    log('分组播报区常驻存在', (await live.count()) === 1);
    const liveInitial = (await live.textContent().catch(() => '')) ?? '';

    const pressedBtns = page.locator('button[aria-pressed]');
    const n = await pressedBtns.count();
    log('存在带 aria-pressed 的可点选元素', n > 0, `count=${n}`);
    if (n > 0) {
      await pressedBtns.first().click();
      await page.waitForTimeout(400);
      const liveAfter = (await live.textContent().catch(() => '')) ?? '';
      const pressedNow = await page.evaluate(
        () => Array.from(document.querySelectorAll('button[aria-pressed]')).filter((b) => b.getAttribute('aria-pressed') === 'true').length
      );
      log('点选后 aria-pressed=true 的元素数 > 0', pressedNow > 0, `count=${pressedNow}`);
      log(
        '播报区文本随点选更新（读屏可感知）',
        liveAfter !== liveInitial && liveAfter.length > 0,
        `"${liveInitial.slice(0, 20)}" → "${liveAfter.slice(0, 40)}"`
      );
    }
    await ctx.close();
  }

  /* ---------- 5. 队长任务页 375px ---------- */
  {
    const { ctx, page } = await mk(`/dashboard/courses/${courseId}/tasks`, captainCookie);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    log('队长任务页 375px 无横向溢出', overflow <= 1, `overflow=${overflow}`);
    const hasFlow = await page.evaluate(() => !!document.querySelector('.react-flow'));
    log('队长任务页 DAG 已渲染', hasFlow);
    const board = page.getByRole('button', { name: '看板' });
    if (await board.count()) {
      await board.first().click();
      await page.waitForTimeout(900);
      const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      log('看板视图 375px 无横向溢出', overflow2 <= 1, `overflow=${overflow2}`);
    } else {
      log('找到清单/看板切换', false);
    }
    await ctx.close();
  }

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== 合计 ${results.length} 项，失败 ${failed.length} 项 ===`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});