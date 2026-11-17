import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryError, QueryState } from '@/components/query-state';
import { ApiError, type ApiErrorKind } from '@/lib/api/client';

/**
 * QueryError 的回归测试（优化计划 P0-1 的「共用稳定 loading/empty/error/retry」）。
 *
 * 锁的是「同一个错误在不同页面不该有三种说法」这条：
 * 401 → 去登录、403/404 → 不给重试、网络/5xx/超时 → 给重试。
 * 之前 course-role-gate 就是因为没有这层区分，把断网渲染成了「你没权限」。
 */

const originalLocation = window.location;

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'location', { value: originalLocation, writable: true });
});

function apiError(kind: ApiErrorKind, status: number | null, message: string) {
  return new ApiError({ kind, message, status, body: null });
}

describe('QueryError', () => {
  it('403 显示服务端文案且不给重试（重试也不会变）', () => {
    render(
      <QueryError error={apiError('forbidden', 403, '需要教师或助教权限')} onRetry={() => {}} />
    );

    expect(screen.getByText('需要教师或助教权限')).toBeTruthy();
    expect(screen.getByText('没有这个页面的权限')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
  });

  it('404 同样不给重试', () => {
    render(<QueryError error={apiError('not-found', 404, '内容不存在或已被删除')} onRetry={() => {}} />);

    expect(screen.getByText('内容不存在或已被删除')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
  });

  it('401 给「去登录」而不是「重试」', () => {
    render(<QueryError error={apiError('unauthorized', 401, '登录已过期，请重新登录')} onRetry={() => {}} />);

    expect(screen.getByText('登录已过期，请重新登录')).toBeTruthy();
    expect(screen.getByRole('button', { name: /去登录/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
  });

  it('500 给重试，并显示服务端错误文本', () => {
    const onRetry = vi.fn();
    render(<QueryError error={apiError('http', 500, '服务暂时不可用（HTTP 500），请稍后重试')} onRetry={onRetry} />);

    expect(screen.getByText('服务暂时不可用（HTTP 500），请稍后重试')).toBeTruthy();
    const retry = screen.getByRole('button', { name: /重试/ });
    retry.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('断网归类为网络连接失败，不冒充权限问题', () => {
    render(<QueryError error={apiError('network', null, '网络连接失败，请检查网络后重试')} onRetry={() => {}} />);

    expect(screen.getByText('网络连接失败，请检查网络后重试')).toBeTruthy();
    expect(screen.getByRole('button', { name: /重试/ })).toBeTruthy();
    expect(screen.queryByText('没有这个页面的权限')).toBeNull();
  });

  it('非 ApiError（例如代码里抛的 TypeError）也不崩，落到通用错误', () => {
    render(<QueryError error={new TypeError('boom')} onRetry={() => {}} />);

    expect(screen.getByText('boom')).toBeTruthy();
    expect(screen.getByRole('button', { name: /重试/ })).toBeTruthy();
  });

  it('没有 onRetry 时不渲染重试按钮（避免点了没反应的死按钮）', () => {
    render(<QueryError error={apiError('http', 500, '服务暂时不可用')} />);

    expect(screen.queryByRole('button', { name: /重试/ })).toBeNull();
  });
});

describe('QueryState', () => {
  it('加载中只显示骨架，不显示空态', () => {
    const { container } = render(
      <QueryState isLoading error={null} isEmpty empty={<div>还没有数据</div>}>
        <div>内容</div>
      </QueryState>
    );

    expect(screen.queryByText('还没有数据')).toBeNull();
    expect(screen.queryByText('内容')).toBeNull();
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('同时「正在重试」和「有旧错误」时继续显示错误而不是退回骨架', () => {
    // 否则用户点重试会看到抖回骨架、失败又变回同一条错误，像是按钮没反应
    const { container } = render(
      <QueryState isLoading error={apiError('http', 500, '服务暂时不可用')} isEmpty>
        <div>内容</div>
      </QueryState>
    );

    expect(screen.getByText('服务暂时不可用')).toBeTruthy();
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });

  it('有错误时优先显示错误，即便数据为空也不算空态', () => {
    render(
      <QueryState isLoading={false} error={apiError('forbidden', 403, '没有访问权限')} isEmpty>
        <div>内容</div>
      </QueryState>
    );

    // 关键：403 不能渲染成「还没有数据」
    expect(screen.getByText('没有访问权限')).toBeTruthy();
    expect(screen.queryByText('内容')).toBeNull();
  });

  it('无错误且为空时显示空态文案', () => {
    render(
      <QueryState
        isLoading={false}
        error={null}
        isEmpty
        empty={<div>还没有小组</div>}
      >
        <div>内容</div>
      </QueryState>
    );

    expect(screen.getByText('还没有小组')).toBeTruthy();
    expect(screen.queryByText('内容')).toBeNull();
  });

  it('正常有数据时渲染 children', () => {
    render(
      <QueryState isLoading={false} error={null} isEmpty={false}>
        <div>内容</div>
      </QueryState>
    );

    expect(screen.getByText('内容')).toBeTruthy();
  });
});