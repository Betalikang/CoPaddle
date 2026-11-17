import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { Suspense, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import GroupTasksPage from '@/app/(dashboard)/dashboard/courses/[id]/tasks/page';

/**
 * AI 拆解网络异常的回归测试（优化计划 P1-5 / 第 8 项测试门禁）。
 *
 * 锁的是修复前 `generate()` 的三个缺陷：
 *
 *   1. 整个函数没有 try/catch。`fetch` 直接 reject（断网、DNS、超时）时异常逃出
 *      事件处理器，`setGenerating(false)` 永远不执行——按钮永久停在
 *      「AI 拆解中（最长约 2 分钟）…」且 disabled，用户只能刷新页面。
 *   2. 没有任何错误提示。`genError` 只在 `!res.ok` 分支里赋值，网络异常根本走不到，
 *      所以界面上一个 role="alert" 都没有。
 *   3. 刷新才能恢复的代价是输入框里的作业要求被清空（state 随组件销毁），
 *      而用户往往是刚粘完一大段题目。修复后必须保证「作业要求已保留」。
 *
 * 第二个场景是网关错误页：AI 服务前面常挂 Nginx/Cloudflare，
 * 超时会返回 504 的 HTML 而不是 JSON，`res.json()` 直接抛 SyntaxError，
 * 同样落到「按钮卡死」那条路上。
 *
 * 这里不打桩页面内部函数，而是打桩 fetch，走真实的 SWR + 事件处理链路；
 * 断言的是「用户看到什么、输入还在不在」，不是组件里调了哪个 setState。
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : String(href)} {...rest}>
      {children}
    </a>
  )
}));

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

// DAG 走 next/dynamic + reactflow，测试里换成占位以免拉起整个画布。
vi.mock('@/app/(dashboard)/dashboard/courses/[id]/tasks/task-dag', () => ({
  default: () => <div data-testid="task-dag" />
}));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, errorRetryCount: 0 }}>
      <Suspense fallback={<div>加载中</div>}>{children}</Suspense>
    </SWRConfig>
  );
}

/** `use(params)` 要求同一 promise 实例，且 render 必须包在 act 里才能跑完挂起重试。 */
const PARAMS = Promise.resolve({ id: '7' });

const ASSIGNMENT_TEXT = '以「校园二手交易」为题，完成需求分析、原型设计与可用性测试报告。';

const GROUP = {
  id: 501,
  name: '实践小组',
  members: [
    { userId: 101, name: '张三', studentNo: '2024001' },
    { userId: 102, name: '李四', studentNo: '2024002' }
  ]
};

type Route = { match: RegExp; handler: (url: string, init: RequestInit) => Response | Promise<Response> };

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * 页面需要的五个 GET 全部给最小可用数据：
 *   /api/courses/7        → myRole（captain：本组队长，自动解析出 group）
 *   /api/courses/7/groups → 一个含我在内的小组
 *   /api/auth/me          → 当前用户 id，用于定位「我的组」
 *   /api/groups/501/task-plan → 空计划（还没有任务，按钮是「AI 拆解为任务 DAG」）
 *   /api/groups/501/contract  → 无契约
 * 生成接口由各用例覆盖。
 */
function baseRoutes(): Route[] {
  return [
    { match: /^\/api\/courses\/7$/, handler: () => json(200, { myRole: 'captain' }) },
    { match: /^\/api\/courses\/7\/groups$/, handler: () => json(200, { groups: [GROUP] }) },
    { match: /^\/api\/auth\/me$/, handler: () => json(200, { user: { id: 101 } }) },
    {
      match: /^\/api\/groups\/501\/task-plan$/,
      handler: () => json(200, { plan: null, tasks: [], deps: [], assignments: [] })
    },
    {
      match: /^\/api\/groups\/501\/contract$/,
      handler: () => json(200, { latest: null, versions: [], glossary: [], acceptances: [] })
    }
  ];
}

/**
 * 按 URL 分流；`overrides` 排在前面，所以同名 URL 由用例覆盖。
 * 未 stub 的请求直接抛错，避免请求静默走到默认分支让断言失去意义。
 */
function stubRoutes(overrides: Route[] = []) {
  const routes = [...overrides, ...baseRoutes()];
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const hit = routes.find((r) => r.match.test(url));
    if (!hit) throw new Error(`测试未 stub 的请求：${url}`);
    return hit.handler(url, (init ?? {}) as RequestInit);
  });
}

const generateMatcher = /^\/api\/groups\/501\/task-plan\/generate$/;

