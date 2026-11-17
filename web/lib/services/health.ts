import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/drizzle';
import {
  groupHealthSnapshots,
  groupMembers,
  groups,
  progressSignals,
  taskAssignments,
  taskDeps,
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

  // 在册成员集合：已退组的人（left_at 非空）不再算作主责人，
  // 否则「有人负责」会把已流失的活算成健康，负载也记不到任何人头上。
  const memberRows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), isNull(groupMembers.leftAt)));
  const activeMemberIds = new Set(memberRows.map((m) => m.userId));

  // 主责人（RACI=lead）与剩余工时
  const assignRows = rows.length
    ? await db
        .select()
        .from(taskAssignments)
        .where(inArray(taskAssignments.taskId, rows.map((t) => t.id)))
    : [];
  const leadByTask = new Map<number, string>();
  for (const a of assignRows) {
    // 只认在册成员：教师/已退组成员挂的 lead 不算有效主责
    if (a.raci === 'lead' && activeMemberIds.has(a.userId)) {
      leadByTask.set(a.taskId, String(a.userId));
    }
  }

  // 真实依赖边：algo 的阻塞判定（scheduling.health line 178）靠
  // `any(d not in done_ids for d in t.deps)` 才能识别「前驱未完成且已过期」。
  // 早先这里硬编码 deps: [] 等于把依赖图丢掉，阻塞分永远只会来自
  // status=blocked 的手动标记，健康度看起来比实际好。
  // 只保留组内的边：跨组 dependsOnId 不该参与本组判定。
  const depRows = rows.length
    ? await db
        .select({ taskId: taskDeps.taskId, dependsOnId: taskDeps.dependsOnId })
        .from(taskDeps)
        .where(inArray(taskDeps.taskId, rows.map((t) => t.id)))
    : [];
  const taskIdSet = new Set(rows.map((t) => t.id));
  const depsByTask = new Map<number, string[]>();
  for (const d of depRows) {
    if (!taskIdSet.has(d.dependsOnId)) continue;
    depsByTask.set(d.taskId, [...(depsByTask.get(d.taskId) ?? []), String(d.dependsOnId)]);
  }

  return rows.map((t) => ({
    id: String(t.id),
    title: t.title,
    deps: depsByTask.get(t.id) ?? [],
    est_hours: Number(t.estHours),
    status: t.status,
    due_at: t.dueAt ? t.dueAt.toISOString() : null,
    skills: [] as string[],
    assignee_id: leadByTask.get(t.id) ?? null,
    remaining_hours: t.actualHours != null ? null : Number(t.estHours),
    deliverable_type: t.deliverableType
  }));
}

/**
 * 各成员在本组最近一条进度信号时间（失联判定）。
 *
 * 必须按 groupId 收窄：progress_signals 是人 × 组的流水，同一个学生可能同时在
 * 两门课里。早先只按 userId 取 max(observed_at)，他在别的课程做的活会被算成
 * 「本组最近有进度」，把失联信号抹掉，健康度虚高。
 */
async function loadLastSignals(groupId: number, userIds: number[]) {
  if (userIds.length === 0) return {};
  const rows = await db
    .select({
      userId: progressSignals.userId,
      last: sql<string>`max(${progressSignals.observedAt})`.as('last')
    })
    .from(progressSignals)
    .where(and(eq(progressSignals.groupId, groupId), inArray(progressSignals.userId, userIds)))
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
 * 计算小组健康度（只算不写库）。
 * 与 computeGroupHealth 拆开的原因：阻塞项查询是**读路径**，不能顺手插快照污染趋势；
 * 只有显式重算入口（computeGroupHealth）才落库。
 */
async function computeHealthDetail(groupId: number) {
  const members = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), isNull(groupMembers.leftAt)));
  const memberIds = members.map((m) => m.userId);

  const taskRows = await loadGroupTasks(groupId);
  const lastSignals = await loadLastSignals(groupId, memberIds);

  const detail = await callAlgo<AlgoHealth>(
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
  const onTrack = openTasks.filter((t) => !detail.blocked_tasks.includes(t.id)).length;
  const onTrackRatio = openTasks.length ? onTrack / openTasks.length : 1;

  return { detail, onTrackRatio };
}

/**
 * 计算并落库小组健康度（规格书 B-10 / S4.4）。
 * 三维 + 诊断条目；快照供教师端预警中心与趋势图使用。
 */
export async function computeGroupHealth(groupId: number) {
  const { detail, onTrackRatio } = await computeHealthDetail(groupId);

  const [snapshot] = await db
    .insert(groupHealthSnapshots)
    .values({
      groupId,
      blockedScore: String(detail.blocked_score),
      idleScore: String(detail.idle_score),
      overloadScore: String(detail.overload_score),
      onTrackRatio: String(onTrackRatio),
      criticalDelayDays: '0',
      diagnosis: detail.diagnosis
    })
    .returning();

  return { snapshot, detail };
}

/** 小组最新健康度 + 历史序列。 */
export async function getGroupHealth(groupId: number) {
  const latest = await db
    .select()
    .from(groupHealthSnapshots)
    .where(eq(groupHealthSnapshots.groupId, groupId))
    .orderBy(desc(groupHealthSnapshots.snapshotAt))
    .limit(1);
  // 趋势图要「最近 30 条」而不是「最旧 30 条」——先按时间倒序取最新的，
  // 再反转成时间正序给图表，否则重算 30 次后曲线就冻在最初那段。
  const recent = await db
    .select()
    .from(groupHealthSnapshots)
    .where(eq(groupHealthSnapshots.groupId, groupId))
    .orderBy(desc(groupHealthSnapshots.snapshotAt))
    .limit(30);
  const history = recent.slice().reverse();
  return { latest: latest[0] ?? null, history };
}

