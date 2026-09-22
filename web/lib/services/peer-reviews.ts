import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db/drizzle';
import {
  groupMembers,
  groups,
  peerReviewAnomalies,
  peerReviewRounds,
  peerReviews,
  users
} from '../db/schema';

/** 同伴互评（规格书 B-15 / S4.8）。同伴证据是贡献归因的第三类证据。 */

const DEFAULT_DIMENSIONS = [
  { key: '贡献', label: '工作贡献' },
  { key: '沟通', label: '沟通协作' },
  { key: '负责', label: '责任担当' },
  { key: '质量', label: '工作质量' },
  { key: '技能', label: '专业技能' }
];

type CreateRoundInput = {
  name: string;
  openAt?: string | null;
  closeAt?: string | null;
  dimensions?: { key: string; label: string }[];
  isAnonymous?: boolean;
};

export async function createRound(courseId: number, teacherId: number, input: CreateRoundInput) {
  const [round] = await db
    .insert(peerReviewRounds)
    .values({
      courseId,
      name: input.name,
      openAt: input.openAt ? new Date(input.openAt) : null,
      closeAt: input.closeAt ? new Date(input.closeAt) : null,
      dimensions: input.dimensions ?? DEFAULT_DIMENSIONS,
      isAnonymous: input.isAnonymous ?? true,
      createdBy: teacherId,
      status: 'scheduled'
    })
    .returning();
  return round;
}

export async function updateRound(roundId: number, patch: Partial<CreateRoundInput> & { status?: string }) {
  const set: Record<string, unknown> = { ...patch };
  if (patch.openAt !== undefined) set.openAt = patch.openAt ? new Date(patch.openAt) : null;
  if (patch.closeAt !== undefined) set.closeAt = patch.closeAt ? new Date(patch.closeAt) : null;
  const [round] = await db
    .update(peerReviewRounds)
    .set(set)
    .where(eq(peerReviewRounds.id, roundId))
    .returning();
  return round;
}

export async function listRounds(courseId: number) {
  return db
    .select()
    .from(peerReviewRounds)
    .where(eq(peerReviewRounds.courseId, courseId))
    .orderBy(desc(peerReviewRounds.createdAt));
}

export async function getRound(roundId: number) {
  const [round] = await db
    .select()
    .from(peerReviewRounds)
    .where(eq(peerReviewRounds.id, roundId))
    .limit(1);
  return round ?? null;
}

/** 开启轮次（scheduled → open）。 */
export async function openRound(roundId: number) {
  const [round] = await db
    .update(peerReviewRounds)
    .set({ status: 'open' })
    .where(eq(peerReviewRounds.id, roundId))
    .returning();
  return round;
}

/**
 * 关闭轮次（open → closed）：锁定提交并跑异常检测（规格书 S4.8）。
 * 异常只提示，不自动改分。
 */
export async function closeRound(roundId: number) {
  const [round] = await db
    .update(peerReviewRounds)
    .set({ status: 'closed' })
    .where(eq(peerReviewRounds.id, roundId))
    .returning();
  if (round) {
    await detectAnomalies(roundId);
  }
  return round;
}

/** 发布结果（closed → published）：学生可见自己的结果。 */
export async function publishRound(roundId: number) {
  const [round] = await db
    .update(peerReviewRounds)
    .set({ status: 'published' })
    .where(eq(peerReviewRounds.id, roundId))
    .returning();
  return round;
}

/** 我需要评谁（同组其他成员，含已提交状态）。 */
export async function myReviewTasks(roundId: number, userId: number) {
  const round = await getRound(roundId);
  if (!round) return null;

  const myGroups = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(and(eq(groupMembers.userId, userId), isNull(groupMembers.leftAt)));
  if (myGroups.length === 0) return { round, targets: [] };

  const groupIds = myGroups.map((g) => g.groupId);
  const members = await db
    .select({ userId: users.id, name: users.name, studentNo: users.studentNo })
    .from(groupMembers)
    .innerJoin(users, eq(groupMembers.userId, users.id))
    .where(inArray(groupMembers.groupId, groupIds));

  const submitted = await db
    .select({ revieweeId: peerReviews.revieweeId })
    .from(peerReviews)
    .where(and(eq(peerReviews.roundId, roundId), eq(peerReviews.reviewerId, userId)));

  const doneSet = new Set(submitted.map((s) => s.revieweeId));
  const targets = members
    .filter((m) => m.userId !== userId)
    .map((m) => ({ ...m, submitted: doneSet.has(m.userId) }));

  return { round, targets };
}

