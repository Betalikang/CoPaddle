import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { Suspense, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import GroupingWorkbenchPage from '@/app/(dashboard)/dashboard/courses/[id]/grouping/page';

/**
 * 分组工作台「移动失败要回滚」的回归测试（优化计划 P0 / 第 8 项测试门禁）。
 *
 * 锁的是修复前那套 moveFlow 的三个缺陷：
 *
 *   1. `post()` 是 `return res.json()` 且调用方用 `res.ok` 判成败——
 *      而 HTTP 400/500 的 `{error}` 被当成正常响应体读出来，`res.ok` 恒为 undefined，
 *      于是「预演被拒」和「落库被拒」都是**静默**的：卡片没动、面板没变、也没有任何提示。
 *      现在非 2xx 一律抛 ApiError，页面必须把 describeApiError 的文案显示出来。
 *   2. 预演成功后立刻 `setLiveScores(previewRes.scores)`——卡片还停在原地，
 *      右侧「四维得分」已经显示移动后的分数。这是 P0 修的核心：
 *      面板只在 apply-move **落库成功**后才更新。
 *   3. 预演通过、落库失败时同样静默。现在要明确告知「移动未落库」，卡片与分数都不动。
 *
 * 这里不打桩 useSWR/页面内部函数，而是打桩 fetch，让真实的
 * swrFetcher → apiFetch、apiSend → ApiError 整条链路跑起来；
 * 断言的是「界面上看到了什么」，不是「组件里调了哪个 setState」。
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : String(href)} {...rest}>
      {children}
    </a>
  )
}));

// 页面用 useRouter 在「选定方案」「解散分组」后跳转；测试环境没有 App Router。
const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn()
  })
}));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, errorRetryCount: 0 }}>
      <Suspense fallback={<div>加载中</div>}>{children}</Suspense>
    </SWRConfig>
  );
}

/**
 * 页面签名 `{ params: Promise<{id}> }` + React 19 的 `use(params)`：
 * promise 必须是同一实例（每次 re-render 新建会让 use() 永远挂起），
 * 且 render 必须包在 `await act(async () => …)` 里才能跑完挂起重试。
 */
const PARAMS = Promise.resolve({ id: '7' });

async function renderWorkbench() {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(<GroupingWorkbenchPage params={PARAMS} />, { wrapper });
  });
  // 骨架 → 真实界面：等第一套候选方案的 Tab 出现
  await screen.findByText('方案 A', {}, { timeout: 5000 });
  return result;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function html(status: number, text: string) {
  return new Response(text, { status, headers: { 'Content-Type': 'text/html' } });
}

/**
 * 方案快照：四维与总分都是 90.0，组内是 101/102 与 103/104。
 * 移动 102 到第 2 组后若界面「显示」了 42.5 之类的新分数，就说明面板提前更新了。
 */
const PLAN = {
  id: 40,
  label: '方案 A',
  strategy: 'skill_first',
  totalScore: '90.0',
  scoreSkillCover: '90.0',
  scoreWeakTie: '90.0',
  scoreBalance: '90.0',
  scoreHistoryAvoid: '90.0',
  groups: [
    [101, 102],
    [103, 104]
  ]
};

const MEMBERS = [
  { userId: 101, name: '张三', studentNo: '2024001', className: '数媒本24-1' },
  { userId: 102, name: '李四', studentNo: '2024002', className: '数媒本24-1' },
  { userId: 103, name: '王五', studentNo: '2024003', className: '数媒本24-2' },
  { userId: 104, name: '赵六', studentNo: '2024004', className: '数媒本24-2' }
];

/** 页面级数据（三个 GET）：角色 / 最近求解 / 已落库小组。 */
function baseRoutes(): Route[] {
  return [
    { match: /^\/api\/courses\/7$/, handler: () => json(200, { myRole: 'teacher' }) },
    {
      match: /^\/api\/courses\/7\/grouping\/latest$/,
      handler: () =>
        json(200, {
          run: { id: 9, status: 'ok', degraded: false },
          plans: [PLAN],
          synthesizedPlanIds: []
        })
    },
    {
      match: /^\/api\/courses\/7\/groups$/,
      handler: () =>
        json(200, {
          groups: [{ id: 501, name: '实践小组', status: 'active', members: MEMBERS }]
        })
    }
  ];
}

type Route = { match: RegExp; handler: (url: string, init: RequestInit) => Response };

