/**
 * 重算关键路径：按算法结果回写 tasks.on_critical_path。
 *
 * 背景：种子数据里的 on_critical_path 是脚本硬编码的（T3/T6/T8/T9），
 * 从未真正算过，导致画布上红色关键链断成两截（T3 与 T6 之间没有直达依赖边）。
 * 这个脚本按组调用 markCriticalPath（走 /internal/graph/critical-path）重新标记，
 * 与 AI 生成任务计划时的回写口径一致。
 *
 * 用法（algo 服务需在跑）：
 *   pnpm exec tsx scripts/recompute-critical-path.ts          # 全部组
 *   pnpm exec tsx scripts/recompute-critical-path.ts 164      # 只算某门课
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../lib/db/drizzle';
import { groups, tasks } from '../lib/db/schema';
import { markCriticalPath } from '../lib/services/tasks';

async function criticalCount(groupId: number) {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      crit: sql<number>`count(*) filter (where ${tasks.onCriticalPath})::int`
    })
    .from(tasks)
    .where(and(eq(tasks.groupId, groupId), isNull(tasks.deletedAt)));
  return { total: row?.total ?? 0, crit: row?.crit ?? 0 };
}

async function main() {
  const courseArg = process.argv[2] ? Number(process.argv[2]) : null;
  if (courseArg !== null && !Number.isFinite(courseArg)) {
    throw new Error(`课程 id 不是数字：${process.argv[2]}`);
  }

  const groupRows = await db
    .select({ id: groups.id, name: groups.name, courseId: groups.courseId })
    .from(groups)
    .where(courseArg === null ? sql`true` : eq(groups.courseId, courseArg))
    .orderBy(groups.courseId, groups.id);

  console.log(`待重算小组：${groupRows.length} 个${courseArg === null ? '' : `（课程 ${courseArg}）`}`);

  let changed = 0;
  let failed = 0;
  for (const g of groupRows) {
    const before = await criticalCount(g.id);
    if (before.total === 0) continue;
    try {
      const res = await markCriticalPath(g.id);
      const after = await criticalCount(g.id);
      const codes = await db
        .select({ code: tasks.code })
        .from(tasks)
        .where(
          and(eq(tasks.groupId, g.id), eq(tasks.onCriticalPath, true), isNull(tasks.deletedAt))
        )
        .orderBy(tasks.orderIndex);
      const delta = after.crit - before.crit;
      if (delta !== 0) changed++;
      console.log(
        `  组 ${g.id} ${g.name}：关键 ${before.crit} → ${after.crit}/${after.total}` +
          `（${codes.map((c) => c.code).join(' → ')}，共 ${res.totalHours}h）`
      );
    } catch (e) {
      failed++;
      console.error(`  组 ${g.id} ${g.name}：失败 ${(e as Error).message}`);
    }
  }

  console.log(`完成：${changed} 个组标记有变化，${failed} 个失败`);
  if (failed > 0) process.exitCode = 1;
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