/** 提交评价（closed 后不可提交；同一人对同一被评人仅一份）。 */
export async function submitReview(
  roundId: number,
  reviewerId: number,
  input: { revieweeId: number; scores: Record<string, number>; comment?: string }
) {
  const round = await getRound(roundId);
  if (!round) return { error: '轮次不存在' as const };
  if (round.status !== 'open') {
    return { error: '轮次未在开放状态，无法提交' as const };
  }

  // 被评人必须与评价人同组
  const myGroups = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.userId, reviewerId));
  const theirGroups = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.userId, input.revieweeId));
  const shared = myGroups.some((g) => theirGroups.some((t) => t.groupId === g.groupId));
  if (!shared) {
    return { error: '只能评价同组成员' as const };
  }

  const dims = round.dimensions ?? DEFAULT_DIMENSIONS;
  for (const d of dims) {
    const v = input.scores[d.key];
    if (typeof v !== 'number' || v < 1 || v > 5) {
      return { error: `维度「${d.label}」评分须为 1–5` as const };
    }
  }

  const groupId = myGroups.find((g) => theirGroups.some((t) => t.groupId === g.groupId))!.groupId;
  const [review] = await db
    .insert(peerReviews)
    .values({
      roundId,
      groupId,
      reviewerId,
      revieweeId: input.revieweeId,
      scores: input.scores,
      comment: input.comment ?? null
    })
    .onConflictDoUpdate({
      target: [peerReviews.roundId, peerReviews.reviewerId, peerReviews.revieweeId],
      set: { scores: input.scores, comment: input.comment ?? null, submittedAt: new Date() }
    })
    .returning();
  return { review };
}

/** 完成率统计（教师端进度条）：应提交 = Σ 每组 n×(n−1)。 */
export async function roundProgress(roundId: number) {
  const round = await getRound(roundId);
  if (!round) return null;

  const groupRows = await db.select({ id: groups.id }).from(groups).where(eq(groups.courseId, round.courseId));
  const gm = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(isNull(groupMembers.leftAt));
  const perGroup = new Map<number, number>();
  for (const m of gm) perGroup.set(m.groupId, (perGroup.get(m.groupId) ?? 0) + 1);

  let expected = 0;
  for (const g of groupRows) {
    const n = perGroup.get(g.id) ?? 0;
    expected += n * Math.max(n - 1, 0);
  }

  const submitted = await db
    .select({ id: peerReviews.id })
    .from(peerReviews)
    .where(eq(peerReviews.roundId, roundId));

  return { expected, submitted: submitted.length };
}

/**
 * 结果：去极值中位数（人数 ≥ 4 时去掉最高最低各一个）+ 组内排名（规格书 B-15）。
 */
export async function roundResults(roundId: number) {
  const round = await getRound(roundId);
  if (!round) return null;

  const reviews = await db
    .select()
    .from(peerReviews)
    .where(eq(peerReviews.roundId, roundId));

  const byReviewee = new Map<number, number[]>();
  for (const r of reviews) {
    const vals = Object.values(r.scores);
    const avg = vals.reduce((a, b) => a + b, 0) / Math.max(vals.length, 1);
    byReviewee.set(r.revieweeId, [...(byReviewee.get(r.revieweeId) ?? []), avg]);
  }

  const rows = [...byReviewee.entries()].map(([userId, scores]) => {
    const s = [...scores].sort((a, b) => a - b);
    let median: number;
    if (s.length >= 4) {
      const trimmed = s.slice(1, -1);
      median = _median(trimmed);
    } else {
      median = _median(s);
    }
    return { userId, count: scores.length, median };
  });
  rows.sort((a, b) => b.median - a.median);
  const rankOf = new Map(rows.map((r, i) => [r.userId, i + 1]));

  // 补姓名
  const ids = rows.map((r) => r.userId);
  const nameById = new Map<number, { name: string | null; studentNo: string | null }>();
  if (ids.length) {
    const us = await db.select({ id: users.id, name: users.name, studentNo: users.studentNo }).from(users).where(inArray(users.id, ids));
    for (const u of us) nameById.set(u.id, { name: u.name, studentNo: u.studentNo });
  }

  return {
    round,
    results: rows.map((r) => ({
      userId: r.userId,
      name: nameById.get(r.userId)?.name ?? null,
      studentNo: nameById.get(r.userId)?.studentNo ?? null,
      count: r.count,
      median: Math.round(r.median * 100) / 100,
      rank: rankOf.get(r.userId) ?? 0
    }))
  };
}

