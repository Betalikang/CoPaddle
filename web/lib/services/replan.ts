import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db/drizzle';
import { courseTeacherId, groupMemberIds, notify } from './notifications';
import {
  groupMembers,
  groups,
  replanEvents,
  replanOptions,
  taskAssignments,
  tasks,
  users
} from '../db/schema';

/**
 * 滚动重规划（规格书 B-12 / S4.5）：产品真正的护城河。
 * 触发判定（关键路径延误 / 成员失联 / 返工超限 / 截止变更 / 手动）→
 * 三方案纯算法生成（排序贪心，不用大模型）+ 模板拼装代价说明。
 */

type TriggerType = 'critical_delay' | 'member_idle' | 'rework_overflow' | 'deadline_changed' | 'manual';

const TRIGGER_LABEL: Record<TriggerType, string> = {
  critical_delay: '关键路径延误',
  member_idle: '成员失联',
  rework_overflow: '返工超限',
  deadline_changed: '截止变更',
  manual: '手动触发'
};

/** 交付物类型权重（越低越可砍）。 */
const TYPE_WEIGHT: Record<string, number> = {
  slide: 0.2,
  figure: 0.4,
  table: 0.5,
  document: 0.7,
  dataset: 0.8,
  code: 0.9
};

const TYPE_LABEL: Record<string, string> = {
  document: '文档',
  figure: '图表',
  table: '表格',
  code: '代码',
  slide: '演示',
  dataset: '数据集'
};

type MemberLoad = {
  id: number;
  name: string | null;
  skills: Record<string, number>;
  loadRatio: number;
  openHours: number;
};

/** 组内成员负载（剩余工时 / 一周可投入 42h）。 */
async function loadMemberLoad(groupId: number): Promise<MemberLoad[]> {
  const members = await db
    .select({ userId: groupMembers.userId, name: users.name })
    .from(groupMembers)
    .innerJoin(users, eq(groupMembers.userId, users.id))
    .where(and(eq(groupMembers.groupId, groupId), isNull(groupMembers.leftAt)));

  const taskRows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.groupId, groupId), isNull(tasks.deletedAt)));
  const assignRows = taskRows.length
    ? await db
        .select()
        .from(taskAssignments)
        .where(inArray(taskAssignments.taskId, taskRows.map((t) => t.id)))
    : [];

  const hoursByUser = new Map<number, number>();
  for (const a of assignRows) {
    if (a.raci !== 'lead') continue;
    const t = taskRows.find((x) => x.id === a.taskId);
    if (!t || t.status === 'done' || t.status === 'cancelled') continue;
    hoursByUser.set(a.userId, (hoursByUser.get(a.userId) ?? 0) + Number(t.estHours));
  }

  return members.map((m) => {
    const openHours = hoursByUser.get(m.userId) ?? 0;
    return {
      id: m.userId,
      name: m.name,
      skills: {},
      loadRatio: Math.min(openHours / 42, 1),
      openHours
    };
  });
}

/**
 * 触发重规划并生成决策包（三方案 + 代价说明）。
 * 返回事件 id 与方案列表；采纳由 adoptOption 执行。
 */
