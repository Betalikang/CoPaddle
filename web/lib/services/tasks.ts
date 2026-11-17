import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { db } from '../db/drizzle';
import {
  Contract,
  Task,
  progressSignals,
  contractAcceptances,
  contractGlossary,
  contracts,
  groupMembers,
  groups,
  taskAssignments,
  taskDeps,
  taskPlans,
  taskStatusEvents,
  tasks
} from '../db/schema';
import {
  ChangeStatusInput,
  GeneratePlanInput,
  TASK_TRANSITIONS,
  UpdateTaskInput
} from '@/lib/validation/tasks';
import { AlgoServiceError, callAlgo } from '@/lib/algo/client';
import { groupMemberIds, notify } from './notifications';

/** algo /internal/ai/decompose 的响应（与 algo/app/schemas.py 对齐） */
type AlgoDecomposeResponse = {
  tasks: {
    id: string;
    title: string;
    deps: string[];
    est_hours: number;
    skills: string[];
    deliverable: string;
    milestone: string;
  }[];
  contract: {
    glossary: { term: string; definition: string; unit: string }[];
    interfaces: string[];
    format: string;
  } | null;
  validation_problems: string[];
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
};

/** LLM 的自由文本交付物 → deliverable_type 枚举。 */
function mapDeliverableType(text: string): string {
  const t = text ?? '';
  if (/代码|脚本|code/i.test(t)) return 'code';
  if (/数据|dataset/i.test(t)) return 'dataset';
  if (/ppt|幻灯|slide|汇报/i.test(t)) return 'slide';
  if (/图|chart|figure|可视化/i.test(t)) return 'figure';
  if (/表|table|矩阵/i.test(t)) return 'table';
  return 'document';
}

/**
 * 生成任务计划（规格书 B-08 / S6.1）：
 * LLM 拆解 → 落 task_plans + tasks + task_deps + contracts + contract_glossary。
 * validation_problems 非空时照常落库并标记 validated=false（界面高亮人工修正）。
 */
export async function generateTaskPlan(
  groupId: number,
  captainId: number,
  input: GeneratePlanInput
) {
  // 取小组人数（提示词需要）
  const [group] = await db
    .select({ id: groups.id, courseId: groups.courseId })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  if (!group) throw new Error('小组不存在');

  // 已有计划：需确认重新生成（丢弃旧计划）
  if (!input.confirmRegenerate) {
    const [existing] = await db
      .select({ id: taskPlans.id })
      .from(taskPlans)
      .where(eq(taskPlans.groupId, groupId))
      .limit(1);
    if (existing) {
      return { needConfirm: true as const };
    }
  }

  // 组内在册人数（决定任务粒度提示）
  const [sizeRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), isNull(groupMembers.leftAt)));
  const groupSize = Number(sizeRow?.n ?? 0) || 4;

  let result: AlgoDecomposeResponse;
  try {
    result = await callAlgo<AlgoDecomposeResponse>(
      '/internal/ai/decompose',
      {
        assignment_text: input.assignmentText,
        group_size: groupSize
      },
      120000 // LLM 最长 90s + 余量
    );
  } catch (err) {
    if (err instanceof AlgoServiceError) {
      // 规格书 S4.10：降级为「AI 暂不可用，可手工创建」，不阻塞队长
      return { aiUnavailable: true as const, message: err.message };
    }
    throw err;
  }

  if (!result.tasks || result.tasks.length === 0) {
    return { aiUnavailable: true as const, message: 'AI 未返回任务，可手工创建' };
  }

  return db.transaction(async (tx) => {
    // 重新生成：先删旧计划（级联 tasks/deps/assignments/events）
    await tx.delete(taskPlans).where(eq(taskPlans.groupId, groupId));
    await tx.delete(contracts).where(eq(contracts.groupId, groupId));

    const [plan] = await tx
      .insert(taskPlans)
      .values({
        groupId,
        assignmentTitle: input.assignmentTitle ?? null,
        assignmentText: input.assignmentText,
        llmModel: result.model || null,
        promptTokens: result.prompt_tokens,
        completionTokens: result.completion_tokens,
        validated: result.validation_problems.length === 0,
        validateProblems: result.validation_problems
      })
      .returning();

    // code 用 LLM 给的 id（T1/T2…），便于 deps 引用；截断防超长
    const idByCode = new Map<string, number>();
    for (const [i, t] of result.tasks.entries()) {
      const [row] = await tx
        .insert(tasks)
        .values({
          planId: plan.id,
          groupId,
          code: t.id.slice(0, 10),
          title: t.title.slice(0, 200),
          // LLM 的 deliverable 是自由文本：映射为枚举类型，原文进 description
          deliverableType: mapDeliverableType(t.deliverable),
          description: t.deliverable ? `交付物：${t.deliverable}` : null,
          milestone: (t.milestone || '').slice(0, 100) || null,
          orderIndex: i,
          estHours: String(t.est_hours),
          createdBy: captainId
        })
        .returning();
      idByCode.set(t.id, row.id);
    }

    for (const t of result.tasks) {
      const taskId = idByCode.get(t.id)!;
      for (const dep of t.deps) {
        const depId = idByCode.get(dep);
        if (depId) {
          await tx.insert(taskDeps).values({ taskId, dependsOnId: depId });
        }
      }
    }

    // 协作契约（版本 1，未发布；成员确认走 publish/accept）
    if (result.contract) {
      const [contract] = await tx
        .insert(contracts)
        .values({
          groupId,
          version: 1,
          generatedBy: 'g1',
          formatSpec: result.contract.format || null
        })
        .returning();
      for (const g of result.contract.glossary) {
        await tx.insert(contractGlossary).values({
          contractId: contract.id,
          term: g.term,
          definition: g.definition,
          unit: g.unit || null
        });
      }
    }

    // 关键路径回写（演示第 3 步加粗 + 归因关键路径信用）
    // 必须传 tx：计划与任务还没提交，走全局 db 的另一条连接读不到（首次生成读空、
    // 重新生成时被事务刚软删的旧行行锁挡住）。
    try {
      await markCriticalPath(groupId, tx);
    } catch {
      // 算法服务不可用/依赖成环时不影响计划生成（页面可手动重算）
    }
    return { planId: plan.id, problems: result.validation_problems };
  });
}

