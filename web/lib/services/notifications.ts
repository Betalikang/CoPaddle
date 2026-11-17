import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/drizzle';
import {
  aiCallLogs,
  artifacts,
  auditLogs,
  conflicts,
  contracts,
  contributionSnapshots,
  courseMemberships,
  courses,
  groupMembers,
  groupingPlans,
  groupingRuns,
  groups,
  notifications,
  notificationSettings,
  peerReviewRounds,
  replanEvents,
  tasks,
  users
} from '../db/schema';

/**
 * 通知（规格书 B-16 / S4.9 节选）：把「不好意思说的话」交给中立的系统。
 * S6 落地最关键的两条：重规划待决策 → 队长；教师终审完成 → 全组。
 */

type NotifyInput = {
  type: string;
  title: string;
  body?: string;
  link?: string;
  channel?: 'inapp' | 'email' | 'wechat';
  priority?: 'low' | 'normal' | 'urgent';
  courseId?: number;
  groupId?: number;
};

/** 给一批用户发通知（站内信；邮件/微信通道为记录，S6 不实际发送）。 */
export async function notify(userIds: number[], input: NotifyInput) {
  const ids = [...new Set(userIds)].filter((x) => Number.isFinite(x) && x > 0);
  if (ids.length === 0) return;

  // 尊重免打扰设置
  const muted = await db
    .select({ userId: notificationSettings.userId, muteTypes: notificationSettings.muteTypes })
    .from(notificationSettings)
    .where(inArray(notificationSettings.userId, ids));
  const mutedMap = new Map(muted.map((m) => [m.userId, m.muteTypes ?? []]));

  const rows = ids
    .filter((uid) => !(mutedMap.get(uid) ?? []).includes(input.type))
    .map((uid) => ({
      userId: uid,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
      channel: input.channel ?? 'inapp',
      priority: input.priority ?? 'normal',
      courseId: input.courseId ?? null,
      groupId: input.groupId ?? null
    }));
  if (rows.length) {
    await db.insert(notifications).values(rows);
  }
}

/** 小组全体成员 id（在册）。 */
export async function groupMemberIds(groupId: number): Promise<number[]> {
  const rows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), isNull(groupMembers.leftAt)));
  return rows.map((r) => r.userId);
}

/** 课程教师 id。 */
export async function courseTeacherId(courseId: number): Promise<number | null> {
  const [c] = await db
    .select({ teacherId: courses.teacherId })
    .from(courses)
    .where(eq(courses.id, courseId))
    .limit(1);
  return c?.teacherId ?? null;
}

/** 我的通知列表（分页 + 类型筛选）。 */
export async function listMyNotifications(userId: number, opts: { type?: string; limit?: number } = {}) {
  const limit = Math.min(opts.limit ?? 30, 100);
  const rows = await db
    .select()
    .from(notifications)
    .where(
      opts.type
        ? and(eq(notifications.userId, userId), eq(notifications.type, opts.type))
        : eq(notifications.userId, userId)
    )
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
  const [unread] = await db
    .select({ n: sql<number>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return { items: rows, unread: Number(unread?.n ?? 0) };
}

export async function markRead(userId: number, ids: number[] | 'all') {
  if (ids === 'all') {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return { ok: true };
  }
  if (ids.length) {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), inArray(notifications.id, ids)));
  }
  return { ok: true };
}

export async function getMyNotificationSettings(userId: number) {
  const [row] = await db
    .select()
    .from(notificationSettings)
    .where(eq(notificationSettings.userId, userId))
    .limit(1);
  return row ?? null;
}

export async function updateMyNotificationSettings(
  userId: number,
  patch: { emailEnabled?: boolean; wechatEnabled?: boolean; muteTypes?: string[]; digestMode?: 'instant' | 'daily' }
) {
  const [row] = await db
    .insert(notificationSettings)
    .values({ userId, ...patch })
    .onConflictDoUpdate({
      target: notificationSettings.userId,
      set: { ...patch, updatedAt: new Date() }
    })
    .returning();
  return row;
}

/**
 * 审计（规格书 S7.3）：调分、改归属、删任务、解散小组、锁定终审五类
 * 操作必须写 audit_logs，含前后值。
 */
export async function logAudit(input: {
  actorId: number;
  actorRole?: string;
  action: string;
  targetType?: string;
  targetId?: number;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}) {
  await db.insert(auditLogs).values({
    actorId: input.actorId,
    actorRole: input.actorRole ?? null,
    action: input.action,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    before: input.before ?? null,
    after: input.after ?? null
  });
}

/** 审计流水（教师：按对象与时间筛选）。
 *
 * audit_logs 表本身没有 course_id，所以只能按 target 反查课程。这里对每种
 * target_type 做一次批量解析，再把不属于本教师课程的行剔掉——否则任一教师
 * 都能看到全站（含别门课学生姓名、邮箱）的调分/删任务流水。
 */
export async function listAuditLogs(
  opts: { targetType?: string; limit?: number; courseIds?: number[]; actorIds?: number[] } = {}
) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const scoped = Array.isArray(opts.courseIds);
  // 过滤发生在内存里，所以按课程过滤时多取一些再截断
  const fetchLimit = scoped ? 200 : limit;
  const base = db
    .select({
      log: auditLogs,
      actor: { id: users.id, name: users.name, email: users.email }
    })
    .from(auditLogs)
    .innerJoin(users, eq(auditLogs.actorId, users.id))
    .orderBy(desc(auditLogs.createdAt))
    .limit(fetchLimit);
  const rows = opts.targetType
    ? await base.where(eq(auditLogs.targetType, opts.targetType))
    : await base;

  if (!scoped) return rows.map((r) => ({ ...r.log, actor: r.actor }));

  const allowed = new Set(opts.courseIds ?? []);
  const actorSet = new Set(opts.actorIds ?? []);
  const courseOf = await resolveAuditTargetCourses(
    rows.map((r) => ({ targetType: r.log.targetType, targetId: r.log.targetId }))
  );

  return rows
    .filter((r) => {
      const key = `${r.log.targetType ?? ''}:${r.log.targetId ?? ''}`;
      const courseId = courseOf.get(key);
      if (courseId !== undefined) return allowed.has(courseId);
      // 解析不到目标（老数据/自定义 target）：退回按「操作人是否在我的课上」判断
      return actorSet.has(r.actor.id);
    })
    .slice(0, limit)
    .map((r) => ({ ...r.log, actor: r.actor }));
}

