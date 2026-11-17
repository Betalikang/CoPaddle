import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Suspense, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import SkillCardPage from '@/app/(dashboard)/dashboard/courses/[id]/skill-card/page';

/**
 * 技能卡「读取失败」的回归测试（优化计划 P1-5 / P2-8）。
 *
 * 原来读失败时会退化成一张全新空技能卡（所有滑条 0、自述空），
 * 学生看到「0 分」会以为自己从没填过，一按保存就把服务端已有内容覆盖成空白。
 * 这里锁住：读失败必须只报错 + 重试，不能出现可保存的表单。
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : String(href)} {...rest}>
      {children}
    </a>
  )
}));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, errorRetryCount: 0 }}>
      <Suspense fallback={<div>加载中</div>}>{children}</Suspense>
    </SWRConfig>
  );
}

/**
 * 页面签名是 `{ params: Promise<{id}> }` 并用 React 19 的 `use(params)` 读取。
 *
 * 两个坑（都踩过）：
 *   1. promise 必须是同一个实例 —— 每次 re-render 新建 Promise 会让 use() 永远挂起；
 *   2. render 必须包在 `await act(async () => …)` 里 —— 否则 React 19 的挂起重试
 *      不会在 act 作用域内完成，测试永远停在 Suspense fallback 上。
 */
const PARAMS = Promise.resolve({ id: '7' });

async function renderPage() {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(<SkillCardPage params={PARAMS} />, { wrapper });
  });
  return result;
}

function mockJson(status: number, body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' }
    })
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SkillCardPage 读取失败', () => {
  it('503 时不渲染滑条与保存按钮，只给错误与重试', async () => {
    vi.mocked(fetch).mockImplementation(() => mockJson(503, { error: '服务暂时不可用' }));

    await renderPage();

    expect(await screen.findByText('技能卡加载失败', {}, { timeout: 3000 })).toBeTruthy();
    // 关键：不能出现可编辑表单 —— 否则一保存就覆盖服务端数据
    expect(screen.queryByText('保存技能卡')).toBeNull();
    expect(screen.queryByText('能力自评')).toBeNull();
    expect(screen.getByRole('button', { name: /重试/ })).toBeTruthy();
  });

  it('403 时不渲染表单，也不给重试（重试不会变）', async () => {
    vi.mocked(fetch).mockImplementation(() => mockJson(403, { error: '不在本课程名单中' }));

    await renderPage();

    expect(await screen.findByText('技能卡加载失败', {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByText('保存技能卡')).toBeNull();
    expect(screen.queryByRole('button', { name: /重试/ })).toBeNull();
  });

  it('读取成功时渲染表单（回归：不能因为加了 error 分支就挡住正常路径）', async () => {
    vi.mocked(fetch).mockImplementation(() => mockJson(200, { card: null }));

    await renderPage();

    expect(await screen.findByText('保存技能卡', {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText('能力自评')).toBeTruthy();
  });
});