/**
 * 快照新鲜度阈值：超过这个时长没重算，教师端必须标明「数据是旧的」。
 * 健康度是**快照**，不是实时值——库里只有上次重算那一刻的状态。
 */
export const SNAPSHOT_STALE_HOURS = 24;

export type SnapshotFreshness = {
  /** 快照生成时间；null 表示这个组从来没算过 */
  snapshotAt: Date | null;
  /** 距今小时数（取整）；null 表示无快照 */
  ageHours: number | null;
  /** 无快照 → 'missing'；超阈值 → 'stale'；否则 'fresh' */
  state: 'fresh' | 'stale' | 'missing';
};

/** 计算快照新鲜度，供 API 与页面共用同一套判断（避免各页面自己猜）。 */
export function describeSnapshotFreshness(
  snapshotAt: Date | null | undefined,
  now: Date = new Date()
): SnapshotFreshness {
  if (!snapshotAt) return { snapshotAt: null, ageHours: null, state: 'missing' };
  const ageHours = Math.floor((now.getTime() - snapshotAt.getTime()) / 3_600_000);
  return {
    snapshotAt,
    ageHours,
    state: ageHours >= SNAPSHOT_STALE_HOURS ? 'stale' : 'fresh'
  };
}

/** 全班健康度总览（教师端热力图）。 */
export async function getCourseHealthOverview(courseId: number) {
  const groupRows = await db
    .select({ id: groups.id, name: groups.name, status: groups.status })
    .from(groups)
    .where(eq(groups.courseId, courseId))
    .orderBy(groups.id);

  // 一次取回本课所有快照里的「每组最新一条」，而不是每组问一次库（N+1）。
  const snapshots = groupRows.length
    ? await db
        .select()
        .from(groupHealthSnapshots)
        .where(
          inArray(
            groupHealthSnapshots.groupId,
            groupRows.map((g) => g.id)
          )
        )
        .orderBy(desc(groupHealthSnapshots.snapshotAt))
    : [];

  const latestByGroup = new Map<number, (typeof snapshots)[number]>();
  for (const s of snapshots) {
    if (!latestByGroup.has(s.groupId)) latestByGroup.set(s.groupId, s);
  }

  const now = new Date();
  return groupRows.map((g) => {
    const latest = latestByGroup.get(g.id) ?? null;
    const freshness = describeSnapshotFreshness(latest?.snapshotAt, now);
    return {
      groupId: g.id,
      name: g.name,
      groupStatus: g.status,
      // 没有快照就是 null，不要用 100 分假装健康
      overall: latest ? overallOf(latest) : null,
      blocked: latest ? Number(latest.blockedScore) : null,
      idle: latest ? Number(latest.idleScore) : null,
      overload: latest ? Number(latest.overloadScore) : null,
      diagnosis: (latest?.diagnosis as string[] | null) ?? null,
      snapshotAt: freshness.snapshotAt,
      snapshotAgeHours: freshness.ageHours,
      freshness: freshness.state
    };
  });
}

function overallOf(s: typeof groupHealthSnapshots.$inferSelect): number {
  return Math.round(
    0.4 * Number(s.blockedScore) + 0.3 * Number(s.idleScore) + 0.3 * Number(s.overloadScore)
  );
}

/** 预警判定：综合分低于 80，或带有系统诊断。未算过快照的组不算预警（它没有分数）。 */
function isAlerting(g: { overall: number | null; diagnosis: string[] | null }): boolean {
  return g.overall !== null && (g.overall < 80 || (g.diagnosis?.length ?? 0) > 0);
}

/** 预警中心：全班有待处理诊断的小组（健康度 < 80 或 diagnosis 非空）。 */
export async function getCourseAlerts(courseId: number) {
  const overview = await getCourseHealthOverview(courseId);
  return overview.filter(isAlerting).sort((a, b) => (a.overall ?? 100) - (b.overall ?? 100));
}

/**
 * 预警中心的覆盖面统计。
 *
 * 预警列表只包含「算过且有问题」的组，光看列表会以为其余小组都健康；
 * 实际可能有一半小组根本没算过快照。页面必须能说出这两个数字，
 * 否则「没有预警」= 「没算过」被当成好消息。
 */
export async function getCourseAlertCoverage(courseId: number) {
  const overview = await getCourseHealthOverview(courseId);
  return coverageOf(overview);
}

type Overview = Awaited<ReturnType<typeof getCourseHealthOverview>>;

function coverageOf(overview: Overview) {
  return {
    total: overview.length,
    neverComputed: overview.filter((g) => g.freshness === 'missing').length,
    stale: overview.filter((g) => g.freshness === 'stale').length,
    alerting: overview.filter(isAlerting).length
  };
}

/**
 * 预警列表 + 覆盖面一次算完。
 * 两个入口（/alerts 与 /health-overview）都要这两样东西，
 * 分开调 getCourseAlerts + getCourseAlertCoverage 会把同一份总览查两遍。
 */
export async function getCourseAlertSummary(courseId: number) {
  const overview = await getCourseHealthOverview(courseId);
  return {
    groups: overview,
    coverage: coverageOf(overview),
    alerts: overview.filter(isAlerting).sort((a, b) => (a.overall ?? 100) - (b.overall ?? 100))
  };
}

/**
 * 阻塞项清单（预警详情用）。
 * 纯读路径：只重算、不落库——阻塞项是「现在的事实」，不该被写进健康度趋势快照。
 * 需要快照请走 computeGroupHealth（POST /api/groups/[id]/health）。
 */
export async function getGroupBlockers(groupId: number) {
  const { detail } = await computeHealthDetail(groupId);
  return detail.blocked_tasks;
}