/**
 * 事务内/外通用的连接类型：只依赖 select/update，既能接全局 db（NodePgDatabase），
 * 也能接 db.transaction 的 tx（PgTransaction extends PgDatabase）。
 */
type DbConn = Pick<typeof db, 'select' | 'update'>;

/**
 * 计算关键路径并回写 tasks.on_critical_path（演示第 3 步「关键路径加粗」
 * 与归因 cp_credit 的数据来源）。任务计划生成后、依赖变更后调用。
 *
 * conn 用于事务内调用：计划写入尚未提交，走全局 db 的另一条连接既读不到
 * 未提交的任务（首次生成时任务列表为空 → 直接 return，关键路径永远为空），
 * 重新生成时又会被事务刚软删的旧行行锁挡住（应用层死锁）。事务内必须传 tx。
 */
export async function markCriticalPath(groupId: number, conn: DbConn = db) {
  const taskRows = await conn
    .select()
    .from(tasks)
    .where(and(eq(tasks.groupId, groupId), isNull(tasks.deletedAt)))
    .orderBy(asc(tasks.orderIndex));
  if (taskRows.length === 0) return { path: [] as string[], totalHours: 0 };

  const taskIds = taskRows.map((t) => t.id);
  const depRows = await conn
    .select()
    .from(taskDeps)
    .where(inArray(taskDeps.taskId, taskIds));

  // deps 挂在每个 task 上（algo TaskNode.deps）
  const depsByTask = new Map<number, string[]>();
  for (const d of depRows) {
    depsByTask.set(d.taskId, [...(depsByTask.get(d.taskId) ?? []), String(d.dependsOnId)]);
  }

  const result = await callAlgo<{
    path: string[];
    total_hours: number;
    /** 依赖成环等无法计算时由算法服务返回（字段可能不存在，按可选读取） */
    error?: string | null;
  }>(
    '/internal/graph/critical-path',
    {
      tasks: taskRows.map((t) => ({
        id: String(t.id),
        title: t.title,
        est_hours: Number(t.estHours),
        status: t.status,
        deps: depsByTask.get(t.id) ?? []
      }))
    },
    15000,
    { groupId }
  );

  // 依赖成环时不能把关键路径清零当成正常结果：清零会让 on_critical_path 全变 false、
  // 归因侧 cp_total 归零（学分被凭空抹掉）。这里直接报错并保持既有标记与 cp_total 不变，
  // 由上层提示「依赖成环，请先修正依赖」。
  const algoError = result.error?.trim();
  if (algoError) {
    throw new AlgoServiceError(`关键路径计算失败：${algoError}`);
  }

  const pathIds = new Set(result.path.map(Number));
  // 全量重置后按路径标记（避免残留）
  for (const t of taskRows) {
    const shouldBe = pathIds.has(t.id);
    if (t.onCriticalPath !== shouldBe) {
      await conn.update(tasks).set({ onCriticalPath: shouldBe }).where(eq(tasks.id, t.id));
    }
  }
  return { path: result.path, totalHours: result.total_hours };
}

