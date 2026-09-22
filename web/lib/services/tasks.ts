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

    return { planId: plan.id, problems: result.validation_problems };
  });
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
  const [row] = await db.update(tasks).set(set).where(eq(tasks.id, taskId)).returning();
  return row;
}

export async function deleteTask(taskId: number) {
  // 软删除 + 自动清理依赖边（deps 通过外键 cascade 物理清理）
  await db.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.id, taskId));
  await db.delete(taskDeps).where(or(eq(taskDeps.taskId, taskId), eq(taskDeps.dependsOnId, taskId)));
}

/** 加依赖（写入前环检测，成环拒绝并返回环上任务）。 */
export async function addDep(taskId: number, dependsOnId: number) {
  if (taskId === dependsOnId) {
    return { ok: false as const, reason: '任务不能依赖自己' };
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
  return row ?? null;
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

/** 成员确认签署。 */
export async function acceptContract(contractId: number, userId: number) {
  await db
    .insert(contractAcceptances)
    .values({ contractId, userId })
    .onConflictDoNothing();
  return { ok: true as const };
}
