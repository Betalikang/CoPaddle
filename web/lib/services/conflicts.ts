import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db/drizzle';
import {
  auditLogs,
  conflictAttributions,
  conflictResolutions,
  conflicts,
  groupMembers,
  groups,
  taskAssignments,
  taskDeps,
  taskStatusEvents,
  tasks
} from '../db/schema';
import { AlgoServiceError, callAlgo } from '@/lib/algo/client';

/** algo /internal/ai/conflict 响应（LLM 调用点 2）。 */
type AlgoConflict = {
  kind: string;
  severity: string;
  reason: string;
  suggestion: string;
  merged_text: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  /** algo 侧 LLM 不可用、用规则兜底时置 true（可选：老版本响应没有这个字段） */
  degraded?: boolean;
};

/**
 * 从 task_deps 求传递闭包，返回真正可达的下游任务 id。
 *
 * task_deps 的语义是「task_id 依赖 depends_on_id」，所以后继边是 depends_on_id → task_id。
 * 原实现把组内所有未完成任务都当成下游，「波及 N 个下游任务」是假的。
 * 用显式队列做多跳遍历，遇到环（seen）自动退避。
 */
function reachableDownstream(taskId: number, successors: Map<number, number[]>): Set<number> {
  const seen = new Set<number>();
  const queue = [...(successors.get(taskId) ?? [])];
  for (;;) {
    const next = queue.pop();
    if (next === undefined) break;
    if (next === taskId || seen.has(next)) continue;
    seen.add(next);
    for (const id of successors.get(next) ?? []) {
      if (!seen.has(id)) queue.push(id);
    }
  }
  return seen;
}

/**
 * 冲突检测（规格书 B-11 / S4.6）：
 * ① 依赖冲突（图算法，最高频）：任务 blocked/延期且存在未完成下游 → 生成冲突；
 * ② 契约冲突（规则匹配）：S5 期做依赖冲突；术语表规则匹配在 S6 期补；
 * ③ 语义冲突（LLM 调用点 2）：前置相似度筛选 0.30–0.85 由 analyze 触发，
 *    不自动批量调用（控制成本）。
 */
export async function detectConflicts(groupId: number, detectedBy = 'auto') {
  const taskRows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.groupId, groupId), isNull(tasks.deletedAt)))
    .orderBy(asc(tasks.orderIndex));
  if (taskRows.length === 0) return { created: 0 };

  const taskIds = taskRows.map((t) => t.id);

  // 依赖图：只取本组任务作为后继的边，建成 depends_on_id → [task_id] 的后继邻接表
  const depRows = await db
    .select({ taskId: taskDeps.taskId, dependsOnId: taskDeps.dependsOnId })
    .from(taskDeps)
    .where(inArray(taskDeps.taskId, taskIds));
  const successors = new Map<number, number[]>();
  for (const d of depRows) {
    const list = successors.get(d.dependsOnId);
    if (list) list.push(d.taskId);
    else successors.set(d.dependsOnId, [d.taskId]);
  }

  const created: number[] = [];

  // 已有未收尾冲突的任务（避免重复报）。
  // 'analyzing' 必须一起算：AI 归因成功后冲突会被置为 analyzing，
  // 那时再点一次「检测冲突」若只跳过 open，就会给同一个任务再插一条几乎相同的冲突，
  // 教师会看到两条一样的待处理事项，其中一条其实是同一条的副本。
  const existing = await db
    .select({ taskId: conflicts.taskId })
    .from(conflicts)
    .where(
      and(
        eq(conflicts.groupId, groupId),
        inArray(conflicts.status, ['open', 'analyzing'])
      )
    );
  const reported = new Set(existing.map((e) => e.taskId).filter((x) => x !== null));

  for (const t of taskRows) {
    if (t.status === 'done' || t.status === 'cancelled') continue;
    if (reported.has(t.id)) continue;

    // 依赖冲突：本任务延期/阻塞，且是某未完成任务的前置
    const isLate =
      t.status === 'blocked' ||
      (t.dueAt !== null && t.dueAt < new Date() && t.status !== 'done');
    if (!isLate) continue;

    // 下游 = 依赖图里真正可达的后继任务，且仍未完成/未取消（已经收尾的任务不再算受影响）
    const downstreamIds = reachableDownstream(t.id, successors);
    const downstream = taskRows.filter(
      (other) =>
        downstreamIds.has(other.id) && other.status !== 'done' && other.status !== 'cancelled'
    );
    if (downstream.length === 0) continue;

    const downstreamCodes = downstream.slice(0, 5).map((o) => o.code).join('、');
    const [conflict] = await db
      .insert(conflicts)
      .values({
        groupId,
        taskId: t.id,
        type: 'dependency',
        severity: t.status === 'blocked' ? 'high' : 'medium',
        status: 'open',
        detectedBy,
        title: `「${t.title}」${t.status === 'blocked' ? '阻塞' : '延期'}，波及 ${downstream.length} 个下游任务`,
        summary: `任务 ${t.code} 当前状态 ${t.status}${t.dueAt ? `，截止 ${t.dueAt.toLocaleDateString('zh-CN')}` : ''}；按依赖关系（task_deps 传递闭包）有 ${downstream.length} 个下游任务受影响：${downstreamCodes}${downstream.length > 5 ? ' 等' : ''}。`
      })
      .returning();
    created.push(conflict.id);
  }

  return { created: created.length };
}

