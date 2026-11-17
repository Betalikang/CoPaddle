import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/drizzle';
import {
  artifactSegments,
  artifactVersions,
  artifacts,
  attributionAppeals,
  attributionReviews,
  contributionSnapshots,
  courseSettings,
  evidenceItems,
  groupMembers,
  groups,
  peerReviews,
  taskAssignments,
  taskStatusEvents,
  tasks
} from '../db/schema';
import { AlgoServiceError, callAlgo } from '@/lib/algo/client';
import { getPeerReviewDetails } from './peer-reviews';
import { logAudit, notify } from './notifications';

/** algo /internal/attribution/compute 的响应类型。 */
type AlgoAttributionResponse = {
  members: {
    user_id: string;
    point: number;
    low: number;
    high: number;
    confidence: string;
    fair_share_ratio: number;
    warning: string;
    comp: Record<string, number>;
  }[];
  peer_missing: boolean;
};

/**
 * 把 algo 返回的区间夹紧到合法百分比。
 *
 * algo 的 low = point - uncertainty、high = point + uncertainty 都没有边界，会给出负百分比或 >100%，
 * 直接落库会让账本出现「-3.20% ~ 118.00%」这种不可展示的区间。
 * 处理顺序：先把 low / point / high 各自夹到 [0,100]，再保证 low <= point <= high。
 * 注意 point 只参与边界校正、绝不落库（系统只存区间是铁律）。
 */
function clampPercentRange(low: number, high: number, point: number): { low: number; high: number } {
  const clamp = (v: number) => (Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0);
  const p = clamp(point);
  const lo = Math.min(clamp(low), p);
  const hi = Math.max(clamp(high), p);
  // numeric(5,2) 只保留两位小数，先四舍五入避免 pg 隐式截断产生 low > high
  return { low: Math.round(lo * 100) / 100, high: Math.round(hi * 100) / 100 };
}

/**
 * 计算并落库全组贡献快照（规格书 B-14 / S4.7）。
 *
 * 三类证据全部由系统沉淀数据汇总（不用大模型）：
 *  A 产出物 → artifact_segments 段落级归属统计
 *  B 过程   → task_status_events + task_assignments
 *  C 同伴   → peer_reviews（域⑨，S6 期接入；当前为空 → peer_missing 路径）
 * 每条证据落 evidence_items——这是「可下钻」的实现。
 */
