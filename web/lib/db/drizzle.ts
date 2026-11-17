import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.POSTGRES_URL) {
  throw new Error('POSTGRES_URL environment variable is not set');
}

/**
 * 连接池必须是进程级单例。
 *
 * 开发环境每次热更新都会重新执行本模块；如果每次都新建 `postgres()` 客户端，
 * 旧客户端（默认 10 条连接）不会被回收，连接数会一路涨到 Postgres 的
 * max_connections 上限，随后所有查询都报
 * `FATAL: sorry, too many clients already`。
 * 生产环境同样把上限压到较小的值，避免多实例把库的连接吃光。
 */
const globalForDb = globalThis as unknown as {
  __copaddlePgClient?: ReturnType<typeof postgres>;
};

const client =
  globalForDb.__copaddlePgClient ??
  postgres(process.env.POSTGRES_URL, {
    max: Number(process.env.POSTGRES_POOL_MAX ?? 10)
  });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__copaddlePgClient = client;
}

export { client };
export const db = drizzle(client, { schema });