/** 冲突列表（组内）。 */
export async function listConflicts(groupId: number) {
  const rows = await db
    .select()
    .from(conflicts)
    .where(eq(conflicts.groupId, groupId))
    .orderBy(desc(conflicts.detectedAt));
  return rows;
}

/** 冲突详情（含双方原文与 LLM 归因结果）。 */
export async function getConflict(conflictId: number) {
  const [conflict] = await db
    .select()
    .from(conflicts)
    .where(eq(conflicts.id, conflictId))
    .limit(1);
  if (!conflict) return null;
  const attributions = await db
    .select()
    .from(conflictAttributions)
    .where(eq(conflictAttributions.conflictId, conflictId))
    .orderBy(desc(conflictAttributions.createdAt));
  const resolutions = await db
    .select()
    .from(conflictResolutions)
    .where(eq(conflictResolutions.conflictId, conflictId))
    .orderBy(desc(conflictResolutions.resolvedAt));
  return { conflict, attributions, resolutions };
}

/**
 * LLM 调用点 2：语义冲突归因（规格书 S6.2）。
 * 调用方负责前置筛选（同一 artifact、作者不同、相似度 0.30–0.85）。
 */
export async function analyzeConflict(
  conflictId: number,
  input: { textA: string; textB: string; authorA?: string; authorB?: string; contractTerms?: { term: string; definition: string; unit: string }[] }
) {
  const [conflict] = await db
    .select()
    .from(conflicts)
    .where(eq(conflicts.id, conflictId))
    .limit(1);
  if (!conflict) throw new Error('冲突不存在');

  let result: AlgoConflict;
  try {
    result = await callAlgo<AlgoConflict>(
      '/internal/ai/conflict',
      {
        text_a: input.textA,
        text_b: input.textB,
        author_a: input.authorA ?? '',
        author_b: input.authorB ?? '',
        contract_terms: input.contractTerms ?? []
      },
      120000
    );
  } catch (err) {
    if (err instanceof AlgoServiceError) {
      // 降级：仍展示双方原文对比与契约条款，人工判断（规格书 S4.10）
      return { aiUnavailable: true as const, message: err.message };
    }
    throw err;
  }

  // algo 用规则兜底（LLM 不可用）时会带 degraded=true，或 model 为空串。
  // 兜底结果里的 kind 往往就是「无冲突」/「low」，那是「没判」而不是「判了无冲突」——
  // 直接落库会把检测不可用伪装成真实结论，所以这里不写 conflict_attributions、也不改冲突状态，
  // 而是返回 aiUnavailable 让 API 走 503（web/app/api/conflicts/[id]/route.ts 的降级分支）。
  const degraded = result.degraded === true || !result.model?.trim();
  if (degraded) {
    return {
      aiUnavailable: true as const,
      degraded: true as const,
      message: 'AI 冲突归因不可用（本次由规则兜底，未做真实语义判断），请人工对比双方原文'
    };
  }

  const [attr] = await db
    .insert(conflictAttributions)
    .values({
      conflictId,
      kind: result.kind,
      severity: result.severity,
      reason: result.reason,
      suggestion: result.suggestion,
      mergedText: result.merged_text,
      llmModel: result.model,
      promptTokens: result.prompt_tokens,
      completionTokens: result.completion_tokens
    })
    .returning();

  await db
    .update(conflicts)
    .set({ status: 'analyzing', severity: result.severity ?? conflict.severity })
    .where(eq(conflicts.id, conflictId));

  return { attribution: attr };
}