export async function triggerReplan(
  groupId: number,
  triggerType: TriggerType,
  input: { triggerTaskId?: number; delayDays?: number; actorId: number }
) {
  const [groupRow] = await db
    .select({ courseId: groups.courseId })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  if (!groupRow) return { error: '小组不存在' as const };
  const taskRows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.groupId, groupId), isNull(tasks.deletedAt)))
    .orderBy(asc(tasks.orderIndex));
  const members = await loadMemberLoad(groupId);
  // 触发任务现主责人（重新分配时排除）
  let triggerLead: number | null = null;
  if (input.triggerTaskId) {
    const [leadRow] = await db
      .select({ userId: taskAssignments.userId })
      .from(taskAssignments)
      .where(
        and(
          eq(taskAssignments.taskId, input.triggerTaskId),
          eq(taskAssignments.raci, 'lead')
        )
      )
      .limit(1);
    triggerLead = leadRow?.userId ?? null;
  }

  // ---- 触发判定 ----
  // 显式调用即认为条件已成立（critical_delay 再核对任务是否真延误）
  const settings = { delayTriggerDays: 2, idleTriggerDays: 3 };
  void settings.idleTriggerDays;
  let shouldTrigger = triggerType === 'manual';
  const triggerTask = input.triggerTaskId
    ? taskRows.find((t) => t.id === input.triggerTaskId)
    : undefined;

  if (triggerType === 'critical_delay' && triggerTask) {
    const lateDays =
      triggerTask.dueAt && triggerTask.status !== 'done'
        ? Math.max(0, Math.floor((Date.now() - triggerTask.dueAt.getTime()) / 86400000))
        : 0;
    shouldTrigger = lateDays >= settings.delayTriggerDays;
  } else if (
    triggerType === 'member_idle' ||
    triggerType === 'rework_overflow' ||
    triggerType === 'deadline_changed'
  ) {
    shouldTrigger = true;
  } else if (triggerType === 'critical_delay') {
    // 无触发任务时按 delayDays 语义放行（演示/手动补偿）
    shouldTrigger = (input.delayDays ?? 0) >= settings.delayTriggerDays;
  }

  if (!shouldTrigger) {
    return { needConfirm: false as const, triggered: false as const, reason: '未达到触发阈值' };
  }

  // ---- 生成事件 + 三方案 ----
  const options = buildOptions(taskRows, members, triggerTask, input.delayDays ?? 1, triggerLead);

  return db.transaction(async (tx) => {
    const [event] = await tx
      .insert(replanEvents)
      .values({
        groupId,
        triggerType,
        triggerTaskId: input.triggerTaskId ?? null,
        triggerPayload: {
          trigger_label: TRIGGER_LABEL[triggerType],
          delay_days: input.delayDays ?? 1,
          open_tasks: taskRows.filter((t) => t.status !== 'done').length
        },
        status: 'pending'
      })
      .returning();

    for (const opt of options) {
      await tx.insert(replanOptions).values({
        eventId: event.id,
        label: opt.label,
        action: opt.action,
        payload: opt.payload,
        costSummary: opt.cost_summary,
        estImpactDays: String(opt.est_impact_days)
      });
    }
    // 通知：重规划待决策 → 队长（紧迫）；涉教师授权的知会教师
    const members = await groupMemberIds(groupId);
    const link = `/dashboard/courses/${groupRow.courseId}/replans`;
    await notify(members, {
      type: 'replan_pending',
      title: '重规划决策包待处理',
      body: `${TRIGGER_LABEL[triggerType]}触发，已生成三方案与代价说明，请及时决策。`,
      link,
      priority: 'urgent',
      groupId
    });
    const teacherId = await courseTeacherId(groupRow.courseId);
    if (teacherId) {
      await notify([teacherId], {
        type: 'replan_pending',
        title: '有小组触发重规划',
        body: '「缩减范围/组间补位」方案需要你授权。',
        link,
        priority: 'normal',
        groupId
      });
    }
    return { triggered: true as const, eventId: event.id };
  });
}

