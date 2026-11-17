import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { CourseRoleGate, TeacherGate, STUDENT_SIDE } from '@/components/course-role-gate';

/**
 * 角色闸门的回归测试（优化计划 P0-1 / P2-8）。
 *
 * 锁的是三条曾经出错的边界：
 *   1. 403 必须显示「没有权限」，而不是渲染空表单或「0 班 0 人」
 *   2. 网络断 / 5xx / 超时**不能**冒充权限问题（用户会以为自己被降权）
 *   3. 角色合法时必须渲染 children，且不闪错误态
 *
 * 这里不打桩 useSWR，而是打桩 fetch，让真实的 swrFetcher → apiFetch →
 * ApiError 分类链路整条跑起来。只测「组件把 ApiError 的 kind 映射成什么界面」，
 * 依赖的是 lib/api/client 的真实行为，而不是我们对它行为的假设。
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : String(href)} {...rest}>
      {children}
    </a>
  )
}));

/** 每个用例用独立缓存，避免上一个用例的数据串到下一个。 */
function wrapper({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, errorRetryCount: 0 }}>
      {children}
    </SWRConfig>
  );
}

function mockJsonResponse(status: number, body: unknown) {
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

describe('CourseRoleGate', () => {
  it('403 显示「没有这个页面的权限」，且不渲染子内容', async () => {
    vi.mocked(fetch).mockImplementation(() =>
      mockJsonResponse(403, { error: '需要教师或助教权限' })
    );

    render(
      <TeacherGate courseId={7} title="分组工作台">
        <div>只有教师能看的内容</div>
      </TeacherGate>,
      { wrapper }
    );

    // Callout 的标题是「你没有这个页面的权限」，用子串匹配避免把措辞绑死在测试里
    expect(await screen.findByText(/没有这个页面的权限/)).toBeTruthy();
    expect(screen.queryByText('只有教师能看的内容')).toBeNull();
    // 403 不该给「重试」——重试也不会变
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
  });

  it('500 走「取不到角色」而不是「你没权限」，并给重试', async () => {
    vi.mocked(fetch).mockImplementation(() =>
      mockJsonResponse(500, { error: '数据库连接失败' })
    );

    render(
      <TeacherGate courseId={7} title="分组工作台">
        <div>只有教师能看的内容</div>
      </TeacherGate>,
      { wrapper }
    );

    expect(await screen.findByText('无法确认你在本课程的角色')).toBeTruthy();
    // 关键断言：5xx 不能被说成权限问题
    expect(screen.queryByText(/没有这个页面的权限/)).toBeNull();
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
    expect(screen.queryByText('只有教师能看的内容')).toBeNull();
  });

  it('网络中断也归为加载失败，不归为无权限', async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));

    render(
      <TeacherGate courseId={7} title="分组工作台">
        <div>只有教师能看的内容</div>
      </TeacherGate>,
      { wrapper }
    );

    expect(await screen.findByText('无法确认你在本课程的角色')).toBeTruthy();
    expect(screen.queryByText(/没有这个页面的权限/)).toBeNull();
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
  });

  it('角色合法时渲染 children', async () => {
    vi.mocked(fetch).mockImplementation(() => mockJsonResponse(200, { myRole: 'teacher' }));

    render(
      <TeacherGate courseId={7} title="分组工作台">
        <div>只有教师能看的内容</div>
      </TeacherGate>,
      { wrapper }
    );

    expect(await screen.findByText('只有教师能看的内容')).toBeTruthy();
    expect(screen.queryByText(/没有这个页面的权限/)).toBeNull();
  });

  it('学生打开教师页被拦下（allowed 不含 member）', async () => {
    vi.mocked(fetch).mockImplementation(() => mockJsonResponse(200, { myRole: 'member' }));

    render(
      <TeacherGate courseId={7} title="分组工作台">
        <div>只有教师能看的内容</div>
      </TeacherGate>,
      { wrapper }
    );

    // Callout 的标题是「你没有这个页面的权限」，用子串匹配避免把措辞绑死在测试里
    expect(await screen.findByText(/没有这个页面的权限/)).toBeTruthy();
    expect(screen.queryByText('只有教师能看的内容')).toBeNull();
  });

  it('myRole 缺失时按无权限处理，不放出内容', async () => {
    vi.mocked(fetch).mockImplementation(() => mockJsonResponse(200, {}));

    render(
      <CourseRoleGate courseId={7} title="任务" allowed={STUDENT_SIDE}>
        <div>任务内容</div>
      </CourseRoleGate>,
      { wrapper }
    );

    await waitFor(() => expect(screen.queryByText('任务内容')).toBeNull());
    expect(screen.getByText(/没有这个页面的权限/)).toBeTruthy();
  });

  it('学生侧闸门放行 member', async () => {
    vi.mocked(fetch).mockImplementation(() => mockJsonResponse(200, { myRole: 'member' }));

    render(
      <CourseRoleGate courseId={7} title="我的任务" allowed={STUDENT_SIDE}>
        <div>任务内容</div>
      </CourseRoleGate>,
      { wrapper }
    );

    expect(await screen.findByText('任务内容')).toBeTruthy();
  });
});