export async function computeGroupContributions(groupId: number) {
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group) throw new Error('小组不存在');

  const members = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), sql`${groupMembers.leftAt} IS NULL`));

  const [settings] = await db
    .select()
    .from(courseSettings)
    .where(eq(courseSettings.courseId, group.courseId))
    .limit(1);

  const userIds = members.map((m) => m.userId);
  if (userIds.length === 0) throw new Error('小组无成员');

  // ---- 证据 A：段落级归属（取每个 artifact 的最新版本）----
  const artifactRows = await db
    .select({ id: artifacts.id })
    .from(artifacts)
    .where(and(eq(artifacts.groupId, groupId), sql`${artifacts.deletedAt} IS NULL`));

  const wordsAuthored = new Map<number, number>();
  const wordsRevised = new Map<number, number>();
  const artifactEvidence: { userId: number; refType: string; refId: number; value: number; note: string }[] = [];

  for (const a of artifactRows) {
    const [current] = await db
      .select()
      .from(artifactVersions)
      .where(eq(artifactVersions.artifactId, a.id))
      .orderBy(desc(artifactVersions.versionNo))
      .limit(1);
    if (!current) continue;
    const segments = await db
      .select()
      .from(artifactSegments)
      .where(eq(artifactSegments.versionId, current.id));
    for (const seg of segments) {
      wordsAuthored.set(seg.authorId, (wordsAuthored.get(seg.authorId) ?? 0) + seg.wordCount);
      // 他人段落被本人修订 → 协作产出（半权）
      if (seg.revisedBy && seg.revisedBy !== seg.authorId) {
        wordsRevised.set(seg.revisedBy, (wordsRevised.get(seg.revisedBy) ?? 0) + seg.wordCount);
        artifactEvidence.push({
          userId: seg.revisedBy,
          refType: 'segment_revise',
          refId: seg.id,
          value: seg.wordCount,
          note: `修订第 ${seg.seq} 段（原作者 #${seg.authorId}）`
        });
      }
      artifactEvidence.push({
        userId: seg.authorId,
        refType: 'segment',
        refId: seg.id,
        value: seg.wordCount,
        note: `撰写第 ${seg.seq} 段（${seg.kind}）`
      });
    }
  }

  // ---- 证据 B：过程（按期率 / 关键路径 / 返工 / 补位）----
  const taskRows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.groupId, groupId), sql`${tasks.deletedAt} IS NULL`));
  const cpTaskIds = taskRows.filter((t) => t.onCriticalPath).map((t) => t.id);

  const assignRows =
    userIds.length && taskRows.length
      ? await db
          .select()
          .from(taskAssignments)
          .where(
            and(
              inArray(taskAssignments.userId, userIds),
              inArray(taskAssignments.taskId, taskRows.map((t) => t.id))
            )
          )
      : [];
  const taskById = new Map(taskRows.map((t) => [t.id, t]));

  const eventRows = taskRows.length
    ? await db
        .select()
        .from(taskStatusEvents)
        .where(inArray(taskStatusEvents.taskId, taskRows.map((t) => t.id)))
        .orderBy(asc(taskStatusEvents.createdAt))
    : [];

  const processEvidence: { userId: number; refType: string; refId: number; value: number; note: string }[] = [];
  const stats = new Map<number, { leadTotal: number; leadOnTime: number; rework: number; cpDone: number }>();
  for (const uid of userIds) stats.set(uid, { leadTotal: 0, leadOnTime: 0, rework: 0, cpDone: 0 });

  for (const a of assignRows) {
    if (a.raci !== 'lead') continue;
    const task = taskById.get(a.taskId);
    if (!task) continue;
    const st = stats.get(a.userId)!;
    st.leadTotal += 1;
    if (task.status === 'done') {
      // 按期口径：无 due 或 completedAt<=dueAt 视为按期（规格书 S4.7）
      const onTime = !task.dueAt || task.completedAt == null || task.completedAt <= task.dueAt;
      if (onTime) st.leadOnTime += 1;
      if (cpTaskIds.includes(task.id)) st.cpDone += 1;
      processEvidence.push({
        userId: a.userId,
        refType: 'task_done',
        refId: task.id,
        value: 1,
        note: onTime ? `按期完成主责任务 ${task.code}` : `延期完成主责任务 ${task.code}`
      });
    }
  }
  for (const e of eventRows) {
    if (e.toStatus === 'doing' && e.fromStatus === 'reviewing' && e.actorId) {
      const st = stats.get(e.actorId);
      if (st) {
        st.rework += 1;
        processEvidence.push({
          userId: e.actorId,
          refType: 'task_rework',
          refId: e.taskId,
          value: 1,
          note: '返工一次（reviewing → doing）'
        });
      }
    }
  }

  // ---- 证据 C：同伴（最近一轮 closed/published 互评收到的原始分 + 真实 review id）----
  const peerScoresByUser = new Map<number, number[]>();
  const peerDetailsByUser = new Map<number, { reviewId: number; reviewerId: number; score: number }[]>();
  for (const uid of userIds) {
    const details = await getPeerReviewDetails(groupId, uid);
    peerDetailsByUser.set(uid, details);
    peerScoresByUser.set(uid, details.map((d) => d.score));
  }

  // ---- 调 algo ----
  let result: AlgoAttributionResponse;
  try {
    result = await callAlgo<AlgoAttributionResponse>(
      '/internal/attribution/compute',
      {
        group_id: String(groupId),
        members: userIds.map((uid) => ({
          user_id: String(uid),
          words_authored: wordsAuthored.get(uid) ?? 0,
          words_revised: wordsRevised.get(uid) ?? 0,
          lead_total: stats.get(uid)!.leadTotal,
          lead_on_time: stats.get(uid)!.leadOnTime,
          cp_total: cpTaskIds.length,
          cp_done: stats.get(uid)!.cpDone,
          rework_count: stats.get(uid)!.rework,
          help_count: 0,
          peer_scores: peerScoresByUser.get(uid) ?? []
        })),
        w_artifact: settings ? Number(settings.wArtifact) : 0.5,
        w_process: settings ? Number(settings.wProcess) : 0.3,
        w_peer: settings ? Number(settings.wPeer) : 0.2,
        fair_share_threshold: settings ? Number(settings.fairShareThreshold) : 0.14
      },
      60000
    );
  } catch (err) {
    if (err instanceof AlgoServiceError) throw err;
    throw new AlgoServiceError(err instanceof Error ? err.message : '归因计算失败');
  }

  // ---- 落库：snapshots + evidence_items ----
  return db.transaction(async (tx) => {
    const now = new Date();
    const snapshotIds = new Map<number, number>();

    for (const m of result.members) {
      const uid = Number(m.user_id);
      // 落库前夹紧：algo 的 low/high 无上下限，且必须保证 low <= point <= high（夹紧后再排序）。
      const range = clampPercentRange(m.low, m.high, m.point);
      const [snap] = await tx
        .insert(contributionSnapshots)
        .values({
          groupId,
          userId: uid,
          snapshotAt: now,
          comp: m.comp,
          // 系统只存区间，永不存点估价（铁律）
          lowPct: String(range.low),
          highPct: String(range.high),
          confidence: m.confidence,
          fairShareRatio: String(m.fair_share_ratio),
          warning: m.warning || null,
          onTimeCount: stats.get(uid)?.leadOnTime ?? 0,
          delayCount: Math.max(0, (stats.get(uid)?.leadTotal ?? 0) - (stats.get(uid)?.leadOnTime ?? 0)),
          reworkCount: stats.get(uid)?.rework ?? 0,
          reviewCount: peerDetailsByUser.get(uid)?.length ?? 0
        })
        .returning();
      snapshotIds.set(uid, snap.id);
    }

    // 同伴证据条目（refId = peer_reviews.id，可下钻到互评原文）
    const peerEvidence: { userId: number; refType: string; refId: number; value: number; note: string }[] = [];
    for (const [uid, details] of peerDetailsByUser) {
      for (const d of details) {
        peerEvidence.push({
          userId: uid,
          refType: 'peer_review',
          refId: d.reviewId,
          value: Math.round(d.score * 100) / 100,
          note: `收到 1 份互评，均分 ${d.score.toFixed(1)}`
        });
      }
    }

    for (const ev of [...artifactEvidence, ...processEvidence, ...peerEvidence]) {
      const snapshotId = snapshotIds.get(ev.userId);
      if (!snapshotId) continue;
      await tx.insert(evidenceItems).values({
        groupId,
        userId: ev.userId,
        snapshotId,
        source: ev.refType.startsWith('segment')
          ? 'artifact'
          : ev.refType.startsWith('peer') || ev.refType.startsWith('task_')
            ? (ev.refType.startsWith('peer') ? 'peer' : 'process')
            : 'process',
        refType: ev.refType,
        refId: ev.refId,
        value: String(ev.value),
        note: ev.note
      });
    }

    return { snapshotCount: result.members.length, peerMissing: result.peer_missing };
  });
}