/**
 * 按 URL 分流返回真实 Response；未 stub 的请求直接炸掉，避免静默走过默认分支。
 * `overrides` 排在 baseRoutes 前面，所以同名 URL 由用例覆盖。
 */
function stubRoutes(overrides: Route[] = [], extraRoutes: Route[] = []) {
  const routes = [...overrides, ...baseRoutes(), ...extraRoutes];
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const hit = routes.find((r) => r.match.test(url));
    if (!hit) throw new Error(`测试未 stub 的请求：${url}`);
    return hit.handler(url, (init ?? {}) as RequestInit);
  });
}

/** 「点选成员 → 点目标组『移至此处』」，这是页面提供的键盘替代交互路径。 */
async function moveSelectedToGroup2() {
  fireEvent.click(screen.getByRole('button', { name: /^李四 · 2024002/ }));
  const receive = await screen.findByRole('button', { name: '把 李四 移到第 2 组' });
  await act(async () => {
    fireEvent.click(receive);
  });
}

/** 分组卡片的位置快照（aria-label 里带组号与人数）。 */
function tileLabels() {
  return screen
    .getAllByRole('group')
    .map((el) => el.getAttribute('aria-label'))
    .filter((label): label is string => Boolean(label));
}

/**
 * 「硬约束违规（已拒绝）」提示条里的条目文本。
 * 同一条消息在 sr-only 的 role=alert 播报区里也会出现一次，
 * 所以断言必须限定在可见提示条内，用 getByText 会撞到两份。
 */
function visibleViolations(): string[] {
  const title = screen.queryByText('硬约束违规（已拒绝）');
  if (!title) return [];
  const callout = title.parentElement as HTMLElement;
  return within(callout)
    .queryAllByRole('listitem')
    .map((li) => (li.textContent ?? '').replace(/\s+/g, ' ').trim());
}

beforeEach(() => {
  pushMock.mockClear();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('分组工作台：成员资料就绪后再显示分组卡片', () => {
  it('方案先返回、成员资料稍后返回时不渲染 #id 占位卡片', async () => {
    let releaseGroups!: (response: Response) => void;
    const pendingGroups = new Promise<Response>((resolve) => {
      releaseGroups = resolve;
    });
    stubRoutes();
    const baseFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (/^\/api\/courses\/7\/groups$/.test(url)) return pendingGroups;
      return baseFetch(input, init);
    });

    await act(async () => {
      render(<GroupingWorkbenchPage params={PARAMS} />, { wrapper });
    });
    expect(screen.queryByRole('group', { name: /第 1 组/ })).toBeNull();
    expect(screen.queryByText('#101')).toBeNull();

    await act(async () => {
      releaseGroups(
        json(200, {
          groups: [{ id: 501, name: '实践小组', status: 'active', members: MEMBERS }]
        })
      );
    });
    expect(await screen.findByRole('group', { name: '第 1 组，2 人' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^张三 · 2024001/ })).toBeTruthy();
  });

  it('成员资料读取失败时显示独立错误与重试入口，而非匿名占位卡片', async () => {
    stubRoutes([
      {
        match: /^\/api\/courses\/7\/groups$/,
        handler: () => json(503, { error: '小组服务暂不可用' })
      }
    ]);
    await act(async () => {
      render(<GroupingWorkbenchPage params={PARAMS} />, { wrapper });
    });
    expect(await screen.findByText('加载分组成员失败')).toBeTruthy();
    expect(screen.queryByRole('group', { name: /第 1 组/ })).toBeNull();
    expect(screen.getByRole('button', { name: /重试/ })).toBeTruthy();
  });
});