function buildOptions(
  taskRows: (typeof tasks.$inferSelect)[],
  members: MemberLoad[],
  triggerTask: (typeof tasks.$inferSelect) | undefined,
  delayDays: number,
  triggerLead: number | null
) {
  // ---- 方案 A：重新分配（只转移不新增）----
  const redistribute: Record<string, unknown>[] = [];
  if (triggerTask) {
    // 排除现主责人，按负载从低到高取最空的成员
    const candidates = members
      .filter((m) => m.id !== triggerLead)
      .sort((a, b) => a.loadRatio - b.loadRatio);
    const half = Number(triggerTask.estHours) / 2;
    for (const [i, cand] of candidates.slice(0, 2).entries()) {
      redistribute.push({
        task_id: triggerTask.id,
        task_code: triggerTask.code,
        chunk: i === 0 ? '前半' : '后半',
        hours: Math.round(half * 10) / 10,
        to_member: cand.id,
        to_member_name: cand.name ?? `#${cand.id}`,
        note: `按空闲度选择（当前负载 ${(cand.loadRatio * 100).toFixed(0)}%）`
      });
    }
  }

  // ---- 方案 B：缩减范围（低权重交付项）----
  const scopeCut: Record<string, unknown>[] = [];
  for (const t of taskRows) {
    if (t.status === 'done' || t.status === 'cancelled') continue;
    const w = TYPE_WEIGHT[t.deliverableType] ?? 0.6;
    if (w <= 0.5) {
      scopeCut.push({
        task_id: t.id,
        task_code: t.code,
        title: t.title,
        deliverable_type: t.deliverableType,
        est_hours: Number(t.estHours),
        impact: `砍掉可节省约 ${Number(t.estHours).toFixed(0)} 工时；${TYPE_LABEL[t.deliverableType] ?? t.deliverableType}对终稿影响有限。必须由教师确认。`
      });
    }
  }

  // ---- 方案 C：组间补位（需要其他组数据；此处生成待授权占位）----
  const borrow: Record<string, unknown>[] = [];

  const options = [
    {
      label: '方案A · 重新分配',
      action: 'redistribute',
      payload: redistribute,
      cost_summary: redistribute.length
        ? `工作量变化：${redistribute.map((r) => `${r.to_member_name} +${r.hours}h`).join('、')}。任务总量不变，仅转移子块。预计影响 ${delayDays} 天。`
        : '组内没有可转移的空档成员。',
      est_impact_days: redistribute.length ? 0.5 : 0
    },
    {
      label: '方案B · 缩减范围',
      action: 'scope_cut',
      payload: scopeCut,
      cost_summary: scopeCut.length
        ? `可砍 ${scopeCut.length} 项，节省约 ${scopeCut.reduce((s, r) => s + Number(r.est_hours), 0).toFixed(0)} 工时。必须由教师确认，队长无权单独决定。`
        : '没有可缩减的低权重交付项。',
      est_impact_days: scopeCut.length ? 1 : 0
    },
    {
      label: '方案C · 组间补位',
      action: 'borrow_member',
      payload: borrow,
      cost_summary: '需要教师授权：从健康度 > 80 且负载 < 60% 的其他小组借调技能匹配成员，并通知两个小组的队长。',
      est_impact_days: 2
    }
  ];
  return options;
}

/** 事件详情 + 三方案对比。 */
export async function getReplanEvent(eventId: number) {
  const [event] = await db
    .select()
    .from(replanEvents)
    .where(eq(replanEvents.id, eventId))
    .limit(1);
  if (!event) return null;
  const options = await db
    .select()
    .from(replanOptions)
    .where(eq(replanOptions.eventId, eventId))
    .orderBy(replanOptions.id);
  return { event, options };
}

/** 事件 + 内嵌三方案（工作台列表直接消费）。 */
async function withOptions<T extends { id: number }>(events: T[]) {
  if (events.length === 0) return events.map((e) => ({ ...e, options: [] as (typeof replanOptions.$inferSelect)[] }));
  const opts = await db
    .select()
    .from(replanOptions)
    .where(inArray(replanOptions.eventId, events.map((e) => e.id)))
    .orderBy(replanOptions.id);
  return events.map((e) => ({
    ...e,
    options: opts.filter((o) => o.eventId === e.id)
  }));
}

/** 某组的重规划事件（含三方案）。 */
export async function listReplanEvents(groupId: number) {
  const rows = await db
    .select({
      event: replanEvents,
      groupName: groups.name
    })
    .from(replanEvents)
    .leftJoin(groups, eq(replanEvents.groupId, groups.id))
    .where(eq(replanEvents.groupId, groupId))
    .orderBy(replanEvents.createdAt);
  return withOptions(rows.map((r) => ({ ...r.event, groupName: r.groupName })));
}

/**
 * 课程级重规划事件（重规划中心默认视图）。
 * 教师/助教看全班；队长/队员只看本组，避免整页落在无事件的第 0 组上。
 */