/** 审计目标 → 所属课程 id（批量，每类目标一次查询）。 */
async function resolveAuditTargetCourses(
  rows: { targetType: string | null; targetId: number | null }[]
): Promise<Map<string, number>> {
  const byType = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.targetType || r.targetId === null) continue;
    const list = byType.get(r.targetType) ?? [];
    list.push(r.targetId);
    byType.set(r.targetType, list);
  }

  const result = new Map<string, number>();
  const put = (type: string, id: number, courseId: number | null) => {
    if (courseId !== null) result.set(`${type}:${id}`, courseId);
  };

  const ids = (type: string) => byType.get(type) ?? [];

  const groupScoped: { type: string; run: (list: number[]) => Promise<{ id: number; courseId: number | null }[]> }[] = [
    {
      type: 'task',
      run: (list) =>
        db
          .select({ id: tasks.id, courseId: groups.courseId })
          .from(tasks)
          .innerJoin(groups, eq(groups.id, tasks.groupId))
          .where(inArray(tasks.id, list))
    },
    {
      type: 'contribution_snapshot',
      run: (list) =>
        db
          .select({ id: contributionSnapshots.id, courseId: groups.courseId })
          .from(contributionSnapshots)
          .innerJoin(groups, eq(groups.id, contributionSnapshots.groupId))
          .where(inArray(contributionSnapshots.id, list))
    },
    {
      type: 'artifact',
      run: (list) =>
        db
          .select({ id: artifacts.id, courseId: groups.courseId })
          .from(artifacts)
          .innerJoin(groups, eq(groups.id, artifacts.groupId))
          .where(inArray(artifacts.id, list))
    },
    {
      type: 'contract',
      run: (list) =>
        db
          .select({ id: contracts.id, courseId: groups.courseId })
          .from(contracts)
          .innerJoin(groups, eq(groups.id, contracts.groupId))
          .where(inArray(contracts.id, list))
    },
    {
      type: 'conflict',
      run: (list) =>
        db
          .select({ id: conflicts.id, courseId: groups.courseId })
          .from(conflicts)
          .innerJoin(groups, eq(groups.id, conflicts.groupId))
          .where(inArray(conflicts.id, list))
    },
    {
      type: 'replan_event',
      run: (list) =>
        db
          .select({ id: replanEvents.id, courseId: groups.courseId })
          .from(replanEvents)
          .innerJoin(groups, eq(groups.id, replanEvents.groupId))
          .where(inArray(replanEvents.id, list))
    },
    {
      type: 'grouping_plan',
      run: (list) =>
        db
          .select({ id: groupingPlans.id, courseId: groupingRuns.courseId })
          .from(groupingPlans)
          .innerJoin(groupingRuns, eq(groupingRuns.id, groupingPlans.runId))
          .where(inArray(groupingPlans.id, list))
    }
  ];

  for (const { type, run } of groupScoped) {
    const list = ids(type);
    if (list.length === 0) continue;
    for (const row of await run(list)) put(type, row.id, row.courseId);
  }

  const groupIds = ids('group');
  if (groupIds.length) {
    const rows2 = await db
      .select({ id: groups.id, courseId: groups.courseId })
      .from(groups)
      .where(inArray(groups.id, groupIds));
    for (const row of rows2) put('group', row.id, row.courseId);
  }
  const courseIds = ids('course');
  if (courseIds.length) {
    const rows2 = await db
      .select({ id: courses.id })
      .from(courses)
      .where(inArray(courses.id, courseIds));
    for (const row of rows2) put('course', row.id, row.id);
  }
  const roundIds = ids('peer_review_round');
  if (roundIds.length) {
    const rows2 = await db
      .select({ id: peerReviewRounds.id, courseId: peerReviewRounds.courseId })
      .from(peerReviewRounds)
      .where(inArray(peerReviewRounds.id, roundIds));
    for (const row of rows2) put('peer_review_round', row.id, row.courseId);
  }
  for (const type of ['enrollment', 'course_membership']) {
    const list = ids(type);
    if (list.length === 0) continue;
    const rows2 = await db
      .select({ id: courseMemberships.id, courseId: courseMemberships.courseId })
      .from(courseMemberships)
      .where(inArray(courseMemberships.id, list));
    for (const row of rows2) put(type, row.id, row.courseId);
  }

  return result;
}

/** AI 调用日志（教师：成本监控；按我教的课程过滤，ai_call_logs 自带 course_id）。 */
export async function listAiCallLogs(limit = 50, courseIds?: number[]) {
  const take = Math.min(limit, 200);
  if (Array.isArray(courseIds)) {
    if (courseIds.length === 0) return [];
    return db
      .select()
      .from(aiCallLogs)
      .where(inArray(aiCallLogs.courseId, courseIds))
      .orderBy(desc(aiCallLogs.createdAt))
      .limit(take);
  }
  return db
    .select()
    .from(aiCallLogs)
    .orderBy(desc(aiCallLogs.createdAt))
    .limit(take);
}