describe('分组工作台：移动失败必须回滚且说话', () => {
  it('预演 400 被拒时显示违规原因，卡片与面板分数都不动', async () => {
    stubRoutes([
      {
        match: /^\/api\/grouping\/plans\/40\/preview-move$/,
        handler: () => json(400, { error: '组内人数不符合约束（至少 2 人）' })
      }
    ]);

    await renderWorkbench();
    expect(tileLabels()).toEqual(['第 1 组，2 人', '第 2 组，2 人']);

    await moveSelectedToGroup2();

    // 修复前：非 2xx 的 {error} 被当成成功体读出来，界面一声不响。
    await waitFor(() => {
      expect(visibleViolations().join('\n')).toContain('组内人数不符合约束');
    });
    // 违规条目带 [PREVIEW] 标记，说明这是「服务拒绝」而不是硬约束 H1/H4/H5
    expect(visibleViolations().join('\n')).toContain('[PREVIEW]');
    // 读屏播报区也要说出「未生效」
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent ?? '').toContain('未生效');
    });

    // 卡片没动（预览失败不算移动）
    expect(tileLabels()).toEqual(['第 1 组，2 人', '第 2 组，2 人']);
    // 面板仍是库内快照的 90.0，不能出现任何「移动后」的分数
    expect(screen.getByText(/综合得分 90\.0/)).toBeTruthy();
    expect(screen.queryByText('上次拖动的影响')).toBeNull();
  });

  it('预演服务异常（500 非 JSON 错误）也要给出可见失败反馈', async () => {
    stubRoutes([
      {
        match: /^\/api\/grouping\/plans\/40\/preview-move$/,
        handler: () => html(500, '<html><body>Internal Server Error</body></html>')
      }
    ]);

    await renderWorkbench();
    await moveSelectedToGroup2();

    // 服务端没给 error 字段时用状态码兜底文案，而不是空白
    await waitFor(() => {
      expect(visibleViolations().join('\n')).toContain('服务暂时不可用（HTTP 500）');
    });
    expect(tileLabels()).toEqual(['第 1 组，2 人', '第 2 组，2 人']);
    expect(screen.getByText(/综合得分 90\.0/)).toBeTruthy();
    expect(screen.queryByText('上次拖动的影响')).toBeNull();
  });

  /**
   * P0 核心：预演成功 ≠ 移动成功。
   * 修复前 preview 一成功就 setLiveScores(previewRes.scores)，
   * 于是「卡片没动，但面板已显示移动后的分数」。apply 失败后界面停在
   * 那个从没生效过的分数上，教师会以为已经调过了。
   */
  it('预演成功但落库失败时：面板不显示预演分数，并明确「移动未落库」', async () => {
    stubRoutes([
      {
        match: /^\/api\/grouping\/plans\/40\/preview-move$/,
        handler: () =>
          json(200, {
            ok: true,
            deltas: { balance: -12.5, total: -47.5 },
            totalBefore: 90,
            totalAfter: 42.5,
            // 预演也会带回「移动后」的分数——页面**不允许**拿它去更新主面板
            scores: {
              skill_cover: 42.5,
              weak_tie: 42.5,
              balance: 42.5,
              history_avoid: 42.5,
              total: 42.5
            }
          })
      },
      {
        match: /^\/api\/grouping\/plans\/40\/apply-move$/,
        handler: () => json(500, { error: '写库失败' })
      }
    ]);

    await renderWorkbench();
    await moveSelectedToGroup2();

    await waitFor(() => {
      expect(visibleViolations().join('\n')).toContain('写库失败（移动未落库）');
    });
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent ?? '').toContain('没有落库');
    });

    // 卡片仍停在原组
    expect(tileLabels()).toEqual(['第 1 组，2 人', '第 2 组，2 人']);
    // 主面板仍是 90.0，且预演的影响面板被清掉（不允许留下「移动后」的 42.5）
    expect(screen.getByText(/综合得分 90\.0/)).toBeTruthy();
    expect(screen.queryByText(/42\.5/)).toBeNull();
  });

  it('预演与落库都成功时才更新卡片与面板（防止测试只会变红）', async () => {
    stubRoutes([
      {
        match: /^\/api\/grouping\/plans\/40\/preview-move$/,
        handler: () =>
          json(200, { ok: true, deltas: {}, totalBefore: 90, totalAfter: 88, scores: null })
      },
      {
        match: /^\/api\/grouping\/plans\/40\/apply-move$/,
        handler: (_url, init) => {
          // 落库请求必须带上这次移动的三个字段（服务端靠它重算分数）
          const body = JSON.parse(String(init.body ?? '{}'));
          expect(body).toEqual({ userId: 102, fromGroup: 0, toGroup: 1 });
          return json(200, {
            ok: true,
            groups: [[101], [102, 103, 104]],
            totalScore: 88,
            scores: {
              skill_cover: 88,
              weak_tie: 88,
              balance: 88,
              history_avoid: 88,
              total: 88
            }
          });
        }
      }
    ]);

    await renderWorkbench();
    await moveSelectedToGroup2();

    await waitFor(() => {
      expect(tileLabels()).toEqual(['第 1 组，1 人', '第 2 组，3 人']);
    });
    expect(screen.getByText(/综合得分 88\.0/)).toBeTruthy();
    // 播报「已移动」而不是「被拒绝」
    expect(screen.getByTestId('grouping-status-live').textContent ?? '').toContain('已移动');
  });
});