/** 快照所属课程 id（API 层课程归属鉴权用）。 */
export async function getSnapshotCourseId(snapshotId: number): Promise<number | null> {
  const [row] = await db
    .select({ courseId: groups.courseId })
    .from(contributionSnapshots)
    .innerJoin(groups, eq(groups.id, contributionSnapshots.groupId))
    .where(eq(contributionSnapshots.id, snapshotId))
    .limit(1);
  return row?.courseId ?? null;
}

/** 全组账本：最新快照 + 成员信息 + 是否已被教师终审。 */
export async function getGroupLedger(groupId: number) {
  const [latest] = await db
    .select({ snapshotAt: contributionSnapshots.snapshotAt })
    .from(contributionSnapshots)
    .where(eq(contributionSnapshots.groupId, groupId))
    .orderBy(desc(contributionSnapshots.snapshotAt))
    .limit(1);
  if (!latest) return null;

  const rows = await db
    .select({
      snapshot: contributionSnapshots,
      review: attributionReviews
    })
    .from(contributionSnapshots)
    .leftJoin(attributionReviews, eq(attributionReviews.snapshotId, contributionSnapshots.id))
    // 必须带 groupId：同一批次计算会让多个组共享同一个 snapshot_at，
    // 只按时间过滤会把别组的账本行也捞进本组视图。
    .where(
      and(
        eq(contributionSnapshots.groupId, groupId),
        eq(contributionSnapshots.snapshotAt, latest.snapshotAt)
      )
    )
    .orderBy(contributionSnapshots.userId);

  const members = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));

  return {
    snapshotAt: latest.snapshotAt,
    memberCount: members.length,
    entries: rows.map((r) => ({
      userId: r.snapshot.userId,
      comp: r.snapshot.comp,
      low: Number(r.snapshot.lowPct),
      high: Number(r.snapshot.highPct),
      confidence: r.snapshot.confidence,
      fairShareRatio: Number(r.snapshot.fairShareRatio),
      warning: r.snapshot.warning,
      review: r.review ?? null,
      snapshotId: r.snapshot.id
    }))
  };
}