/** 小组当前任务计划（含任务、依赖、指派）。 */
export async function getTaskPlan(groupId: number) {
  const [plan] = await db
    .select()
    .from(taskPlans)
    .where(eq(taskPlans.groupId, groupId))
    .orderBy(desc(taskPlans.generatedAt))
    .limit(1);
  if (!plan) return null;

  const taskRows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.groupId, groupId), isNull(tasks.deletedAt)))
    .orderBy(asc(tasks.orderIndex));

  const taskIds = taskRows.map((t) => t.id);
  const depRows = taskIds.length
    ? await db.select().from(taskDeps).where(inArray(taskDeps.taskId, taskIds))
    : [];

  const assignRows = taskIds.length
    ? await db
        .select({
          id: taskAssignments.id,
          taskId: taskAssignments.taskId,
          userId: taskAssignments.userId,
          raci: taskAssignments.raci
        })
        .from(taskAssignments)
        .where(inArray(taskAssignments.taskId, taskIds))
    : [];

  return {
    plan,
    tasks: taskRows,
    deps: depRows,
    assignments: assignRows
  };
}

export async function updateTask(taskId: number, patch: UpdateTaskInput) {
  const set: Record<string, unknown> = { ...patch };
  if (patch.dueAt !== undefined) {
    set.dueAt = patch.dueAt === null ? null : new Date(patch.dueAt);
  }
  // 兜底：没有任何列要写时 drizzle 会抛 "No values to set"，直接返回当前行
  if (Object.keys(set).length === 0) {
    const [current] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    return current;
  }
  const [row] = await db.update(tasks).set(set).where(eq(tasks.id, taskId)).returning();
  return row;
}

export async function deleteTask(taskId: number) {
  // 软删除 + 自动清理依赖边（deps 通过外键 cascade 物理清理）
  await db.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.id, taskId));
  await db.delete(taskDeps).where(or(eq(taskDeps.taskId, taskId), eq(taskDeps.dependsOnId, taskId)));
}

/**
 * 手工新建单个任务（规格书 S4.10 / B-08 的降级入口：AI 不可用时队长仍能把活拆开）。
 *
 * 为什么需要「计划」：tasks.plan_id 是 NOT NULL，任务必须挂在某个 task_plan 下。
 * 所以首次手工创建时按需建一个空计划（llmModel 为 null 以区别于 AI 拆解），
 * 已有计划则直接挂到当前计划下，不会覆盖 AI 已生成的任务。
 *
 * code 由服务端生成（T1/T2…），取当前计划内最大编号 +1：LLM 也用 T<n> 形式，
 * 手工补的任务沿用同一套编号，依赖面板里能连续引用。
 */
