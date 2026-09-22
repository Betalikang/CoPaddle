/** 算法服务（FastAPI）内部客户端。

隔离要求（规格书 S2/T4）：仅 Next.js 服务端经内网调用，请求携带共享密钥头。
超时与错误显式化：调用方（路由）据此返回 503 与「算法服务不可用」提示，
不影响任务看板等基础功能（规格书 S4.10）。
 */

const ALGO_URL = process.env.ALGO_SERVICE_URL ?? 'http://127.0.0.1:8000';
const ALGO_SECRET = process.env.ALGO_SHARED_SECRET ?? '';

/** 调用上下文（用于 ai_call_logs 归属）。 */
export type AlgoCallContext = {
  callerId?: number;
  courseId?: number;
  groupId?: number;
};

/** 落一条 AI 调用日志（失败不阻断主流程）。 */
async function logCall(
  path: string,
  status: 'ok' | 'failed',
  latencyMs: number,
  error?: string,
  ctx?: AlgoCallContext
) {
  try {
    const { db } = await import('../db/drizzle');
    const { aiCallLogs } = await import('../db/schema');
    await db.insert(aiCallLogs).values({
      endpoint: path.replace(/^\/internal\//, '').slice(0, 50),
      latencyMs,
      status,
      error: error?.slice(0, 500) ?? null,
      callerId: ctx?.callerId ?? null,
      courseId: ctx?.courseId ?? null,
      groupId: ctx?.groupId ?? null
    });
  } catch {
    // 日志失败不影响业务
  }
}

export class AlgoServiceError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'AlgoServiceError';
  }
}

export async function callAlgo<T>(
  path: string,
  body: unknown,
  timeoutMs = 30000,
  ctx?: AlgoCallContext
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const res = await fetch(`${ALGO_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': ALGO_SECRET
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store'
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      await logCall(path, 'failed', Date.now() - startedAt, `HTTP ${res.status}: ${text.slice(0, 200)}`, ctx);
      throw new AlgoServiceError(`算法服务返回 ${res.status}：${text.slice(0, 200)}`, res.status);
    }
    const json = (await res.json()) as T;
    await logCall(path, 'ok', Date.now() - startedAt, undefined, ctx);
    return json;
  } catch (err) {
    if (err instanceof AlgoServiceError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      await logCall(path, 'failed', Date.now() - startedAt, `超时 ${timeoutMs}ms`, ctx);
      throw new AlgoServiceError(`算法服务调用超时（${timeoutMs}ms）`);
    }
    const msg = `算法服务不可达：${err instanceof Error ? err.message : String(err)}`;
    await logCall(path, 'failed', Date.now() - startedAt, msg, ctx);
    throw new AlgoServiceError(msg);
  } finally {
    clearTimeout(timer);
  }
}