/** 证据下钻（规格书 P-19 杀手锏）：snapshot 的全部证据条目 + 原始引用。 */
export async function getSnapshotEvidence(snapshotId: number) {
  const [snapshot] = await db
    .select()
    .from(contributionSnapshots)
    .where(eq(contributionSnapshots.id, snapshotId))
    .limit(1);
  if (!snapshot) return null;

  const items = await db
    .select()
    .from(evidenceItems)
    .where(eq(evidenceItems.snapshotId, snapshotId))
    .orderBy(evidenceItems.id);

  // 补原始引用内容（段落原文 / 任务标题），前端可继续下钻
  const segmentIds = items.filter((i) => i.refType === 'segment' || i.refType === 'segment_revise').map((i) => i.refId!).filter(Boolean);
  const segmentMap = new Map<number, { seq: number; content: string; authorId: number; wordCount: number }>();
  if (segmentIds.length) {
    const segs = await db
      .select()
      .from(artifactSegments)
      .where(inArray(artifactSegments.id, segmentIds));
    for (const s of segs) {
      segmentMap.set(s.id, { seq: s.seq, content: s.content, authorId: s.authorId, wordCount: s.wordCount });
    }
  }
  const taskIds = items.filter((i) => (i.refType ?? '').startsWith('task_')).map((i) => i.refId!).filter((x) => x != null);
  const taskMap = new Map<number, { code: string; title: string; status: string }>();
  if (taskIds.length) {
    const rows = await db.select().from(tasks).where(inArray(tasks.id, taskIds));
    for (const t of rows) taskMap.set(t.id, { code: t.code, title: t.title, status: t.status });
  }
  // 同伴证据：跳到互评原文（peer_reviews.id）
  const peerIds = items.filter((i) => i.refType === 'peer_review').map((i) => i.refId!).filter((x) => x != null);
  const peerMap = new Map<number, { reviewerId: number; scores: Record<string, number>; comment: string | null }>();
  if (peerIds.length) {
    const rows = await db.select().from(peerReviews).where(inArray(peerReviews.id, peerIds));
    for (const r of rows) {
      peerMap.set(r.id, { reviewerId: r.reviewerId, scores: r.scores ?? {}, comment: r.comment ?? null });
    }
  }

  return {
    snapshot,
    items: items.map((i) => ({
      id: i.id,
      source: i.source,
      refType: i.refType,
      refId: i.refId,
      value: Number(i.value),
      note: i.note,
      segment: i.refId ? segmentMap.get(i.refId) ?? null : null,
      task: i.refId ? taskMap.get(i.refId) ?? null : null,
      peerReview: i.refId ? peerMap.get(i.refId) ?? null : null
    }))
  };
}

/**
 * 教师终审：调整区间并填写评语（系统只给区间，最终值由教师确定）。
 *
 * 返回类型是 review 行 + `applied` / `error`（而不是 `{ error }` 联合类型）：
 * - 调用方 `web/scripts/demo-rehearsal.ts` 会直接读 `review.adjustedLow`，联合类型会让它类型检查失败；
 * - 调用路由 `web/app/api/contributions/[snapshotId]/review/route.ts` 没有 try/catch 也没有错误分支，
 *   抛错会被 Next 变成 500 —— 业务拒绝不能伪装成服务端故障。所以「已锁定」时返回既有行原值 +
 *   `applied: false` + 明确文案，由前端/日志如实展示。
 *
 * 审计与通知对「首次评审」和「修改评审」一视同仁：两者都属于五类必审的调分操作。
 */