export async function createTask(
  groupId: number,
  actorId: number,
  input: { title: string; estHours?: number; deliverableType?: string }
) {
  const [group] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  if (!group) return { ok: false as const, reason: '小组不存在' };

  return db.transaction(async (tx) => {
    // 复用当前计划；没有就建一个「手工计划」（llmModel 留空 = 非 AI 产物）
    const [existingPlan] = await tx
      .select({ id: taskPlans.id })
      .from(taskPlans)
      .where(eq(taskPlans.groupId, groupId))
      .orderBy(desc(taskPlans.generatedAt))
      .limit(1);

    let planId = existingPlan?.id;
    if (!planId) {
      const [plan] = await tx
        .insert(taskPlans)
        .values({
          groupId,
          assignmentTitle: '手工任务',
          // 手工计划没有 AI 拆解，但后置校验问题为空 = 合法
          validated: true
        })
        .returning();
      planId = plan.id;
    }

    // 现有任务的最大序号：既决定 orderIndex，也决定新 code 的编号
    const siblings = await tx
      .select({ code: tasks.code, orderIndex: tasks.orderIndex })
      .from(tasks)
      .where(and(eq(tasks.groupId, groupId), isNull(tasks.deletedAt)));

    let maxNo = 0;
    for (const s of siblings) {
      const m = /^T(\d+)$/.exec(s.code);
      if (m) maxNo = Math.max(maxNo, Number(m[1]));
    }
    // 同计划内 code 唯一（tasks_plan_code_uniq）；被软删的同号任务也算占用，
    // 所以用 maxNo+1 而不是 siblings.length+1，避免与已存在的 T3 撞号。
    const code = `T${maxNo + 1}`;
    const orderIndex = siblings.reduce((max, s) => Math.max(max, s.orderIndex), -1) + 1;

    const [row] = await tx
      .insert(tasks)
      .values({
        planId,
        groupId,
        code,
        title: input.title.slice(0, 200),
        estHours: String(input.estHours ?? 2),
        deliverableType: input.deliverableType ?? 'document',
        orderIndex,
        createdBy: actorId
      })
      .returning();

    // 新任务可能改变关键路径，但算法服务不可用不能阻塞建任务（与 AI 拆解同样的取舍）
    try {
      await markCriticalPath(groupId, tx);
    } catch {
      // 忽略：页面可手动重算关键路径
    }
    return { ok: true as const, task: row };
  });
}

/** 加依赖（写入前环检测，成环拒绝并返回环上任务）。 */
export async function addDep(taskId: number, dependsOnId: number) {
  if (taskId === dependsOnId) {
    return { ok: false as const, reason: '任务不能依赖自己' };
  }
  // 前置必须是本组任务：跨组依赖会污染 DAG，且环检测按组遍历看不到它
  const rows = await db
    .select({ id: tasks.id, groupId: tasks.groupId })
    .from(tasks)
    .where(inArray(tasks.id, [taskId, dependsOnId]));
  const self = rows.find((r) => r.id === taskId);
  const other = rows.find((r) => r.id === dependsOnId);
  if (!self || !other) {
    return { ok: false as const, reason: '任务不存在' };
  }
  if (self.groupId !== other.groupId) {
    return { ok: false as const, reason: '只能依赖本组的任务' };
  }
  const cycle = await findCycle(taskId, dependsOnId);
  if (cycle) {
    return { ok: false as const, reason: '会形成依赖环', cycle };
  }
  await db.insert(taskDeps).values({ taskId, dependsOnId }).onConflictDoNothing();
  return { ok: true as const };
}

export async function removeDep(taskId: number, dependsOnId: number) {
  await db
    .delete(taskDeps)
    .where(and(eq(taskDeps.taskId, taskId), eq(taskDeps.dependsOnId, dependsOnId)));
}

/**
 * 环检测：加边 taskId→dependsOnId 前，检查 dependsOnId 是否已（传递）依赖 taskId。
 * 返回环路径（任务 id 数组）或 null。任务数 ≤30（容量假设），DFS 足够。
 */
