/** 算法服务（FastAPI）内部客户端。

隔离要求（规格书 S2/T4）：仅 Next.js 服务端经内网调用，请求携带共享密钥头。
超时与错误显式化：调用方（路由）据此返回 503 与「算法服务不可用」提示，
不影响任务看板等基础功能（规格书 S4.10）。
 */

const ALGO_URL = process.env.ALGO_SERVICE_URL ?? 'http://127.0.0.1:8000';
const ALGO_SECRET = process.env.ALGO_SHARED_SECRET ?? '';

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
  timeoutMs = 30000
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
      throw new AlgoServiceError(`算法服务返回 ${res.status}：${text.slice(0, 200)}`, res.status);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof AlgoServiceError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new AlgoServiceError(`算法服务调用超时（${timeoutMs}ms）`);
    }
    throw new AlgoServiceError(
      `算法服务不可达：${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    clearTimeout(timer);
  }
}
