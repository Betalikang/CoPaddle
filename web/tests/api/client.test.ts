import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  apiFetch,
  apiSend,
  describeApiError,
  isApiError,
  swrFetcher
} from '@/lib/api/client';

/**
 * 统一读请求契约的离线单测（优化计划 P0-1）。
 *
 * 这是 P0 的回归基线：旧写法 `fetch(url).then(r => r.json())` 在 403 时把
 * `{ error: '无权访问' }` 当成功数据，所以这里逐个锁定「非 2xx 必须抛错」。
 * 全程 mock global.fetch，不连数据库、不连网络。
 */

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function textResponse(status: number, text: string): Response {
  return new Response(text, { status, headers: { 'Content-Type': 'text/html' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('apiFetch：非 2xx 必须抛错，不能当数据返回', () => {
  it('200 返回解析后的 body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, { courses: [{ id: 1 }] }))
    );
    await expect(apiFetch<{ courses: { id: number }[] }>('/api/me/courses')).resolves.toEqual({
      courses: [{ id: 1 }]
    });
  });

  /**
   * 核心回归：这是本次修复要防的那个 bug。
   * 旧 fetcher 会 resolve 成 { error: '不属于该小组' }，页面把它当空列表渲染。
   */
  it('403 抛 forbidden，且不把 error JSON 当数据', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(403, { error: '无权访问该课程' }))
    );
    await expect(apiFetch('/api/courses/1')).rejects.toSatisfy((e: unknown) => {
      expect(isApiError(e)).toBe(true);
      const err = e as ApiError;
      expect(err.kind).toBe('forbidden');
      expect(err.status).toBe(403);
      // 文案优先用服务端给的原因
      expect(err.message).toBe('无权访问该课程');
      // 4xx 业务错误不该被自动重试
      expect(err.retryable).toBe(false);
      return true;
    });
  });

  it('401 归类为 unauthorized 并提示重新登录', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, {})));
    const err = (await apiFetch('/api/user').catch((e) => e)) as ApiError;
    expect(err.kind).toBe('unauthorized');
    expect(err.message).toContain('重新登录');
  });

  it('404 归类为 not-found', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(404, {})));
    const err = (await apiFetch('/api/x').catch((e) => e)) as ApiError;
    expect(err.kind).toBe('not-found');
  });

  it('500 可重试，文案带状态码', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(500, {})));
    const err = (await apiFetch('/api/x').catch((e) => e)) as ApiError;
    expect(err.kind).toBe('http');
    expect(err.retryable).toBe(true);
    expect(err.message).toContain('500');
  });

  it('响应体不是 JSON 的 2xx 也不能当数据传下去', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse(200, '<html>gateway</html>')));
    const err = (await apiFetch('/api/x').catch((e) => e)) as ApiError;
    expect(err.kind).toBe('invalid-response');
  });

  it('服务端 error 字段过长时截断，避免把堆栈糊到界面上', async () => {
    const long = 'x'.repeat(500);
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(400, { error: long })));
    const err = (await apiFetch('/api/x').catch((e) => e)) as ApiError;
    expect(err.message.length).toBeLessThanOrEqual(201);
    expect(err.message.endsWith('…')).toBe(true);
  });

  it('网络异常抛 network 且可重试', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
    const err = (await apiFetch('/api/x').catch((e) => e)) as ApiError;
    expect(err.kind).toBe('network');
    expect(err.retryable).toBe(true);
  });

  it('超时抛 timeout（默认 20s，这里用极短超时验证）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              const e = new Error('aborted');
              e.name = 'AbortError';
              reject(e);
            });
          })
      )
    );
    const err = (await apiFetch('/api/x', { timeoutMs: 5 }).catch((e) => e)) as ApiError;
    expect(err.kind).toBe('timeout');
    expect(err.retryable).toBe(true);
  });

  it('429 可重试，4xx 其他状态不可重试', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(429, {})));
    const tooMany = (await apiFetch('/api/x').catch((e) => e)) as ApiError;
    expect(tooMany.retryable).toBe(true);

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(409, {})));
    const conflict = (await apiFetch('/api/x').catch((e) => e)) as ApiError;
    expect(conflict.retryable).toBe(false);
    expect(conflict.message).toContain('刷新');
  });

  it('swrFetcher 与 apiFetch 行为一致（SWR 直接用它）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(403, { error: '无权' })));
    await expect(swrFetcher('/api/x')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('apiSend：写操作只有 2xx 才算成功', () => {
  it('成功返回 body 并按 JSON 发送', async () => {
    const spy = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(200, { ok: true, groups: [[1, 2]] }));
    vi.stubGlobal('fetch', spy);
    const out = await apiSend<{ ok: boolean; groups: number[][] }>('/api/grouping/plans/1/apply-move', {
      body: { userId: 1, fromGroup: 0, toGroup: 1 }
    });
    expect(out.groups).toEqual([[1, 2]]);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('/api/grouping/plans/1/apply-move');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toEqual({ userId: 1, fromGroup: 0, toGroup: 1 });
  });

  it('无 body 时不发 Content-Type（DELETE 场景）', async () => {
    const spy = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(200, {}));
    vi.stubGlobal('fetch', spy);
    await apiSend('/api/tasks/1/deps/2', { method: 'DELETE' });
    const [, init] = spy.mock.calls[0];
    expect(init?.headers).toBeUndefined();
    expect(init?.body).toBeUndefined();
  });

  it('失败带上 violations，页面据此标红具体卡片', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(409, {
          error: '移动违反硬约束',
          violations: [{ code: 'GENDER', message: '该组同性比例超限' }]
        })
      )
    );
    const err = (await apiSend('/api/grouping/plans/1/apply-move', { body: {} }).catch(
      (e) => e
    )) as ApiError;
    expect(err.status).toBe(409);
    expect(err.violations).toHaveLength(1);
    expect(err.violations[0].code).toBe('GENDER');
  });

  it('204 空响应视为成功（解散/删除类接口）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    await expect(apiSend('/api/groups/1/dissolve')).resolves.toBeNull();
  });
});

describe('describeApiError：页面文案兜底', () => {
  it('ApiError 用自身文案', () => {
    expect(
      describeApiError(new ApiError({ kind: 'forbidden', message: '无权访问该课程' }))
    ).toBe('无权访问该课程');
  });

  it('普通 Error 用 message，未知值给中文兜底', () => {
    expect(describeApiError(new Error('boom'))).toBe('boom');
    expect(describeApiError(undefined)).toBe('操作失败，请重试');
    expect(describeApiError({ weird: true })).toBe('操作失败，请重试');
  });
});