function _median(vals: number[]): number {
  if (vals.length === 0) return 0;
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * 异常检测（规格书 S4.8）：互刷高分 / 极端低分 / 单一来源 / 未响应。
 * 只提示，不自动改分。
 */
export async function detectAnomalies(roundId: number) {
  const round = await getRound(roundId);
  if (!round) return [];

  const reviews = await db
    .select()
    .from(peerReviews)
    .where(eq(peerReviews.roundId, roundId));

  // 清理旧检测结果（重跑）
  await db.delete(peerReviewAnomalies).where(eq(peerReviewAnomalies.roundId, roundId));

  const anomalies: (typeof peerReviewAnomalies.$inferInsert)[] = [];

  // 互刷高分：A→B 与 B→A 双方评分同时 ≥ 4.5，且两人对其他成员评分均值 ≤ 3.5
  const byReviewer = new Map<number, typeof reviews>();
  for (const r of reviews) {
    byReviewer.set(r.reviewerId, [...(byReviewer.get(r.reviewerId) ?? []), r]);
  }
  for (const r of reviews) {
    const back = reviews.find((x) => x.reviewerId === r.revieweeId && x.revieweeId === r.reviewerId);
    if (!back) continue;
    const avg = (x: typeof r) => Object.values(x.scores).reduce((a, b) => a + b, 0) / Math.max(Object.values(x.scores).length, 1);
    if (avg(r) >= 4.5 && avg(back) >= 4.5) {
      const othersAvg = (uid: number) => {
        const rs = (byReviewer.get(uid) ?? []).filter((x) => x.revieweeId !== r.revieweeId && x.revieweeId !== r.reviewerId);
        if (rs.length === 0) return 5;
        return rs.map(avg).reduce((a, b) => a + b, 0) / rs.length;
      };
      if (othersAvg(r.reviewerId) <= 3.5 && othersAvg(r.revieweeId) <= 3.5) {
        anomalies.push({
          roundId,
          groupId: r.groupId,
          type: 'mutual_inflation',
          payload: { a: r.reviewerId, b: r.revieweeId, score_a_to_b: avg(r), score_b_to_a: avg(back) },
          severity: 'high',
          note: `${r.reviewerId} 与 ${r.revieweeId} 互评均 ≥ 4.5，但对他人评分明显偏低`
        });
      }
    }
  }

  // 极端低分：对某人的评分比组内其他人给该人的中位数低 ≥ 2 分，且未填写文字评语
  const byReviewee = new Map<number, typeof reviews>();
  for (const r of reviews) {
    byReviewee.set(r.revieweeId, [...(byReviewee.get(r.revieweeId) ?? []), r]);
  }
  const avg = (x: typeof reviews[0]) => Object.values(x.scores).reduce((a, b) => a + b, 0) / Math.max(Object.values(x.scores).length, 1);
  for (const [reviewee, rs] of byReviewee) {
    if (rs.length < 2) continue;
    const med = _median(rs.map(avg));
    for (const r of rs) {
      if (med - avg(r) >= 2 && !r.comment) {
        anomalies.push({
          roundId,
          groupId: r.groupId,
          type: 'extreme_low',
          payload: { reviewer: r.reviewerId, reviewee, score: avg(r), group_median: med },
          severity: 'medium',
          note: `${r.reviewerId} 给 ${reviewee} 的评分 ${avg(r).toFixed(1)} 显著低于组内中位数 ${med.toFixed(1)}，且未写评语`
        });
      }
    }
  }

  // 单一来源：某人收到的有效评价只有 1 份
  for (const [reviewee, rs] of byReviewee) {
    if (rs.length === 1) {
      anomalies.push({
        roundId,
        groupId: rs[0].groupId,
        type: 'single_source',
        payload: { reviewee, count: 1 },
        severity: 'low',
        note: `${reviewee} 只收到 1 份评价`
      });
    }
  }

  // 未响应：轮次关闭时仍有未提交的评价（按组统计缺口）
  const progress = await roundProgress(roundId);
  if (progress && progress.submitted < progress.expected) {
    const missing = progress.expected - progress.submitted;
    const groupRows = await db.select({ id: groups.id }).from(groups).where(eq(groups.courseId, round.courseId));
    for (const g of groupRows) {
      anomalies.push({
        roundId,
        groupId: g.id,
        type: 'non_response',
        payload: { missing },
        severity: 'low',
        note: `全班尚有 ${missing} 份评价未提交`
      });
      break; // 课程级提示一条即可
    }
  }

  if (anomalies.length) {
    await db.insert(peerReviewAnomalies).values(anomalies);
  }
  return anomalies;
}

export async function listAnomalies(roundId: number) {
  return db
    .select()
    .from(peerReviewAnomalies)
    .where(eq(peerReviewAnomalies.roundId, roundId))
    .orderBy(desc(peerReviewAnomalies.detectedAt));
}

/**
 * 归因用：取某成员在最近一轮（closed/published）收到的全部分数。
 * 返回原始分数组（algo 侧做去极值中位数）。
 */
export async function getPeerScoresForAttribution(groupId: number, userId: number): Promise<number[]> {
  const [group] = await db
    .select({ courseId: groups.courseId })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  if (!group) return [];

  const rounds = await db
    .select()
    .from(peerReviewRounds)
    .where(
      and(
        eq(peerReviewRounds.courseId, group.courseId),
        inArray(peerReviewRounds.status, ['closed', 'published'])
      )
    )
    .orderBy(desc(peerReviewRounds.createdAt))
    .limit(1);
  if (rounds.length === 0) return [];

  const reviews = await db
    .select()
    .from(peerReviews)
    .where(and(eq(peerReviews.roundId, rounds[0].id), eq(peerReviews.revieweeId, userId)));

  return reviews.map((r) => {
    const vals = Object.values(r.scores);
    return vals.reduce((a, b) => a + b, 0) / Math.max(vals.length, 1);
  });
}