async function findCycle(taskId: number, dependsOnId: number): Promise<number[] | null> {
  const [task] = await db.select({ groupId: tasks.groupId }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return null;
  const rows = await db
    .select({ taskId: taskDeps.taskId, dependsOnId: taskDeps.dependsOnId })
    .from(taskDeps)
    .innerJoin(tasks, eq(tasks.id, taskDeps.taskId))
    .where(eq(tasks.groupId, task.groupId));

  const graph = new Map<number, number[]>();
  for (const r of rows) {
    const list = graph.get(r.taskId) ?? [];
    list.push(r.dependsOnId);
    graph.set(r.taskId, list);
  }
  graph.set(taskId, [...(graph.get(taskId) ?? []), dependsOnId]);

  const path: number[] = [];
  const inPath = new Set<number>();
  const visited = new Set<number>();

  function dfs(node: number): number[] | null {
    if (inPath.has(node)) return [...path.slice(path.indexOf(node)), node];
    if (visited.has(node)) return null;
    visited.add(node);
    inPath.add(node);
    path.push(node);
    for (const next of graph.get(node) ?? []) {
      const found = dfs(next);
      if (found) return found;
    }
    path.pop();
    inPath.delete(node);
    return null;
  }

  // 从 taskId 出发若能回到 taskId 即成环
  const cycle = dfs(taskId);
  if (cycle && cycle[cycle.length - 1] === taskId) return cycle;
  return null;
}

export async function assignTask(taskId: number, userId: number, raci: string, assignedBy: number) {
  const [row] = await db
    .insert(taskAssignments)
    .values({ taskId, userId, raci, assignedBy })
    .onConflictDoNothing()
    .returning();

  // 重复指派被 on_conflict_do_nothing 吞掉时 returning 为空：不是新指派，不重复发通知
  if (!row) return null;

  // 通知被指派人（新任务分派）
  const [task] = await db
    .select({ groupId: tasks.groupId, title: tasks.title, code: tasks.code })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (task) {
    const raciLabel = raci === 'lead' ? '主责' : raci === 'reviewer' ? '审阅' : '协作';
    await notify([userId], {
      type: 'task_assigned',
      title: `你被指派为「${task.title}」的${raciLabel}人`,
      body: `任务编号 ${task.code}，请查看「我的部分」。`,
      link: '/dashboard/my-tasks',
      groupId: task.groupId,
      priority: 'normal'
    });
  }
  return row;
}

export async function unassign(assignmentId: number) {
  await db.delete(taskAssignments).where(eq(taskAssignments.id, assignmentId));
}

/** 状态流转：按状态机校验，每次迁移写 task_status_events（B-10 的第一手信号）。 */
export async function changeTaskStatus(
  taskId: number,
  actorId: number,
  input: ChangeStatusInput
) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return { ok: false as const, reason: '任务不存在' };

  const allowed = TASK_TRANSITIONS[task.status] ?? [];
  if (!allowed.includes(input.toStatus)) {
    return {
      ok: false as const,
      reason: `不允许从 ${task.status} 直接变为 ${input.toStatus}`
    };
  }

  const now = new Date();
  const patch: Record<string, unknown> = { status: input.toStatus };
  if (input.toStatus === 'doing' && !task.startedAt) patch.startedAt = now;
  if (input.toStatus === 'done') patch.completedAt = now;
  if (input.toStatus === 'blocked') patch.blockedReason = input.note ?? null;
  if (input.toStatus !== 'blocked') patch.blockedReason = null;

  const [updated] = await db.update(tasks).set(patch).where(eq(tasks.id, taskId)).returning();
  await db.insert(taskStatusEvents).values({
    taskId,
    fromStatus: task.status,
    toStatus: input.toStatus,
    actorId,
    note: input.note ?? null
  });
  // 进度信号沉淀（B-10 的第一手来源：不依赖人上报）
  await db.insert(progressSignals).values({
    groupId: task.groupId,
    taskId,
    userId: actorId,
    signalType: 'status_changed',
    payload: { from: task.status, to: input.toStatus }
  });
  return { ok: true as const, task: updated };
}

/**
 * 在调用方的事务里把任务流转到某个状态（复用同一套状态机与副作用）。
 *
 * 存在的理由：重规划的「缩小范围」原先在 replan.ts 里直接
 * `.update(tasks).set({status:'cancelled'})`，绕过了状态机，也不写
 * task_status_events / progress_signals —— 结果是 done 任务被悄悄改成 cancelled、
 * 审计里查不到谁砍的、健康度也算不出这次变更。这里把合法转换与两类记录集中到一处，
 * 事务连接由调用方传入，保证砍任务与采纳事件在同一个事务里原子生效。
 */
export async function cancelTaskInTx(
  tx: Pick<typeof db, 'select' | 'update' | 'insert'>,
  taskId: number,
  actorId: number,
  note?: string
) {
  const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return { ok: false as const, reason: '任务不存在' };
  // 已删除的任务不参与状态流转
  if (task.deletedAt) return { ok: false as const, reason: '任务已删除' };

  const allowed = TASK_TRANSITIONS[task.status] ?? [];
  if (!allowed.includes('cancelled')) {
    return {
      ok: false as const,
      reason: `任务 ${task.code} 当前状态「${task.status}」不允许取消`
    };
  }
  if (task.status === 'cancelled') {
    return { ok: true as const, task, unchanged: true as const };
  }

  const [updated] = await tx
    .update(tasks)
    .set({ status: 'cancelled', blockedReason: null })
    .where(eq(tasks.id, taskId))
    .returning();
  await tx.insert(taskStatusEvents).values({
    taskId,
    fromStatus: task.status,
    toStatus: 'cancelled',
    actorId,
    note: note ?? null
  });
  await tx.insert(progressSignals).values({
    groupId: task.groupId,
    taskId,
    userId: actorId,
    signalType: 'status_changed',
    payload: { from: task.status, to: 'cancelled' }
  });
  return { ok: true as const, task: updated, unchanged: false as const };
}

