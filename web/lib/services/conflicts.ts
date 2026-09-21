import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db/drizzle';
import {
  conflictAttributions,
  conflictResolutions,
  conflicts,
  groups,
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
};

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

  const byId = new Map(taskRows.map((t) => [t.id, t]));
  const created: number[] = [];

  // 已有 open 冲突的任务（避免重复报）
  const existing = await db
    .select({ taskId: conflicts.taskId })
    .from(conflicts)
    .where(and(eq(conflicts.groupId, groupId), eq(conflicts.status, 'open')));
  const reported = new Set(existing.map((e) => e.taskId).filter((x) => x !== null));

  for (const t of taskRows) {
    if (t.status === 'done' || t.status === 'cancelled') continue;
    if (reported.has(t.id)) continue;

    // 依赖冲突：本任务延期/阻塞，且是某未完成任务的前置
    const isLate =
      t.status === 'blocked' ||
      (t.dueAt !== null && t.dueAt < new Date() && t.status !== 'done');
    if (!isLate) continue;

    const downstream = taskRows.filter(
      (other) => other.id !== t.id && other.status !== 'done'
    );
    if (downstream.length === 0) continue;

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
        summary: `任务 ${t.code} 当前状态 ${t.status}${t.dueAt ? `，截止 ${t.dueAt.toLocaleDateString('zh-CN')}` : ''}；组内 ${downstream.length} 个未完成任务可能受影响。`
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

/** 处理冲突：就地合并 / 退回对齐契约 / 重指派 / 驳回（规格书 B-11）。 */
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

  const [resolution] = await db
    .insert(conflictResolutions)
    .values({
      conflictId,
      action: input.action,
      actorId,
      note: input.note ?? null,
      appliedPayload: input.payload ?? null
    })
    .returning();

  await db
    .update(conflicts)
    .set({ status: input.action === 'dismiss' ? 'dismissed' : 'resolved', resolvedAt: new Date() })
    .where(eq(conflicts.id, conflictId));

  return { resolution };
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
