/**
 * 统一读/写请求契约（优化计划 P0-1 / P0-2 的共用基础件）。
 *
 * 旧写法 `fetch(url).then(res => res.json())` 的致命问题是：HTTP 403 的
 * `{ error: '无权访问' }` 会被 SWR 当成成功数据，于是「没有权限」被渲染成
 * 「还没有数据」，用户看到的是空列表而不是错误，刷新也没用。
 *
 * 这里把三件事定死：
 *   1. 非 2xx 一律抛 ApiError，绝不返回给调用方当数据；
 *   2. 错误带上 kind/status/retryable/body，页面能区分 401（重新登录）、
 *      403（无权）、404（不存在）、5xx（可重试）;
 *   3. 服务端 error 字段只取字符串并截断，避免把 HTML 错误页或堆栈塞进界面。
 */

/** 错误分类：决定页面该说「无权限」还是「请重试」。 */
export type ApiErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'http'
  | 'network'
  | 'timeout'
  | 'invalid-response';

const KIND_BY_STATUS: Record<number, ApiErrorKind> = {
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not-found'
};

/** 默认超时：普通读请求 20s；写操作 30s；AI 长任务由调用方显式放宽。 */
export const READ_TIMEOUT_MS = 20_000;
export const WRITE_TIMEOUT_MS = 30_000;
export const LONG_TASK_TIMEOUT_MS = 180_000;

const MAX_SERVER_ERROR_CHARS = 200;

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  /** HTTP 状态码；网络层失败（DNS/断网/超时）时为 null。 */
  readonly status: number | null;
  /** 服务端 JSON 响应体（可能是 null）。调用方据此读 violations 等结构化字段。 */
  readonly body: unknown;

  constructor(args: {
    kind: ApiErrorKind;
    message: string;
    status?: number | null;
    body?: unknown;
  }) {
    super(args.message);
    this.name = 'ApiError';
    this.kind = args.kind;
    this.status = args.status ?? null;
    this.body = args.body ?? null;
  }

  /** 可重试：超时 / 断网 / 429 / 5xx。4xx 业务错误重试没有意义。 */
  get retryable(): boolean {
    if (this.kind === 'network' || this.kind === 'timeout') return true;
    if (this.status === null) return false;
    return this.status === 429 || this.status >= 500;
  }

  /** 结构化的违规列表（分组预演/落库失败时服务端会返回）。 */
  get violations(): { code?: string; message?: string }[] {
    const raw = (this.body as { violations?: unknown } | null)?.violations;
    if (!Array.isArray(raw)) return [];
    return raw.filter((v): v is { code?: string; message?: string } =>
      Boolean(v) && typeof v === 'object'
    );
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** 服务端 `error` 字段 → 可展示文案；非字符串/空串一律视为没有。 */
function pickServerError(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const raw = (body as { error?: unknown }).error;
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text) return null;
  return text.length > MAX_SERVER_ERROR_CHARS
    ? `${text.slice(0, MAX_SERVER_ERROR_CHARS)}…`
    : text;
}

/** 状态码兜底文案：拿不到服务端 error 时也别只说「失败」。 */
function statusFallback(status: number): string {
  if (status === 401) return '登录已过期，请重新登录';
  if (status === 403) return '没有访问权限';
  if (status === 404) return '内容不存在或已被删除';
  if (status === 409) return '数据已变化，请刷新后重试';
  if (status === 429) return '请求过于频繁，请稍后再试';
  if (status >= 500) return `服务暂时不可用（HTTP ${status}），请稍后重试`;
  return `请求失败（HTTP ${status}）`;
}

function isAbortLike(e: unknown): boolean {
  return Boolean(e) && typeof e === 'object' && (e as { name?: string }).name === 'AbortError';
}

/**
 * 内部实现：发请求 → 解析 → 非 2xx 抛错。
 * `parse` 为 'json' 时把响应体当 JSON；'none' 时忽略响应体（204/文件下载）。
 */
async function request(
  input: string,
  init: RequestInit & { timeoutMs?: number }
): Promise<{ res: Response; body: unknown }> {
  const { timeoutMs = READ_TIMEOUT_MS, signal, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // 调用方自带的 signal（如 SWR 卸载）也要能中断
  const onOuterAbort = () => controller.abort();
  signal?.addEventListener('abort', onOuterAbort);

  let res: Response;
  try {
    res = await fetch(input, { ...rest, signal: controller.signal });
  } catch (e) {
    // 我们自己的超时和调用方的取消都用 AbortError 表达，靠 controller.signal 区分
    if (isAbortLike(e)) {
      if (signal?.aborted) throw e; // 页面卸载导致的取消，交给 SWR 忽略
      throw new ApiError({ kind: 'timeout', message: '请求超时，请检查网络后重试' });
    }
    throw new ApiError({
      kind: 'network',
      message: '网络连接失败，请检查网络后重试'
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }

  const text = await res.text().catch(() => '');
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    throw new ApiError({
      kind: KIND_BY_STATUS[res.status] ?? 'http',
      status: res.status,
      body,
      message: pickServerError(body) ?? statusFallback(res.status)
    });
  }

  if (text && body === text) {
    // 2xx 却不是 JSON：多半是网关错误页/登录跳转，不能当数据往下传
    throw new ApiError({
      kind: 'invalid-response',
      status: res.status,
      body: null,
      message: '服务返回了无法解析的内容，请稍后重试'
    });
  }

  return { res, body };
}

/** 读请求：SWR 的 fetcher 就是它。非 2xx 抛 ApiError。 */
export async function apiFetch<T>(
  url: string,
  init: (RequestInit & { timeoutMs?: number }) = {}
): Promise<T> {
  const { body } = await request(url, { ...init, method: init.method ?? 'GET' });
  return body as T;
}

/** SWR 专用别名：`useSWR(url, swrFetcher)`，写法与旧 fetcher 一致，行为已修正。 */
export const swrFetcher = <T,>(url: string): Promise<T> => apiFetch<T>(url);

/**
 * 写请求：成功返回解析后的 body，失败抛 ApiError（带 status 与 violations）。
 * 调用方必须 await 并让错误冒出去——这正是「假成功」的根治点：
 * 没有 2xx 就不允许跳转、不允许清空表单、不允许显示「已保存」。
 */
export async function apiSend<T>(
  url: string,
  options: {
    method?: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    body?: unknown;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {}
): Promise<T> {
  const { method = 'POST', body, timeoutMs = WRITE_TIMEOUT_MS, signal } = options;
  const hasBody = body !== undefined;
  const { body: parsed } = await request(url, {
    method,
    timeoutMs,
    signal,
    headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(body) : undefined
  });
  return parsed as T;
}

/** 401 时把用户送回登录页，并带上回跳地址。只在浏览器环境生效。 */
export function redirectToSignIn(): void {
  if (typeof window === 'undefined') return;
  const here = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/sign-in?redirect=${encodeURIComponent(here)}`);
}

/**
 * 错误 → 一句人话。页面统一用它，避免每处各写一套 if/else。
 * 401 只提示重新登录，不自动跳转（自动跳转会让后台定时刷新把用户踢出去）。
 */
export function describeApiError(error: unknown): string {
  if (isApiError(error)) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return '操作失败，请重试';
}