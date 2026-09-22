import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/drizzle';
import { aiCallLogs, auditLogs, courses, groupMembers, notifications, notificationSettings, users } from '../db/schema';

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

/** 审计流水（教师：按对象与时间筛选）。 */
export async function listAuditLogs(opts: { targetType?: string; limit?: number } = {}) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const query = db
    .select({
      log: auditLogs,
      actor: { id: users.id, name: users.name, email: users.email }
    })
    .from(auditLogs)
    .innerJoin(users, eq(auditLogs.actorId, users.id))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
  const rows = opts.targetType
    ? await query.where(eq(auditLogs.targetType, opts.targetType))
    : await query;
  return rows.map((r) => ({ ...r.log, actor: r.actor }));
}

/** AI 调用日志（教师：成本监控）。 */
export async function listAiCallLogs(limit = 50) {
  return db
    .select()
    .from(aiCallLogs)
    .orderBy(desc(aiCallLogs.createdAt))
    .limit(Math.min(limit, 200));
}