/** 按 action 判定「能真正落地什么」；判定与写库分开，避免没执行却记为已处理。 */
type ResolvePlan =
  | { kind: 'dismiss' }
  | { kind: 'reassign'; taskId: number; toUserId: number }
  | { kind: 'realign'; taskId: number; requirement: string };

/** 从 payload 取数字字段：调用方可能用 snake_case，也可能用 camelCase。 */
function readNumberField(
  payload: Record<string, unknown> | null | undefined,
  keys: string[]
): number | null {
  if (!payload) return null;
  for (const key of keys) {
    const raw = payload[key];
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/**
 * 处理冲突：就地合并 / 退回对齐契约 / 重指派 / 驳回（规格书 B-11）。
 *
 * 各动作在当前数据模型下的落地语义：
 * - dismiss（忽略）：只把冲突置为 dismissed，不改任务与契约 → applied。
 * - reassign（重指派）：把关联任务的 lead（task_assignments.raci='lead'）换成 payload.to_user_id
 *   指定的在册成员，contributor 分配不动，并写 audit_logs（改归属属五类必审）。
 *   缺少 payload.to_user_id 视为业务拒绝（返回 error → 路由 400），**绝不静默把冲突标记成已解决**。
 * - realign（退回对齐契约）：任务暂停（status='blocked'）并把对齐要求写入 blocked_reason，
 *   同时补 task_status_events 轨迹。contracts 表没有条款正文/状态列，所以不动契约本身。
 * - merge（就地合并）：冲突单只关联 task_id，契约与段落正文都不在本服务的写入范围内，
 *   AI 的 merged_text 已存在 conflict_attributions，没有可写回的承载字段
 *   → 明确拒绝（返回 error → 路由 400），不产生「记成已解决但什么都没变」的假成功。
 *
 * 所有「动作无法落地」的情况一律走 `{ error }` 分支：冲突状态保持原样，前端 readBody 抛错并显示原因。
 */
export async function resolveConflict(
  conflictId: number,
  actorId: number,
  input: { action: 'merge' | 'realign' | 'reassign' | 'dismiss'; note?: string; payload?: Record<string, unknown> }
) {
  const [conflict] = await db
    .select()
    .from(conflicts)
    .where(eq(conflicts.id, conflictId))
    .limit(1);
  if (!conflict) return { error: '冲突不存在' as const };

  const note = input.note?.trim() ?? '';
  // 冲突可以只关联到组（task_id 为空），此时显式传入 payload.task_id 也可以
  const targetTaskId = readNumberField(input.payload, ['task_id', 'taskId']) ?? conflict.taskId ?? null;

  // ---- 判定阶段：只校验，不写库 ----
  async function decide(): Promise<{ plan: ResolvePlan } | { error: string }> {
    if (input.action === 'dismiss') return { plan: { kind: 'dismiss' } };
    // 合并无处落库：宁可拒绝，也不要把冲突标成「已解决」而实际什么都没合并
    if (input.action === 'merge') {
      return { error: '当前数据模型不支持合并冲突条目，请改用「退回对齐契约」或「忽略」' };
    }

    if (targetTaskId === null) {
      return { error: '该冲突未关联具体任务，无法执行该动作（可改用「忽略」并写明处理意见）' };
    }

    if (input.action === 'reassign') {
      const toUserId = readNumberField(input.payload, ['to_user_id', 'toUserId', 'user_id', 'userId']);
      if (toUserId === null) {
        return { error: '重新指派需要先选择新的主责人（本组在册成员）' };
      }
      const [member] = await db
        .select({ userId: groupMembers.userId })
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupId, conflict.groupId),
            eq(groupMembers.userId, toUserId),
            isNull(groupMembers.leftAt)
          )
        )
        .limit(1);
      if (!member) return { error: '指定的新主责人不是本组在册成员' };
      return { plan: { kind: 'reassign', taskId: targetTaskId, toUserId } };
    }

    const [taskRow] = await db
      .select({ id: tasks.id, status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, targetTaskId))
      .limit(1);
    if (!taskRow) {
      return { error: '冲突关联的任务已不存在，无法退回对齐（可改用「忽略」并写明处理意见）' };
    }
    if (taskRow.status === 'done' || taskRow.status === 'cancelled') {
      return {
        error: `任务已${taskRow.status === 'done' ? '完成' : '取消'}，不能退回对齐（可改用「忽略」并写明处理意见）`
      };
    }
    const fromPayload =
      typeof input.payload?.requirement === 'string' ? input.payload.requirement.trim() : '';
    return {
      plan: {
        kind: 'realign',
        taskId: targetTaskId,
        requirement: note || fromPayload || '需与协作契约重新对齐后再继续'
      }
    };
  }

  const decision = await decide();
  if ('error' in decision) return { error: decision.error };
  const plan = decision.plan;

  // ---- 执行阶段：业务写入与处理记录同一个事务，避免「记成已解决但任务没动」 ----
  return db.transaction(async (tx) => {
    let appliedPayload: Record<string, unknown> | null = null;
    let effect = '';

    if (plan.kind === 'reassign') {
      const before = await tx
        .select({ userId: taskAssignments.userId })
        .from(taskAssignments)
        .where(and(eq(taskAssignments.taskId, plan.taskId), eq(taskAssignments.raci, 'lead')));
      await tx
        .delete(taskAssignments)
        .where(and(eq(taskAssignments.taskId, plan.taskId), eq(taskAssignments.raci, 'lead')));
      await tx.insert(taskAssignments).values({
        taskId: plan.taskId,
        userId: plan.toUserId,
        raci: 'lead',
        assignedBy: actorId
      });
      // 改归属属五类必审操作，审计与业务写入放在同一个事务里
      await tx.insert(auditLogs).values({
        actorId,
        action: 'conflict_reassign',
        targetType: 'task',
        targetId: plan.taskId,
        before: { lead: before.map((b) => b.userId) },
        after: { lead: plan.toUserId, conflictId }
      });
      appliedPayload = { taskId: plan.taskId, toUserId: plan.toUserId };
      effect = `已将任务 #${plan.taskId} 的主责人改为 #${plan.toUserId}`;
    } else if (plan.kind === 'realign') {
      const [taskRow] = await tx
        .select({ status: tasks.status, blockedReason: tasks.blockedReason })
        .from(tasks)
        .where(eq(tasks.id, plan.taskId))
        .limit(1);
      const blockedReason = `退回对齐契约：${plan.requirement}`;
      await tx
        .update(tasks)
        .set({ status: 'blocked', blockedReason })
        .where(eq(tasks.id, plan.taskId));
      await tx.insert(taskStatusEvents).values({
        taskId: plan.taskId,
        fromStatus: taskRow?.status ?? null,
        toStatus: 'blocked',
        actorId,
        note: `退回对齐契约（冲突 #${conflictId}）：${plan.requirement}`
      });
      await tx.insert(auditLogs).values({
        actorId,
        action: 'conflict_realign',
        targetType: 'task',
        targetId: plan.taskId,
        before: {
          status: taskRow?.status ?? null,
          blockedReason: taskRow?.blockedReason ?? null
        },
        after: { status: 'blocked', blockedReason, conflictId }
      });
      appliedPayload = { taskId: plan.taskId, requirement: plan.requirement };
      effect = `已将任务 #${plan.taskId} 退回对齐：置为阻塞并写入对齐要求`;
    } else {
      // dismiss：只忽略冲突记录，不动任务与契约
      effect = '仅忽略该冲突记录，未改动任务与契约';
    }

    const [resolution] = await tx
      .insert(conflictResolutions)
      .values({
        conflictId,
        action: input.action,
        actorId,
        note: input.note ?? null,
        // 能走到这里说明动作已真实落地，记录执行了什么（判定阶段的拒绝不会写处理记录）
        appliedPayload
      })
      .returning();

    await tx
      .update(conflicts)
      .set({
        status: input.action === 'dismiss' ? 'dismissed' : 'resolved',
        resolvedAt: new Date()
      })
      .where(eq(conflicts.id, conflictId));

    return { resolution, effect };
  });
}

/** 小组的 open 冲突数（健康度快照用）。 */
export async function countOpenConflicts(groupId: number) {
  const rows = await db
    .select({ id: conflicts.id })
    .from(conflicts)
    .where(and(eq(conflicts.groupId, groupId), eq(conflicts.status, 'open')));
  return rows.length;
}

/** 小组 id → 课程 id（API 鉴权用）。 */
export async function getGroupCourseId(groupId: number): Promise<number | null> {
  const [row] = await db
    .select({ courseId: groups.courseId })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  return row?.courseId ?? null;
}
