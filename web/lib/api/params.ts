/**
 * 路由参数 / 查询参数的整数解析。
 *
 * 原来的惯用法 `const id = Number.parseInt(raw, 10); if (!Number.isFinite(id)) …`
 * 挡不住两类坏输入：
 *   - 溢出：`parseInt('99999999999999999999')` 仍是 finite，直接进 SQL 触发
 *     `PostgresError: value "100000000000000000000" is out of range for type integer`
 *   - 脏尾：`parseInt('12abc')` 静默截成 12
 * 这里要求「整串都是十进制数字」且落在 int4 范围内，返回 null 表示参数非法。
 */

const INT4_MIN = -2147483648;
const INT4_MAX = 2147483647;

export function parseId(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const s = raw.trim();
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isSafeInteger(n)) return null;
  if (n < INT4_MIN || n > INT4_MAX) return null;
  return n;
}

/** 正整数 id（绝大多数路由）：0 与负数一律非法。 */
export function parsePositiveId(raw: string | null | undefined): number | null {
  const n = parseId(raw);
  if (n === null || n <= 0) return null;
  return n;
}

/**
 * 分页参数：只有客户端显式带了 `page` / `pageSize` 才分页，否则返回 null 表示「不分页」。
 * 非法值（`page=-1`、`pageSize=abc`、`pageSize=0`）返回 'invalid'，由调用方回 400；
 * `pageSize` 超过上限时夹紧到 maxPageSize，避免一次拖走整表。
 */
export type PageWindow = { page: number; pageSize: number; offset: number; limit: number };

export function parsePagination(
  params: URLSearchParams,
  defaults: { defaultPageSize?: number; maxPageSize?: number } = {}
): PageWindow | null | 'invalid' {
  const rawPage = params.get('page');
  const rawSize = params.get('pageSize');
  if (rawPage === null && rawSize === null) return null;

  const maxPageSize = defaults.maxPageSize ?? 200;
  const defaultPageSize = defaults.defaultPageSize ?? 20;

  let page = 1;
  if (rawPage !== null) {
    const n = parseId(rawPage);
    if (n === null || n < 1) return 'invalid';
    page = n;
  }

  let pageSize = defaultPageSize;
  if (rawSize !== null) {
    const n = parseId(rawSize);
    if (n === null || n < 1) return 'invalid';
    pageSize = Math.min(n, maxPageSize);
  }

  return { page, pageSize, offset: (page - 1) * pageSize, limit: pageSize };
}