/** 「我的部分」（规格书 M-02）：我的任务、依赖谁、截止时间（跨课程）。 */
export async function getMyTasks(userId: number) {
  const rows = await db
    .select({
      assignment: taskAssignments,
      task: tasks,
      groupId: tasks.groupId
    })
    .from(taskAssignments)
    .innerJoin(tasks, eq(taskAssignments.taskId, tasks.id))
    .where(
      and(
        eq(taskAssignments.userId, userId),
        isNull(tasks.deletedAt),
        ne(tasks.status, 'cancelled')
      )
    )
    .orderBy(asc(tasks.dueAt));

  // 依赖就绪状态：我依赖的前置任务是否还有未完成
  const taskIds = rows.map((r) => r.task.id);
  const depRows = taskIds.length
    ? await db.select().from(taskDeps).where(inArray(taskDeps.taskId, taskIds))
    : [];
  const blockedBy = new Map<number, number[]>();
  for (const d of depRows) {
    blockedBy.set(d.taskId, [...(blockedBy.get(d.taskId) ?? []), d.dependsOnId]);
  }
  // 前置任务可能不在我的指派里，单独查状态
  const allDepIds = [...new Set(depRows.map((d) => d.dependsOnId))];
  const depTaskStatus = new Map<number, string>();
  if (allDepIds.length) {
    const depTasks = await db
      .select({ id: tasks.id, status: tasks.status })
      .from(tasks)
      .where(inArray(tasks.id, allDepIds));
    for (const t of depTasks) depTaskStatus.set(t.id, t.status);
  }

  return rows.map((r) => {
    const blockers = (blockedBy.get(r.task.id) ?? []).filter(
      (depId) => depTaskStatus.get(depId) !== undefined && depTaskStatus.get(depId) !== 'done'
    );
    return {
      assignment: r.assignment,
      task: r.task,
      waitingOn: blockers.length
    };
  });
}

/** 当前生效契约 + 历史版本。 */
export async function getContract(groupId: number) {
  const versions = await db
    .select()
    .from(contracts)
    .where(eq(contracts.groupId, groupId))
    .orderBy(desc(contracts.version));
  if (versions.length === 0) return null;

  const latest = versions[0];
  const glossary = await db
    .select()
    .from(contractGlossary)
    .where(eq(contractGlossary.contractId, latest.id));

  const acceptances = await db
    .select()
    .from(contractAcceptances)
    .where(eq(contractAcceptances.contractId, latest.id));

  return { latest, versions, glossary, acceptances };
}

/** 发布版本：通知全体成员确认。 */
export async function publishContract(groupId: number, publisherId: number) {
  const [latest] = await db
    .select()
    .from(contracts)
    .where(eq(contracts.groupId, groupId))
    .orderBy(desc(contracts.version))
    .limit(1);
  if (!latest) return null;
  const [updated] = await db
    .update(contracts)
    .set({ publishedAt: new Date(), publishedBy: publisherId })
    .where(eq(contracts.id, latest.id))
    .returning();
  // 通知全体成员确认签署
  const members = await groupMemberIds(groupId);
  await notify(members, {
    type: 'contract_published',
    title: '协作契约已发布，请确认',
    body: '术语表与接口约定以新版本为准，请及时签署。',
    link: `/dashboard/tasks`,
    groupId,
    priority: 'normal'
  });
  return updated;
}

/**
 * 成员确认签署（幂等）。
 * 注意：contract_acceptances 目前没有主键/唯一约束，`onConflictDoNothing()` 不会生效，
 * 所以这里先查后写，避免重复签署插入重复行（否则「N 人已签署」会被虚高）。
 */
export async function acceptContract(contractId: number, userId: number) {
  const [existing] = await db
    .select({ userId: contractAcceptances.userId })
    .from(contractAcceptances)
    .where(
      and(eq(contractAcceptances.contractId, contractId), eq(contractAcceptances.userId, userId))
    )
    .limit(1);
  if (existing) return { ok: true as const, already: true as const };

  await db.insert(contractAcceptances).values({ contractId, userId });
  return { ok: true as const, already: false as const };
}