export async function reviewSnapshot(
  snapshotId: number,
  reviewerId: number,
  input: { adjustedLow?: number | null; adjustedHigh?: number | null; finalNote?: string }
): Promise<typeof attributionReviews.$inferSelect & { applied: boolean; error?: string }> {
  const [existing] = await db
    .select()
    .from(attributionReviews)
    .where(eq(attributionReviews.snapshotId, snapshotId))
    .limit(1);

  // 已锁定 = 已定稿：不再允许改分，且不做任何写入（既不写库也不发通知）
  if (existing?.isLocked) {
    return {
      ...existing,
      applied: false,
      error: '该终审结果已锁定，不能再修改；如需变更请由教师先解除锁定'
    };
  }

  const [row] = existing
    ? await db
        .update(attributionReviews)
        .set({
          adjustedLow: input.adjustedLow != null ? String(input.adjustedLow) : existing.adjustedLow,
          adjustedHigh: input.adjustedHigh != null ? String(input.adjustedHigh) : existing.adjustedHigh,
          finalNote: input.finalNote ?? existing.finalNote,
          reviewedAt: new Date()
        })
        .where(eq(attributionReviews.id, existing.id))
        .returning()
    : await db
        .insert(attributionReviews)
        .values({
          snapshotId,
          reviewerId,
          adjustedLow: input.adjustedLow != null ? String(input.adjustedLow) : null,
          adjustedHigh: input.adjustedHigh != null ? String(input.adjustedHigh) : null,
          finalNote: input.finalNote ?? null
        })
        .returning();
  // 理论不可达（行刚写入），仅满足 noUncheckedIndexedAccess
  if (!row) throw new Error('终审结果写入失败');

  // 审计（五类必审操作之一：调分）——新建与更新都要写，并保留改前值
  await logAudit({
    actorId: reviewerId,
    actorRole: 'teacher',
    action: 'attribution_review',
    targetType: 'contribution_snapshot',
    targetId: snapshotId,
    before: existing
      ? { adjustedLow: existing.adjustedLow, adjustedHigh: existing.adjustedHigh, finalNote: existing.finalNote }
      : null,
    after: { adjustedLow: row.adjustedLow, adjustedHigh: row.adjustedHigh, finalNote: row.finalNote }
  });

  // 通知该成员：教师终审完成（含二次调分，学生需要知道自己被改过）
  const [snap] = await db
    .select({ groupId: contributionSnapshots.groupId, userId: contributionSnapshots.userId })
    .from(contributionSnapshots)
    .where(eq(contributionSnapshots.id, snapshotId))
    .limit(1);
  if (snap) {
    await notify([snap.userId], {
      type: 'review_done',
      title: existing ? '教师更新了你的贡献终审' : '教师已完成你的贡献终审',
      body: '请查看贡献账本中的终审区间与评语。',
      link: `/dashboard/contributions`,
      groupId: snap.groupId,
      priority: 'normal'
    });
  }
  return { ...row, applied: true };
}

/** 批量锁定终审结果。 */
export async function lockGroupSnapshots(groupId: number, reviewerId: number) {
  const latest = await db
    .select({ snapshotAt: contributionSnapshots.snapshotAt })
    .from(contributionSnapshots)
    .where(eq(contributionSnapshots.groupId, groupId))
    .orderBy(desc(contributionSnapshots.snapshotAt))
    .limit(1);
  const batch = latest[0];
  if (!batch) return { locked: 0 };

  // 「同一批」= 本组 + 同一个 snapshotAt。这里必须带 groupId：
  // snapshotAt 是算分时间戳，两个组在同一毫秒算分会得到相同值，只按时间过滤会连别组的终审一起锁掉。
  const snaps = await db
    .select({ id: contributionSnapshots.id })
    .from(contributionSnapshots)
    .where(
      and(
        eq(contributionSnapshots.groupId, groupId),
        eq(contributionSnapshots.snapshotAt, batch.snapshotAt)
      )
    );
  if (snaps.length === 0) return { locked: 0 };

  // 只更新未锁定的行：重复点击返回 0，`locked` 表示「本次新锁定条数」，前端文案才不会虚报
  const rows = await db
    .update(attributionReviews)
    .set({ isLocked: true })
    .where(
      and(
        inArray(attributionReviews.snapshotId, snaps.map((s) => s.id)),
        eq(attributionReviews.isLocked, false)
      )
    )
    .returning();
  await logAudit({
    actorId: reviewerId,
    actorRole: 'teacher',
    action: 'attribution_lock',
    targetType: 'group',
    targetId: groupId,
    after: { locked: rows.length }
  });
  return { locked: rows.length };
}

/** 学生提交申诉（仅针对本人账本）。 */
export async function submitAppeal(
  snapshotId: number,
  appellantId: number,
  input: { reason: string; evidenceText?: string }
) {
  const [snap] = await db
    .select()
    .from(contributionSnapshots)
    .where(eq(contributionSnapshots.id, snapshotId))
    .limit(1);
  if (!snap) throw new Error('账本不存在');
  if (snap.userId !== appellantId) throw new Error('只能对自己的账本申诉');

  const [appeal] = await db
    .insert(attributionAppeals)
    .values({
      snapshotId,
      appellantId,
      reason: input.reason,
      evidenceText: input.evidenceText ?? null
    })
    .returning();
  return appeal;
}

/** 教师处理申诉（受理 / 驳回 / 部分采纳，必须填理由）。 */
export async function handleAppeal(
  appealId: number,
  handlerId: number,
  input: { status: 'accepted' | 'rejected' | 'partially_accepted' | 'reviewing'; resultNote: string }
) {
  const [appeal] = await db
    .update(attributionAppeals)
    .set({
      status: input.status,
      resultNote: input.resultNote,
      handlerId,
      handledAt: new Date()
    })
    .where(eq(attributionAppeals.id, appealId))
    .returning();
  return appeal;
}