export async function listCourseReplanEvents(
  courseId: number,
  userId: number,
  role: 'teacher' | 'assistant' | 'captain' | 'member'
) {
  let groupIds: number[] | null = null;
  if (role === 'captain' || role === 'member') {
    const mine = await db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .innerJoin(groups, eq(groupMembers.groupId, groups.id))
      .where(
        and(
          eq(groups.courseId, courseId),
          eq(groupMembers.userId, userId),
          isNull(groupMembers.leftAt),
          eq(groups.status, 'active')
        )
      );
    groupIds = mine.map((m) => m.groupId);
    if (groupIds.length === 0) return [];
  }

  const rows = await db
    .select({
      event: replanEvents,
      groupName: groups.name
    })
    .from(replanEvents)
    .innerJoin(groups, eq(replanEvents.groupId, groups.id))
    .where(
      groupIds
        ? and(eq(groups.courseId, courseId), inArray(replanEvents.groupId, groupIds))
        : eq(groups.courseId, courseId)
    )
    .orderBy(replanEvents.createdAt);
  return withOptions(rows.map((r) => ({ ...r.event, groupName: r.groupName })));
}

/**
 * 采纳方案并执行（规格书 B-12 adopt）：
 * - redistribute：改 task_assignments（转移主责）
 * - scope_cut：任务标记 cancelled
 * - borrow_member：记录 payload，等待教师授权确认
 */
export async function adoptOption(
  eventId: number,
  optionId: number,
  actorId: number
) {
  const [event] = await db
    .select()
    .from(replanEvents)
    .where(eq(replanEvents.id, eventId))
    .limit(1);
  if (!event) return { error: '事件不存在' as const };
  if (event.status !== 'pending') {
    return { error: '该事件已处理' as const };
  }

  const [option] = await db
    .select()
    .from(replanOptions)
    .where(eq(replanOptions.id, optionId))
    .limit(1);
  if (!option || option.eventId !== eventId) {
    return { error: '方案不存在' as const };
  }

  return db.transaction(async (tx) => {
    const payload = (option.payload ?? []) as Record<string, unknown>[];

    if (option.action === 'redistribute') {
      for (const item of payload) {
        const taskId = Number(item.task_id);
        const toMember = Number(item.to_member);
        if (!taskId || !toMember) continue;
        // 取消原 lead 指派，设置新 lead（保留历史：原指派 left 语义用删除+插入表达）
        await tx
          .delete(taskAssignments)
          .where(and(eq(taskAssignments.taskId, taskId), eq(taskAssignments.raci, 'lead')));
        await tx.insert(taskAssignments).values({
          taskId,
          userId: toMember,
          raci: 'lead',
          assignedBy: actorId
        });
      }
    } else if (option.action === 'scope_cut') {
      for (const item of payload) {
        const taskId = Number(item.task_id);
        if (!taskId) continue;
        await tx
          .update(tasks)
          .set({ status: 'cancelled' })
          .where(eq(tasks.id, taskId));
      }
    }

    await tx
      .update(replanEvents)
      .set({
        status: 'adopted',
        adoptedOptionId: optionId,
        handledBy: actorId,
        handledAt: new Date()
      })
      .where(eq(replanEvents.id, eventId));

    return { ok: true as const, action: option.action };
  });
}

/** 拒绝方案（必须填理由，进审计）。 */
export async function rejectEvent(eventId: number, actorId: number, reason: string) {
  const [existing] = await db
    .select()
    .from(replanEvents)
    .where(eq(replanEvents.id, eventId))
    .limit(1);
  if (!existing) return { error: '事件不存在' as const };
  const [event] = await db
    .update(replanEvents)
    .set({
      status: 'rejected',
      handledBy: actorId,
      handledAt: new Date(),
      triggerPayload: { ...(existing.triggerPayload ?? {}), reject_reason: reason }
    })
    .where(eq(replanEvents.id, eventId))
    .returning();
  return { event };
}