/** 渲染到「可以点 AI 拆解」的状态：粘好要求，按钮可用。 */
async function renderReadyToGenerate() {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(<GroupTasksPage params={PARAMS} />, { wrapper });
  });
  const textarea = await screen.findByPlaceholderText('粘贴作业要求原文…', {}, { timeout: 5000 });
  await act(async () => {
    fireEvent.change(textarea, { target: { value: ASSIGNMENT_TEXT } });
  });
  const button = screen.getByRole('button', { name: /AI 拆解为任务 DAG/ });
  expect((button as HTMLButtonElement).disabled).toBe(false);
  return { result, textarea, button };
}

beforeEach(() => {
  pushMock.mockClear();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('任务页 AI 拆解：网络异常必须可见、可恢复、不丢输入', () => {
  it('fetch 直接 reject 时出 role=alert 的可读错误，按钮不停在「拆解中」', async () => {
    stubRoutes([
      {
        match: generateMatcher,
        handler: () => {
          // 断网 / DNS 失败 / 连接被重置，浏览器层面直接 reject
          throw new TypeError('Failed to fetch');
        }
      }
    ]);

    const { textarea, button } = await renderReadyToGenerate();

    // 修复前：异常逃出事件处理器，按钮永久停在「AI 拆解中（最长约 2 分钟）…」
    expect(button.textContent).toContain('AI 拆解为任务 DAG');
    await act(async () => {
      fireEvent.click(button);
    });

    const alert = await screen.findByRole('alert', {}, { timeout: 5000 });
    expect(alert.textContent ?? '').toMatch(/网络异常|未生效/);
    // 如实指路：手工入口确实存在，不能只是「请重试」
    expect(alert.textContent ?? '').toContain('作业要求已保留');
    expect(alert.textContent ?? '').toContain('手工新增任务');

    // 按钮回到可点状态（generating 已复位），不是卡在加载态
    const after = screen.getByRole('button', { name: /AI 拆解为任务 DAG/ }) as HTMLButtonElement;
    expect(after.disabled).toBe(false);
    expect(after.textContent).not.toContain('拆解中');
    // 加载态提示也一起消失
    expect(screen.queryByText(/AI 正在拆解/)).toBeNull();

    // 核心：输入框里的作业要求一个字都不能少（修复前只能刷新，刷新就没了）
    expect((textarea as HTMLTextAreaElement).value).toBe(ASSIGNMENT_TEXT);
  });

  it('504 的 HTML 网关页（非 JSON）也不崩，同样出可见错误并保留输入', async () => {
    stubRoutes([
      {
        match: generateMatcher,
        handler: () =>
          new Response('<html><head><title>504 Gateway Time-out</title></head><body>504</body></html>', {
            status: 504,
            headers: { 'Content-Type': 'text/html' }
          })
      }
    ]);

    const { textarea, button } = await renderReadyToGenerate();
    await act(async () => {
      fireEvent.click(button);
    });

    // res.json() 抛 SyntaxError 被 catch 收住 → 走 !res.ok 的状态码兜底文案
    const alert = await screen.findByRole('alert', {}, { timeout: 5000 });
    expect(alert.textContent ?? '').toContain('拆解失败（HTTP 504）');

    const after = screen.getByRole('button', { name: /AI 拆解为任务 DAG/ }) as HTMLButtonElement;
    expect(after.disabled).toBe(false);
    expect((textarea as HTMLTextAreaElement).value).toBe(ASSIGNMENT_TEXT);
    // 未生成任何任务：仍停在空计划状态，没有把失败当成功去清空输入或刷新出新任务
    expect(screen.queryByTestId('task-dag')).toBeNull();
  });

  it('失败后原样重试能成功：错误消失、输入清空、计划出现', async () => {
    let attempt = 0;
    stubRoutes([
      {
        match: generateMatcher,
        handler: () => {
          attempt += 1;
          if (attempt === 1) throw new TypeError('Failed to fetch');
          return json(201, { plan: { id: 1 }, tasks: [], deps: [], assignments: [] });
        }
      }
    ]);

    const { textarea, button } = await renderReadyToGenerate();
    await act(async () => {
      fireEvent.click(button);
    });
    await screen.findByRole('alert', {}, { timeout: 5000 });

    // 同一个按钮、同一份输入，直接再点一次——这也是修复点：
    // 旧实现在第一次失败后按钮就永远 disabled，根本没有「重试」这条路。
    const retry = screen.getByRole('button', { name: /AI 拆解为任务 DAG/ });
    await act(async () => {
      fireEvent.click(retry);
    });

    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
    expect(attempt).toBe(2);
    // 成功才清空输入（失败时清空会让用户丢掉刚粘的题目）
    expect((textarea as HTMLTextAreaElement).value).toBe('');
  });
});