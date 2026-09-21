import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/drizzle';
import {
  groupHealthSnapshots,
  groupMembers,
  groups,
  progressSignals,
  taskAssignments,
  tasks
} from '../db/schema';
import { AlgoServiceError, callAlgo } from '@/lib/algo/client';

/** algo /internal/health/compute 响应。 */
type AlgoHealth = {
  blocked_score: number;
  idle_score: number;
  overload_score: number;
  overall: number;
  diagnosis: string[];
  blocked_tasks: string[];
  idle_members: string[];
  overload_members: string[];
};

/** 小组任务摘要（含调度字段），喂给 algo。 */
async function loadGroupTasks(groupId: number) {
  const rows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.groupId, groupId), isNull(tasks.deletedAt)))
    .orderBy(asc(tasks.orderIndex));

  // 主责人（RACI=lead）与剩余工时
  const assignRows = rows.length
    ? await db
        .select()
        .from(taskAssignments)
        .where(inArray(taskAssignments.taskId, rows.map((t) => t.id)))
    : [];
  const leadByTask = new Map<number, string>();
  for (const a of assignRows) {
    if (a.raci === 'lead') leadByTask.set(a.taskId, String(a.userId));
  }

  return rows.map((t) => ({
    id: String(t.id),
    title: t.title,
    deps: [] as string[], // 由调用方补（health 只需 blocked/overload 判定）
    est_hours: Number(t.estHours),
    status: t.status,
    due_at: t.dueAt ? t.dueAt.toISOString() : null,
    skills: [] as string[],
    assignee_id: leadByTask.get(t.id) ?? null,
    remaining_hours: t.actualHours != null ? null : Number(t.estHours),
    deliverable_type: t.deliverableType
  }));
}

/** 各成员最近一条进度信号时间（失联判定）。 */
async function loadLastSignals(userIds: number[]) {
  if (userIds.length === 0) return {};
  const rows = await db
    .select({
      userId: progressSignals.userId,
      last: sql<string>`max(${progressSignals.observedAt})`.as('last')
    })
    .from(progressSignals)
    .where(inArray(progressSignals.userId, userIds))
    .groupBy(progressSignals.userId);
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (r.last) out[String(r.userId)] = new Date(r.last).toISOString();
  }
  return out;
}

/** 记录一条进度信号（任务状态变更/打卡/交付物提交等由各调用方触发）。 */
export async function recordSignal(
  groupId: number,
  userId: number,
  signalType: string,
  taskId?: number,
  payload?: Record<string, unknown>
) {
  await db.insert(progressSignals).values({
    groupId,
    userId,
    taskId: taskId ?? null,
    signalType,
    payload: payload ?? null
  });
}

/**
 * 计算并落库小组健康度（规格书 B-10 / S4.4）。
 * 三维 + 诊断条目；快照供教师端预警中心与趋势图使用。
 */
export async function computeGroupHealth(groupId: number) {
  const members = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), isNull(groupMembers.leftAt)));
  const memberIds = members.map((m) => m.userId);

  const taskRows = await loadGroupTasks(groupId);
  const lastSignals = await loadLastSignals(memberIds);

  const result = await callAlgo<AlgoHealth>(
    '/internal/health/compute',
    {
      group_id: String(groupId),
      tasks: taskRows,
      member_ids: memberIds.map(String),
      last_signal_at: lastSignals
    },
    30000
  );

  const openTasks = taskRows.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
  const onTrack = openTasks.filter((t) => !result.blocked_tasks.includes(t.id)).length;

  const [snapshot] = await db
    .insert(groupHealthSnapshots)
    .values({
      groupId,
      blockedScore: String(result.blocked_score),
      idleScore: String(result.idle_score),
      overloadScore: String(result.overload_score),
      onTrackRatio: openTasks.length ? String(onTrack / openTasks.length) : '1.000',
      criticalDelayDays: '0',
      diagnosis: result.diagnosis
    })
    .returning();

  return { snapshot, detail: result };
}

/** 小组最新健康度 + 历史序列。 */
export async function getGroupHealth(groupId: number) {
  const latest = await db
    .select()
    .from(groupHealthSnapshots)
    .where(eq(groupHealthSnapshots.groupId, groupId))
    .orderBy(desc(groupHealthSnapshots.snapshotAt))
    .limit(1);
  const history = await db
    .select()
    .from(groupHealthSnapshots)
    .where(eq(groupHealthSnapshots.groupId, groupId))
    .orderBy(asc(groupHealthSnapshots.snapshotAt))
    .limit(30);
  return { latest: latest[0] ?? null, history };
}

/** 全班健康度总览（教师端热力图）。 */
export async function getCourseHealthOverview(courseId: number) {
  const groupRows = await db
    .select()
    .from(groups)
    .where(eq(groups.courseId, courseId))
    .orderBy(groups.id);

  const out: {
    groupId: number;
    name: string;
    overall: number | null;
    blocked: number | null;
    idle: number | null;
    overload: number | null;
    diagnosis: string[] | null;
    snapshotAt: Date | null;
  }[] = [];

  for (const g of groupRows) {
    const { latest } = await getGroupHealth(g.id);
    out.push({
      groupId: g.id,
      name: g.name,
      overall: latest ? Number(latest.blockedScore) * 0 + overallOf(latest) : null,
      blocked: latest ? Number(latest.blockedScore) : null,
      idle: latest ? Number(latest.idleScore) : null,
      overload: latest ? Number(latest.overloadScore) : null,
      diagnosis: (latest?.diagnosis as string[] | null) ?? null,
      snapshotAt: latest?.snapshotAt ?? null
    });
  }
  return out;
}

function overallOf(s: typeof groupHealthSnapshots.$inferSelect): number {
  return Math.round(
    0.4 * Number(s.blockedScore) + 0.3 * Number(s.idleScore) + 0.3 * Number(s.overloadScore)
  );
}

/** 预警中心：全班有待处理诊断的小组（健康度 < 80 或 diagnosis 非空）。 */
export async function getCourseAlerts(courseId: number) {
  const overview = await getCourseHealthOverview(courseId);
  return overview
    .filter((g) => g.overall !== null && (g.overall < 80 || (g.diagnosis?.length ?? 0) > 0))
    .sort((a, b) => (a.overall ?? 100) - (b.overall ?? 100));
}

/** 阻塞项清单（预警详情用）：重新计算一次并返回 blocked_tasks。 */
export async function getGroupBlockers(groupId: number) {
  const { detail } = await computeGroupHealth(groupId);
  return detail.blocked_tasks;
}
