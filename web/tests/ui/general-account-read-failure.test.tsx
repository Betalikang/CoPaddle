import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';

/**
 * 账号设置页的读失败回归测试（P0-1 契约迁移的一个真实数据风险）。
 *
 * 锁的缺陷：`AccountFormWithData` 用 `useSWR<User>('/api/user', swrFetcher)`，
 * 字段走 `defaultValue={user?.name ?? ''}`。当 `/api/user` 读失败（断网、500、
 * 401 过期）时 SWR 的 `data` 是 undefined，于是：
 *
 *   1. 姓名和邮箱两个输入框渲染成空串，且「保存修改」按钮照常可点；
 *   2. 用户点下去，`updateAccount` 直接 `db.update(users).set({ name, email })`，
 *      没有「空值不覆盖」的保护，服务端的姓名与邮箱被清空；
 *   3. 界面上还显示「账号信息已更新。」——一次静默的数据破坏。
 *
 * 修复后的契约：读不到就只给错误 + 重试，整块表单（含提交按钮）都不渲染。
 * 这里断言的是「用户在页面上能看到什么、能不能点到提交」，不是内部 state。
 */

// 页面 import 的 server action 在测试环境里不能真的执行，全部换成空实现；
// 只要它们没被调用，就说明没有任何提交路径可达。
const { updateAccountMock, updatePasswordMock, deleteAccountMock } = vi.hoisted(() => ({
  updateAccountMock: vi.fn(),
  updatePasswordMock: vi.fn(),
  deleteAccountMock: vi.fn()
}));

vi.mock('@/app/(login)/actions', () => ({
  updateAccount: updateAccountMock,
  updatePassword: updatePasswordMock,
  deleteAccount: deleteAccountMock
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : String(href)} {...rest}>
      {children}
    </a>
  )
}));

// 延迟到 mock 生效之后再引入页面
const { default: GeneralPage } = await import('@/app/(dashboard)/dashboard/general/page');

function wrapper({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, errorRetryCount: 0 }}>
      {children}
    </SWRConfig>
  );
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function stubUser(handler: () => Response | Promise<Response>) {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === '/api/user') return handler();
    throw new Error(`测试未 stub 的请求：${url}`);
  });
}

beforeEach(() => {
  updateAccountMock.mockReset();
  updatePasswordMock.mockReset();
  deleteAccountMock.mockReset();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('账号设置：读不到 /api/user 时不允许用空值覆盖账号信息', () => {
  it('500 时出可见错误与重试，且不渲染任何可提交的空表单', async () => {
    stubUser(() => json(500, { error: '数据库连接超时' }));

    await act(async () => {
      render(<GeneralPage />, { wrapper });
    });

    const alert = await screen.findByText(/数据库连接超时/, {}, { timeout: 5000 });
    // 错误必须说清后果，而不是只说「加载失败」
    expect(screen.getByText('账号信息没能读取，先别保存')).toBeTruthy();
    expect(alert.closest('[role="alert"]')).not.toBeNull();
    expect(screen.getByText(/提交会把服务端的姓名和邮箱覆盖成空值/)).toBeTruthy();

    // 修复前：这两个输入框存在且为空，保存按钮可点
    expect(screen.queryByLabelText('姓名')).toBeNull();
    expect(screen.queryByLabelText('邮箱')).toBeNull();
    expect(screen.queryByRole('button', { name: '保存修改' })).toBeNull();

    // 有重试入口
    expect(screen.getByRole('button', { name: /重试/ })).toBeTruthy();
    expect(updateAccountMock).not.toHaveBeenCalled();
  });

  it('断网（fetch reject）同样不渲染表单，且给出可重试的网络错误', async () => {
    stubUser(() => {
      throw new TypeError('Failed to fetch');
    });

    await act(async () => {
      render(<GeneralPage />, { wrapper });
    });

    await screen.findByText(/网络连接失败/, {}, { timeout: 5000 });
    expect(screen.queryByLabelText('姓名')).toBeNull();
    expect(screen.queryByRole('button', { name: '保存修改' })).toBeNull();
  });

  it('读到数据后才渲染带真实值的表单，重试成功可从错误态恢复', async () => {
    let attempt = 0;
    stubUser(() => {
      attempt += 1;
      if (attempt === 1) return json(500, { error: '数据库连接超时' });
      return json(200, { id: 1, name: '张三', email: 'zhangsan@example.edu' });
    });

    await act(async () => {
      render(<GeneralPage />, { wrapper });
    });

    await screen.findByText('账号信息没能读取，先别保存', {}, { timeout: 5000 });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /重试/ }));
    });

    const nameInput = (await screen.findByLabelText('姓名', {}, { timeout: 5000 })) as HTMLInputElement;
    const emailInput = screen.getByLabelText('邮箱') as HTMLInputElement;
    // 关键：值来自服务端，不是空串——这才是「提交不会清空账号」的前提
    expect(nameInput.value).toBe('张三');
    expect(emailInput.value).toBe('zhangsan@example.edu');
    expect(screen.getByRole('button', { name: '保存修改' })).toBeTruthy();

    await waitFor(() => {
      expect(screen.queryByText('账号信息没能读取，先别保存')).toBeNull();
    });
  });
});