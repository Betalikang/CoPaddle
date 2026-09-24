/**
 * 数字图像课 · 中后期全景演示数据（全量 119 人 / 24 组 / 3 班）。
 *
 * 数据源：scripts/data/digital-media-24-rankings.json（来自真实排名表）
 * 幂等：清理 @copaddle.local 与 DIGI201 后重建；不依赖 LLM（任务为模板 DAG）。
 * 运行：cd web && pnpm tsx scripts/seed-digital-image.ts
 * 前置：db(:5433) 与 algo(:8000) 运行（贡献/健康度调用 algo；失败则写占位快照）。
 *
 * 演示账号（密码均为 copaddle123）：
 *   teacher@copaddle.local / captain@copaddle.local / member@copaddle.local
 *   学生：s{学号}@copaddle.local
 */
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { db } from '../lib/db/drizzle';
import {
  activityLogs,
  artifactSegments,
  artifacts,
  classes,
  conflictAttributions,
  conflictResolutions,
  conflicts,
  contributionSnapshots,
  courseMemberships,
  courseSettings,
  courses,
  groupHealthSnapshots,
  groupMembers,
  groups,
  memberProfiles,
  notifications,
  peerReviewRounds,
  peerReviews,
  progressSignals,
  replanEvents,
  replanOptions,
  skillCards,
  socialEdges,
  taskAssignments,
  taskDeps,
  taskPlans,
  taskStatusEvents,
  tasks,
  users,
  auditLogs,
  aiCallLogs,
  attributionAppeals,
  attributionReviews,
  contracts,
  contractGlossary,
  contractAcceptances,
  groupingPlans,
  groupingRuns,
  constraints
} from '../lib/db/schema';
import { hashPassword } from '../lib/auth/session';
import { createCourse } from '../lib/services/courses';
import { addEnrollment } from '../lib/services/enrollments';
import { upsertSkillCard } from '../lib/services/skill-cards';
import { createArtifact, saveVersion } from '../lib/services/artifacts';
import { computeGroupContributions } from '../lib/services/contributions';
import { computeGroupHealth } from '../lib/services/health';
import { detectConflicts, resolveConflict } from '../lib/services/conflicts';
import { triggerReplan, adoptOption } from '../lib/services/replan';
import {
  createRound,
  openRound,
  closeRound,
  publishRound,
  submitReview,
  detectAnomalies
} from '../lib/services/peer-reviews';

const DEMO_PASSWORD = 'copaddle123';
const DOMAIN = '@copaddle.local';
const COURSE_CODE = 'DIGI201';
const CLASS_META = {
  '24-1': { name: '数字媒体本24-1', major: '数字媒体技术', grade: '2024' },
  '24-2': { name: '数字媒体本24-2', major: '数字媒体技术', grade: '2024' },
  '24-3': { name: '数字媒体本24-3', major: '数字媒体技术', grade: '2024' }
} as const;

const DIMS = ['编程', '写作', '设计', '表达', '数据分析', '调研', '领导力'] as const;

const ASSIGNMENT = `课程大作业：图像增强与风格迁移系统。
要求：
1. 选定城市场景或校园场景图像数据集，完成采集、清洗与标注说明；
2. 实现至少 3 种经典图像增强方法（直方图均衡、CLAHE、锐化/去雾任选），并给出定量对比；
3. 完成语义分割或显著性检测实验一组，输出 mask 与指标；
4. 实现或调用一种风格迁移方法，产出不少于 4 组效果图；
5. 提交图文报告（≥5 图，统一度量单位与口径）与可复现代码。
注意：峰值信噪比（PSNR）单位 dB；结构相似性（SSIM）无量纲，须在报告中统一定义。`;

type RankRow = {
  studentNo: string;
  name: string;
  sciScore: number;
  sciRank: number;
  gpaScore: number;
  gpaRank: number;
  classKey: '24-1' | '24-2' | '24-3';
};

type Wave = 'smooth' | 'congested' | 'crisis';

const TASK_TEMPLATE: {
  code: string;
  title: string;
  deps: string[];
  estHours: number;
  skills: string[];
  milestone: string;
  deliverable: string;
}[] = [
  { code: 'T1', title: '需求分析与数据集方案', deps: [], estHours: 6, skills: ['调研'], milestone: '开题', deliverable: '数据集说明' },
  { code: 'T2', title: '图像采集与标注', deps: ['T1'], estHours: 10, skills: ['调研', '设计'], milestone: '开题', deliverable: '标注数据' },
  { code: 'T3', title: '预处理与增强流水线', deps: ['T2'], estHours: 12, skills: ['编程', '数据分析'], milestone: '中期', deliverable: '增强代码' },
  { code: 'T4', title: '经典增强对比实验', deps: ['T3'], estHours: 14, skills: ['编程', '数据分析'], milestone: '中期', deliverable: '实验记录' },
  { code: 'T5', title: '分割/显著性实验', deps: ['T3'], estHours: 14, skills: ['编程'], milestone: '中期', deliverable: 'mask 与指标' },
  { code: 'T6', title: '风格迁移原型', deps: ['T4', 'T5'], estHours: 16, skills: ['编程', '设计'], milestone: '后期', deliverable: '迁移效果图' },
  { code: 'T7', title: '实验图表与可视化', deps: ['T4', 'T5'], estHours: 8, skills: ['设计', '表达'], milestone: '后期', deliverable: '图表集' },
  { code: 'T8', title: '撰写报告并统一口径', deps: ['T6', 'T7'], estHours: 12, skills: ['写作'], milestone: '终期', deliverable: '报告初稿' },
  { code: 'T9', title: '答辩 PPT 与复现说明', deps: ['T8'], estHours: 6, skills: ['表达'], milestone: '终期', deliverable: 'PPT + README' }
];

const GLOSSARY = [
  { term: 'PSNR', definition: '峰值信噪比，衡量重建/增强图像质量', unit: 'dB' },
  { term: 'SSIM', definition: '结构相似性，衡量结构保持程度', unit: '无量纲' },
  { term: 'mIoU', definition: '语义分割平均交并比', unit: '%' },
  { term: '分辨率', definition: '实验统一使用短边 512 等比缩放后的分辨率', unit: 'px' }
];

function hashNum(s: string, salt: number): number {
  let h = salt * 17;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function skillsFor(row: RankRow): Record<string, number> {
  // 排名越小越强 → 能力 1–5
  const clamp = (x: number) => Math.max(1, Math.min(5, Math.round(x)));
  const sci = row.sciRank; // 1..119
  const gpa = row.gpaRank;
  const n = 119;
  const invS = 1 + ((n - sci) / (n - 1)) * 4;
  const invG = 1 + ((n - gpa) / (n - 1)) * 4;
  const r = (salt: number) => (hashNum(row.studentNo, salt) % 100) / 100;
  return {
    编程: clamp(invS * 0.7 + invG * 0.2 + r(1) * 1.2),
    写作: clamp(invG * 0.55 + invS * 0.25 + r(2) * 1.3),
    设计: clamp(invG * 0.4 + invS * 0.3 + r(3) * 1.5),
    表达: clamp(invG * 0.5 + r(4) * 1.8),
    数据分析: clamp(invS * 0.65 + invG * 0.25 + r(5) * 1.1),
    调研: clamp(invG * 0.45 + invS * 0.35 + r(6) * 1.3),
    领导力: clamp((gpa <= 36 ? 3.2 : 2.2) + r(7) * 2)
  };
}

function waveFor(groupIndex: number): Wave {
  if (groupIndex < 10) return 'smooth';
  if (groupIndex < 18) return 'congested';
  return 'crisis';
}

/** 蛇形分组：按综测排名高低混编，每组 4–5 人。 */
function snakeGroups(rows: RankRow[], groupCount: number): RankRow[][] {
  const sorted = [...rows].sort((a, b) => a.gpaRank - b.gpaRank);
  const buckets: RankRow[][] = Array.from({ length: groupCount }, () => []);
  sorted.forEach((row, i) => {
    const round = Math.floor(i / groupCount);
    const pos = round % 2 === 0 ? i % groupCount : groupCount - 1 - (i % groupCount);
    buckets[pos].push(row);
  });
  return buckets.filter((b) => b.length > 0);
}

/**
 * 消解「不可同组」冲突：若配对落在同一组，把其中一人换到其他组。
 * 种子分组必须与 constraints 一致，否则工作台一打开就带 H2 违规。
 */
function separateForbiddenPairs(groups: number[][], forbidden: [number, number][]): number[][] {
  if (forbidden.length === 0) return groups;
  const result = groups.map((g) => [...g]);
  const pairKey = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;
  const banned = new Set(forbidden.map(([a, b]) => pairKey(a, b)));

  const groupOf = (id: number) => result.findIndex((g) => g.includes(id));
  const groupHasBanned = (g: number[]): boolean => {
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        if (banned.has(pairKey(g[i], g[j]))) return true;
      }
    }
    return false;
  };

  for (const [a, b] of forbidden) {
    let guard = 0;
    while (groupOf(a) !== -1 && groupOf(a) === groupOf(b) && guard++ < result.length * 2) {
      const ga = groupOf(a);
      let fixed = false;
      for (let gj = 0; gj < result.length && !fixed; gj++) {
        if (gj === ga) continue;
        for (let i = 0; i < result[gj].length; i++) {
          const m = result[gj][i];
          // 把 a 与 m 对调
          const src = result[ga].map((x) => (x === a ? m : x));
          const dst = result[gj].map((x) => (x === m ? a : x));
          // 对调后：本配对分开，且两组都不引入新的禁配
          if (groupHasBanned(src) || groupHasBanned(dst)) continue;
          result[ga] = src;
          result[gj] = dst;
          fixed = true;
          break;
        }
      }
      if (!fixed) break;
    }
  }
  return result;
}

const para = (topic: string, n: number) => {
  const base =
    `在${topic}部分，我们统一了实验口径与度量单位，并在平台内完成撰写以便溯源。` +
    `增强流水线覆盖灰度化、对比度受限直方图均衡与轻度锐化；风格迁移采用内容-风格损失加权。` +
    `所有图表标注 PSNR（dB）与 SSIM，分辨率统一短边 512。`;
  return base.repeat(Math.ceil(n / base.length)).slice(0, n);
};

async function cleanup() {
  console.log('== 清理旧演示数据（DATA101 / DIGI201 / @copaddle.local） ==');
  const { or } = await import('drizzle-orm');
  const oldUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `%${DOMAIN}`));
  const oldIds = oldUsers.map((u) => u.id);

  const courseConds = [
    eq(courses.code, COURSE_CODE),
    eq(courses.code, 'DATA101'),
    eq(courses.name, '数据分析基础'),
    eq(courses.name, '数字图像')
  ];
  if (oldIds.length) courseConds.push(inArray(courses.teacherId, oldIds));

  const rows = await db
    .select({ id: courses.id })
    .from(courses)
    .where(or(...courseConds));
  for (const c of rows) {
    await db.delete(courses).where(eq(courses.id, c.id));
  }
  if (oldIds.length) {
    // 先清引用 users 的旁路表，再删用户
    await db.delete(activityLogs).where(inArray(activityLogs.userId, oldIds));
    await db.delete(auditLogs).where(inArray(auditLogs.actorId, oldIds));
    await db.delete(aiCallLogs).where(inArray(aiCallLogs.callerId, oldIds));
    await db.delete(notifications).where(inArray(notifications.userId, oldIds));
    await db.delete(users).where(inArray(users.id, oldIds));
  }
  console.log(`清理用户 ${oldIds.length}，课程 ${rows.length}`);
}

async function main() {
  const rankings = JSON.parse(
    readFileSync(path.join(__dirname, 'data/digital-media-24-rankings.json'), 'utf8')
  ) as RankRow[];
  console.log(`载入名单 ${rankings.length} 人`);

  await cleanup();
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  // ---- 教师与课程 ----
  const [teacher] = await db
    .insert(users)
    .values({
      email: `teacher${DOMAIN}`,
      name: '王教授',
      passwordHash,
      role: 'member',
      studentNo: 'T001',
      status: 'active'
    })
    .returning();

  const course = await createCourse(
    {
      name: '数字图像',
      code: COURSE_CODE,
      term: '2025-2026-1',
      description: '图像增强、分割与风格迁移综合项目（中后期演示数据）'
    },
    teacher.id
  );
  await db
    .update(courseSettings)
    .set({
      groupCount: 8,
      minGroupSize: 4,
      maxGroupSize: 5,
      allowCrossClass: false,
      requireContract: true,
      requirePeerReview: true
    })
    .where(eq(courseSettings.courseId, course.id));
  console.log(`课程：${course.name}（${course.code}）`);

  // ---- 班级 ----
  const classIdByKey = new Map<string, number>();
  for (const key of ['24-1', '24-2', '24-3'] as const) {
    const meta = CLASS_META[key];
    const [row] = await db
      .insert(classes)
      .values({
        courseId: course.id,
        name: meta.name,
        major: meta.major,
        grade: meta.grade,
        memberCount: 0
      })
      .returning();
    classIdByKey.set(key, row.id);
  }

  // ---- 名单 + 技能卡 + 画像 ----
  console.log('== 导入 119 人名单与技能卡 ==');
  const userIdByNo = new Map<string, number>();
  const userRowByNo = new Map<string, RankRow>();
  for (const row of rankings) {
    const r = await addEnrollment(course.id, {
      email: `s${row.studentNo}${DOMAIN}`,
      name: row.name,
      studentNo: row.studentNo,
      role: 'member',
      classId: classIdByKey.get(row.classKey)!
    });
    await db
      .update(users)
      .set({ passwordHash, status: 'active' })
      .where(eq(users.id, r.userId));
    await upsertSkillCard(course.id, r.userId, { skills: skillsFor(row) });
    userIdByNo.set(row.studentNo, r.userId);
    userRowByNo.set(row.studentNo, row);
  }
  // 班级人数
  for (const [key, cid] of classIdByKey) {
    const n = rankings.filter((r) => r.classKey === key).length;
    await db.update(classes).set({ memberCount: n }).where(eq(classes.id, cid));
  }
  console.log('名单与技能卡完成');

  // 画像（简化：技能卡合成 + 部分协作倾向）
  for (const row of rankings) {
    const uid = userIdByNo.get(row.studentNo)!;
    const sk = skillsFor(row);
    await db
      .insert(memberProfiles)
      .values({
        courseId: course.id,
        userId: uid,
        capCoding: sk['编程'],
        capWriting: sk['写作'],
        capDesign: sk['设计'],
        capSpeech: sk['表达'],
        capData: sk['数据分析'],
        capResearch: sk['调研'],
        capLeadership: sk['领导力'],
        onTimeRate: (0.55 + (hashNum(row.studentNo, 11) % 40) / 100).toFixed(3),
        avgDelayDays: String(hashNum(row.studentNo, 12) % 3),
        reworkRate: ((hashNum(row.studentNo, 13) % 25) / 100).toFixed(3),
        helpCount: hashNum(row.studentNo, 14) % 6,
        leadCount: hashNum(row.studentNo, 15) % 3,
        memberCount: 3 + (hashNum(row.studentNo, 16) % 4),
        isFirstTimer: false,
        source: 'skill_card',
        confidence: '0.8'
      })
      .onConflictDoNothing();
  }

  // 社交边：同班弱连接 + 少量历史同组
  console.log('== 社交边与约束 ==');
  for (const key of ['24-1', '24-2', '24-3'] as const) {
    const list = rankings.filter((r) => r.classKey === key);
    for (let i = 0; i < list.length; i++) {
      const a = userIdByNo.get(list[i].studentNo)!;
      for (let j = i + 1; j < Math.min(i + 3, list.length); j++) {
        const b = userIdByNo.get(list[j].studentNo)!;
        await db
          .insert(socialEdges)
          .values({
            courseId: course.id,
            userA: Math.min(a, b),
            userB: Math.max(a, b),
            edgeType: 'same_class',
            weight: '0.35',
            lastAt: new Date()
          })
          .onConflictDoNothing();
      }
    }
    // 一对历史同组（强连接）
    const a = userIdByNo.get(list[0].studentNo)!;
    const b = userIdByNo.get(list[1].studentNo)!;
    await db
      .insert(socialEdges)
      .values({
        courseId: course.id,
        userA: Math.min(a, b),
        userB: Math.max(a, b),
        edgeType: 'same_group',
        weight: '0.8',
        lastAt: new Date()
      })
      .onConflictDoNothing();
  }

  // 约束：每班 2 不可同组（必须同组已去掉）。配对取自蛇形分组的相邻组首，
  // 天然分属不同组；落库分组再经 separateForbiddenPairs 兜底，保证开局无 H2。
  const classKeys = ['24-1', '24-2', '24-3'] as const;
  const forbiddenByClass = new Map<string, [number, number][]>();
  for (const key of classKeys) {
    const list = rankings.filter((r) => r.classKey === key);
    const snake = snakeGroups(list, 8).map((b) => b.map((row) => userIdByNo.get(row.studentNo)!));
    const candidates: [number | undefined, number | undefined][] = [
      [snake[0]?.[0], snake[1]?.[0]],
      [snake[2]?.[0], snake[3]?.[0]]
    ];
    const pairs = candidates
      .filter((p): p is [number, number] => p.every((x) => typeof x === 'number'))
      .slice(0, 2);
    forbiddenByClass.set(key, pairs);
    if (pairs.length > 0) {
      await db.insert(constraints).values(
        pairs.map((p, i) => ({
          courseId: course.id,
          type: 'no_same_group' as const,
          memberA: p[0],
          memberB: p[1],
          note: i === 0 ? '历史合作冲突' : '时间不可协调',
          createdBy: teacher.id,
          status: 'active' as const
        }))
      );
    }
  }

  // ---- 分组（确定性蛇形，挂班级；与不可同组约束对齐）----
  console.log('== 分组：每班 8 组 ==');
  const [run] = await db
    .insert(groupingRuns)
    .values({
      courseId: course.id,
      triggeredBy: teacher.id,
      mode: 'manual',
      params: { studentCount: rankings.length, strategy: 'snake_seed' },
      status: 'ok',
      solverStatus: 'manual',
      durationMs: 120,
      solutionsFound: 3
    })
    .returning();

  // 三方案 userId 快照：A=蛇形；B=相邻组尾部互换；C=组间轮转（保证工作台预览非空且可切换）
  const bucketsByClass = classKeys.map((key) => {
    const rows = rankings.filter((r) => r.classKey === key);
    const snake = snakeGroups(rows, 8).map((b) => b.map((row) => userIdByNo.get(row.studentNo)!));
    return separateForbiddenPairs(snake, forbiddenByClass.get(key) ?? []);
  });
  const snapA: number[][] = bucketsByClass.flat();
  const snapB: number[][] = snapA.map((g) => [...g]);
  for (let i = 0; i + 1 < snapB.length; i += 2) {
    if (snapB[i].length > 0 && snapB[i + 1].length > 0) {
      const a = snapB[i].pop()!;
      const b = snapB[i + 1].pop()!;
      snapB[i].push(b);
      snapB[i + 1].push(a);
    }
  }
  const snapC: number[][] = snapA.map((g) => [...g]);
  for (let i = 0; i < snapC.length; i++) {
    if (snapC[i].length > 1) {
      const m = snapC[i].shift()!;
      snapC[(i + 1) % snapC.length].push(m);
    }
  }
  // B/C 变换可能重新引入同组冲突，统一再消解一次
  const allForbidden = classKeys.flatMap((key) => forbiddenByClass.get(key) ?? []);
  const snapByStrategy: Record<string, number[][]> = {
    skill_first: snapA,
    weaktie_first: separateForbiddenPairs(snapB, allForbidden),
    fairness_first: separateForbiddenPairs(snapC, allForbidden)
  };

  const planSeeds = [
    { label: '方案A · 能力互补优先（推荐）', strategy: 'skill_first', total: '86.4', s: '88.2', w: '79.1', b: '90.3', h: '84.0' },
    { label: '方案B · 弱连接优先', strategy: 'weaktie_first', total: '84.1', s: '82.0', w: '88.5', b: '84.2', h: '81.6' },
    { label: '方案C · 公平优先', strategy: 'fairness_first', total: '85.2', s: '83.5', w: '78.0', b: '92.1', h: '83.4' }
  ];
  const planIds: number[] = [];
  for (const p of planSeeds) {
    const snapshot = snapByStrategy[p.strategy] ?? snapA;
    const [pl] = await db
      .insert(groupingPlans)
      .values({
        runId: run.id,
        label: p.label,
        strategy: p.strategy,
        totalScore: p.total,
        scoreSkillCover: p.s,
        scoreWeakTie: p.w,
        scoreBalance: p.b,
        scoreHistoryAvoid: p.h,
        explanation: '按综合测评蛇形混编，兼顾能力互补与组间均衡（种子数据）。',
        groups: snapshot,
        originalGroups: snapshot,
        weights: {},
        isSelected: p.strategy === 'skill_first',
        selectedAt: p.strategy === 'skill_first' ? new Date() : null,
        selectedBy: p.strategy === 'skill_first' ? teacher.id : null
      })
      .returning();
    planIds.push(pl.id);
  }
  const selectedPlanId = planIds[0];

  const groupMeta: {
    groupId: number;
    classKey: string;
    wave: Wave;
    members: { userId: number; row: RankRow }[];
    captainId: number;
    index: number;
  }[] = [];

  let gIndex = 0;
  const rowByUserId = new Map(rankings.map((r) => [userIdByNo.get(r.studentNo)!, r]));
  // 与方案 A 快照共用同一套分桶，保证工作台预览与已落库小组一致
  for (let ci = 0; ci < classKeys.length; ci++) {
    const key = classKeys[ci];
    const buckets = bucketsByClass[ci] ?? [];
    for (const bucket of buckets) {
      const wave = waveFor(gIndex);
      const [group] = await db
        .insert(groups)
        .values({
          courseId: course.id,
          classId: classIdByKey.get(key)!,
          planId: selectedPlanId,
          name: `${CLASS_META[key].name.slice(-2)}-${String(gIndex % 8 + 1).padStart(2, '0')}`,
          status: 'active',
          formedAt: new Date(Date.now() - 28 * 86400000),
          milestoneProgress: wave === 'smooth' ? '0.75' : wave === 'congested' ? '0.52' : '0.38'
        })
        .returning();
      const members = bucket.map((userId) => ({ userId, row: rowByUserId.get(userId)! }));
      // 组长：综测最好的一位
      const captain = members.reduce((a, b) => (a.row.gpaRank <= b.row.gpaRank ? a : b));
      await db.update(groups).set({ captainId: captain.userId }).where(eq(groups.id, group.id));
      await db.insert(groupMembers).values(
        members.map((m) => ({
          groupId: group.id,
          userId: m.userId,
          duty: m.userId === captain.userId ? 'lead' : 'contributor',
          joinedAt: new Date(Date.now() - 28 * 86400000)
        }))
      );
      await db
        .update(courseMemberships)
        .set({ role: 'captain' })
        .where(
          and(
            eq(courseMemberships.courseId, course.id),
            eq(courseMemberships.userId, captain.userId)
          )
        );
      groupMeta.push({
        groupId: group.id,
        classKey: key,
        wave,
        members,
        captainId: captain.userId,
        index: gIndex
      });
      gIndex++;
    }
  }
  console.log(`落库小组 ${groupMeta.length} 个`);

  // 演示别名账号
  const demoCaptain = groupMeta.find((g) => g.classKey === '24-1')!;
  const demoMemberGroup = groupMeta.find((g) => g.classKey === '24-1' && g.index !== demoCaptain.index)!;
  await db
    .update(users)
    .set({ email: `captain${DOMAIN}` })
    .where(eq(users.id, demoCaptain.captainId));
  const demoMember = demoMemberGroup.members.find((m) => m.userId !== demoMemberGroup.captainId)!;
  await db
    .update(users)
    .set({ email: `member${DOMAIN}` })
    .where(eq(users.id, demoMember.userId));

  // ---- 每组：任务 DAG + 契约 + 状态事件 ----
  console.log('== 任务 / 契约 / 交付物 / 信号 ==');
  const now = Date.now();
  for (const g of groupMeta) {
    const [plan] = await db
      .insert(taskPlans)
      .values({
        groupId: g.groupId,
        assignmentTitle: '图像增强与风格迁移系统',
        assignmentText: ASSIGNMENT,
        llmModel: 'template-digi-image-v1',
        promptTokens: 0,
        completionTokens: 0,
        validated: true,
        validateProblems: []
      })
      .returning();

    const idByCode = new Map<string, number>();
    const statusPlan: Record<string, string> = {};
    // 中后期状态波形
    TASK_TEMPLATE.forEach((t, i) => {
      if (g.wave === 'smooth') {
        statusPlan[t.code] = i < 6 ? 'done' : i < 8 ? (i === 7 ? 'doing' : 'reviewing') : 'todo';
      } else if (g.wave === 'congested') {
        statusPlan[t.code] =
          i < 4 ? 'done' : t.code === 'T6' ? 'blocked' : i < 7 ? 'doing' : i < 8 ? 'todo' : 'todo';
      } else {
        statusPlan[t.code] =
          i < 3 ? 'done' : t.code === 'T5' ? 'blocked' : t.code === 'T6' ? 'todo' : i < 6 ? 'doing' : 'todo';
      }
    });

    for (const [i, t] of TASK_TEMPLATE.entries()) {
      const status = statusPlan[t.code] ?? 'todo';
      const due = new Date(now - (14 - i * 1.5) * 86400000);
      const [task] = await db
        .insert(tasks)
        .values({
          planId: plan.id,
          groupId: g.groupId,
          code: t.code,
          title: t.title,
          description: `${t.title}（数字图像大作业）`,
          milestone: t.milestone,
          orderIndex: i,
          estHours: String(t.estHours),
          status,
          deliverableType: t.code.startsWith('T7') || t.code.startsWith('T9') ? 'slide' : t.code === 'T2' ? 'dataset' : t.code === 'T3' || t.code === 'T4' || t.code === 'T5' || t.code === 'T6' ? 'code' : 'document',
          priority: t.code === 'T6' || t.code === 'T8' ? 'high' : 'normal',
          dueAt: due,
          startedAt: status === 'todo' ? null : new Date(now - (21 - i) * 86400000),
          completedAt: status === 'done' ? new Date(now - (10 - i) * 86400000) : null,
          blockedReason: status === 'blocked' ? '等待上游数据/口径对齐' : null,
          onCriticalPath: t.code === 'T3' || t.code === 'T6' || t.code === 'T8' || t.code === 'T9',
          createdBy: g.captainId
        })
        .returning();
      idByCode.set(t.code, task.id);

      // RACI：lead 轮转，全员覆盖
      const memberIds = g.members.map((m) => m.userId);
      const lead = memberIds[i % memberIds.length];
      const helper = memberIds[(i + 1) % memberIds.length];
      await db.insert(taskAssignments).values([
        {
          taskId: task.id,
          userId: lead,
          raci: 'lead',
          assignedBy: g.captainId,
          assignedAt: new Date(now - 25 * 86400000)
        },
        {
          taskId: task.id,
          userId: helper,
          raci: i % 3 === 0 ? 'reviewer' : 'contributor',
          assignedBy: g.captainId,
          assignedAt: new Date(now - 25 * 86400000)
        }
      ]);

      // 状态事件时间线
      const events: { from: string | null; to: string; note?: string }[] = [];
      if (status !== 'todo') {
        events.push({ from: 'todo', to: 'doing', note: '开始执行' });
        if (status === 'done') {
          events.push({ from: 'doing', to: 'reviewing', note: '提交审阅' });
          events.push({ from: 'reviewing', to: 'done', note: '审阅通过' });
        } else if (status === 'reviewing') {
          events.push({ from: 'doing', to: 'reviewing', note: '提交审阅' });
        } else if (status === 'blocked') {
          events.push({ from: 'doing', to: 'blocked', note: '等待上游任务/口径统一' });
        }
        if (g.wave !== 'smooth' && i === 2) {
          events.push({ from: 'reviewing', to: 'doing', note: '返工：图表口径不一致' });
          events.push({ from: 'doing', to: 'done', note: '返工完成' });
        }
      }
      for (const [ei, ev] of events.entries()) {
        await db.insert(taskStatusEvents).values({
          taskId: task.id,
          fromStatus: ev.from,
          toStatus: ev.to,
          actorId: memberIds[(i + ei) % memberIds.length],
          note: ev.note ?? null,
          createdAt: new Date(now - (24 - i * 1.2 - ei * 0.3) * 86400000)
        });
        await db.insert(progressSignals).values({
          groupId: g.groupId,
          taskId: task.id,
          userId: memberIds[(i + ei) % memberIds.length],
          signalType: 'status_changed',
          payload: { to: ev.to },
          observedAt: new Date(now - (24 - i) * 86400000)
        });
      }
    }

    // deps
    for (const t of TASK_TEMPLATE) {
      const tid = idByCode.get(t.code)!;
      for (const d of t.deps) {
        await db.insert(taskDeps).values({ taskId: tid, dependsOnId: idByCode.get(d)! });
      }
    }

    // 契约
    const [contract] = await db
      .insert(contracts)
      .values({
        groupId: g.groupId,
        version: 1,
        generatedBy: 'g1',
        formatSpec: '报告 PDF + 代码仓库 README；图表须标注单位（PSNR=dB，SSIM 无量纲，mIoU=%）',
        publishedAt: new Date(now - 26 * 86400000),
        publishedBy: g.captainId
      })
      .returning();
    for (const gl of GLOSSARY) {
      await db.insert(contractGlossary).values({
        contractId: contract.id,
        term: gl.term,
        definition: gl.definition,
        unit: gl.unit
      });
    }
    for (const m of g.members.slice(0, Math.max(2, g.members.length - 1))) {
      await db
        .insert(contractAcceptances)
        .values({
          contractId: contract.id,
          userId: m.userId,
          acceptedAt: new Date(now - 25 * 86400000),
          device: 'web'
        })
        .onConflictDoNothing();
    }

    // 交付物：多人分段撰写 + 一次修订
    const artifact = await createArtifact(g.groupId, g.captainId, {
      title: '图像增强与风格迁移报告',
      isFinalDeliverable: true
    });
    const m0 = g.members[0].userId;
    const m1 = g.members[1 % g.members.length].userId;
    const m2 = g.members[2 % g.members.length].userId;
    await saveVersion(artifact.id, m0, [
      { seq: 0, kind: 'heading', content: '一、数据与方法', sourceTaskId: idByCode.get('T1') },
      { seq: 1, kind: 'paragraph', content: para('数据与方法', 320), sourceTaskId: idByCode.get('T2') },
      { seq: 2, kind: 'paragraph', content: para('增强流水线', 280), sourceTaskId: idByCode.get('T3') }
    ]);
    await saveVersion(artifact.id, m1, [
      { seq: 0, kind: 'heading', content: '一、数据与方法', sourceTaskId: idByCode.get('T1') },
      { seq: 1, kind: 'paragraph', content: para('数据与方法', 320), sourceTaskId: idByCode.get('T2') },
      { seq: 2, kind: 'paragraph', content: para('增强流水线', 280), sourceTaskId: idByCode.get('T3') },
      { seq: 3, kind: 'heading', content: '二、实验结果', sourceTaskId: idByCode.get('T4') },
      { seq: 4, kind: 'paragraph', content: para('对比实验与指标', 360), sourceTaskId: idByCode.get('T4') }
    ]);
    await saveVersion(artifact.id, m2, [
      { seq: 0, kind: 'heading', content: '一、数据与方法', sourceTaskId: idByCode.get('T1') },
      { seq: 1, kind: 'paragraph', content: para('数据与方法', 320), sourceTaskId: idByCode.get('T2') },
      { seq: 2, kind: 'paragraph', content: para('增强流水线', 280), sourceTaskId: idByCode.get('T3') },
      { seq: 3, kind: 'heading', content: '二、实验结果', sourceTaskId: idByCode.get('T4') },
      { seq: 4, kind: 'paragraph', content: para('对比实验与指标', 360), sourceTaskId: idByCode.get('T4') },
      { seq: 5, kind: 'paragraph', content: para('风格迁移与讨论', 300), sourceTaskId: idByCode.get('T6') }
    ]);
    // 段落信号
    for (const uid of [m0, m1, m2]) {
      await db.insert(progressSignals).values({
        groupId: g.groupId,
        userId: uid,
        signalType: 'segment_edited',
        payload: { artifactId: artifact.id }
      });
    }

    // 内容冲突（契约口径）+ 归因
    await detectConflicts(g.groupId, 'auto');
    const [contentConflict] = await db
      .insert(conflicts)
      .values({
        groupId: g.groupId,
        taskId: idByCode.get('T8')!,
        type: 'content',
        severity: g.wave === 'smooth' ? 'low' : 'medium',
        status: 'open',
        detectedBy: 'rule',
        title: '报告中 PSNR 口径表述不一致',
        summary:
          '段落 A 写「高峰纹理区 PSNR 约 28dB」，段落 B 写「全图 PSNR 28」。契约要求标注统计范围。'
      })
      .returning();
    await db.insert(conflictAttributions).values({
      conflictId: contentConflict.id,
      kind: '口径不一致',
      severity: 'medium',
      reason:
        '双方原文对 PSNR 统计范围描述不同（「高峰纹理区」vs「全图」），与契约中 SSIM/PSNR 口径条款冲突。',
      suggestion: '统一为分区域报告 PSNR，并在表注写明统计范围。',
      mergedText: '纹理区 PSNR=28.1dB（n=12）；全图 PSNR=26.4dB。',
      llmModel: 'rule:template'
    });
    if (g.index % 3 === 0) {
      await db
        .update(conflicts)
        .set({ status: 'resolved', resolvedAt: new Date(now - 2 * 86400000) })
        .where(eq(conflicts.id, contentConflict.id));
      await db.insert(conflictResolutions).values({
        conflictId: contentConflict.id,
        action: 'realign',
        note: '按契约统一 PSNR 口径并改写两段',
        actorId: g.captainId,
        resolvedAt: new Date(now - 2 * 86400000)
      });
    }

    // 重规划：拥堵/危机（显式触发，type 已能过阈值）
    if (g.wave !== 'smooth') {
      const replan = await triggerReplan(g.groupId, g.wave === 'crisis' ? 'critical_delay' : 'member_idle', {
        triggerTaskId: idByCode.get(g.wave === 'crisis' ? 'T5' : 'T6'),
        delayDays: g.wave === 'crisis' ? 4 : 2,
        actorId: teacher.id
      });
      if (!('triggered' in replan) || !replan.triggered) {
        // 兜底：保证演示数据里重规划中心非空
        await triggerReplan(g.groupId, 'manual', {
          triggerTaskId: idByCode.get(g.wave === 'crisis' ? 'T5' : 'T6'),
          delayDays: g.wave === 'crisis' ? 4 : 2,
          actorId: teacher.id
        });
      }
    }

    // 健康度（algo；失败则占位）
    try {
      await computeGroupHealth(g.groupId);
      await computeGroupHealth(g.groupId);
    } catch {
      await db.insert(groupHealthSnapshots).values({
        groupId: g.groupId,
        snapshotAt: new Date(now - 86400000),
        blockedScore: g.wave === 'smooth' ? '92' : g.wave === 'congested' ? '55' : '32',
        idleScore: g.wave === 'smooth' ? '88' : g.wave === 'congested' ? '62' : '40',
        overloadScore: g.wave === 'smooth' ? '85' : g.wave === 'congested' ? '70' : '48',
        onTrackRatio: g.wave === 'smooth' ? '0.85' : g.wave === 'congested' ? '0.55' : '0.35',
        criticalDelayDays: g.wave === 'smooth' ? '0' : g.wave === 'congested' ? '2' : '5',
        openConflicts: g.wave === 'smooth' ? 1 : 2,
        unassignedTasks: 0,
        diagnosis: g.wave === 'smooth' ? ['整体顺利'] : ['关键路径存在延误']
      });
    }

    // 贡献账本
    try {
      await computeGroupContributions(g.groupId);
    } catch (err) {
      console.warn('贡献计算失败', g.groupId, err instanceof Error ? err.message : err);
    }

    // 通知
    await db.insert(notifications).values({
      userId: g.captainId,
      type: 'task_assigned',
      title: '任务计划已生成（中后期）',
      body: '图像增强与风格迁移系统 · 请查看分工与关键路径',
      link: `/dashboard/courses/${course.id}/tasks`,
      groupId: g.groupId,
      priority: 'normal'
    });
    if (g.wave === 'crisis') {
      for (const m of g.members) {
        await db.insert(notifications).values({
          userId: m.userId,
          type: 'alert',
          title: '小组健康度下降',
          body: '关键路径任务延误，请查看预警与重规划方案',
          link: `/dashboard/courses/${course.id}/alerts`,
          groupId: g.groupId,
          priority: 'urgent'
        });
      }
    }
  }

  // ---- 互评一轮 ----
  console.log('== 同伴互评 ==');
  const round = await createRound(course.id, teacher.id, {
    name: '期中同伴互评',
    openAt: new Date(now - 7 * 86400000).toISOString(),
    closeAt: new Date(now - 1 * 86400000).toISOString(),
    isAnonymous: true
  });
  await openRound(round.id);
  for (const g of groupMeta) {
    for (const reviewer of g.members) {
      for (const reviewee of g.members) {
        if (reviewee.userId === reviewer.userId) continue;
        // 部分人未交（完成率 ~90%）；危机组更少
        const skipRate = g.wave === 'smooth' ? 8 : g.wave === 'congested' ? 12 : 18;
        if (hashNum(`${reviewer.userId}-${reviewee.userId}`, 21) % 100 < skipRate) continue;
        const base = g.wave === 'crisis' ? 3 : 4;
        const scores: Record<string, number> = {
          贡献: Math.max(1, Math.min(5, base + ((hashNum(`${reviewer}${reviewee}`, 22) % 3) - 1))),
          沟通: Math.max(1, Math.min(5, base + ((hashNum(`${reviewer}${reviewee}`, 23) % 3) - 1))),
          负责: Math.max(1, Math.min(5, base + ((hashNum(`${reviewer}${reviewee}`, 24) % 3) - 1))),
          质量: Math.max(1, Math.min(5, base + ((hashNum(`${reviewer}${reviewee}`, 25) % 3) - 1))),
          技能: Math.max(1, Math.min(5, base + ((hashNum(`${reviewer}${reviewee}`, 26) % 3) - 1)))
        };
        // 偶发极端分（供异常检测）
        if (hashNum(`${reviewer.userId}x`, 27) % 40 === 0) scores['贡献'] = 1;
        await submitReview(round.id, reviewer.userId, {
          revieweeId: reviewee.userId,
          scores,
          comment: '按契约口径完成了所负责部分，沟通顺畅。'
        });
      }
    }
  }
  await closeRound(round.id);
  await publishRound(round.id);
  try {
    await detectAnomalies(round.id);
  } catch {
    /* ignore */
  }

  // ---- 终审样例 + 申诉 ----
  console.log('== 终审与申诉 ==');
  const snaps = await db
    .select()
    .from(contributionSnapshots)
    .orderBy(contributionSnapshots.id)
    .limit(40);
  let locked = 0;
  for (const s of snaps.slice(0, 8)) {
    const { reviewSnapshot } = await import('../lib/services/contributions');
    await reviewSnapshot(s.id, teacher.id, {
      adjustedLow: Number(s.lowPct) - 0.5,
      adjustedHigh: Number(s.highPct) + 0.5,
      finalNote: '证据链完整，按区间上限给定。'
    });
    locked++;
    void locked;
  }
  if (snaps[0]) {
    const { submitAppeal, handleAppeal } = await import('../lib/services/contributions');
    const appeal = await submitAppeal(snaps[0].id, snaps[0].userId, {
      reason: '我认为协作段落被计入不足，补充了修订记录。'
    });
    await handleAppeal(appeal.id, teacher.id, {
      status: 'reviewing',
      resultNote: '已收到，正在核对段落修订记录。'
    });
  }

  // ---- 审计与 AI 日志 ----
  await db.insert(auditLogs).values([
    {
      actorId: teacher.id,
      actorRole: 'teacher',
      action: 'grouping_select',
      targetType: 'grouping_plan',
      targetId: selectedPlanId,
      after: { note: '选定方案 A（种子）' }
    },
    {
      actorId: teacher.id,
      actorRole: 'teacher',
      action: 'peer_round_publish',
      targetType: 'peer_review_round',
      targetId: round.id,
      after: { name: '期中同伴互评' }
    }
  ]);
  await db.insert(aiCallLogs).values(
    Array.from({ length: 12 }, (_, i) => ({
      endpoint: i % 2 === 0 ? 'decompose' : 'conflict',
      model: 'deepseek-chat',
      promptTokens: 800 + i * 30,
      completionTokens: 400 + i * 10,
      latencyMs: 2500 + i * 100,
      status: 'ok',
      courseId: course.id,
      callerId: teacher.id
    }))
  );

  console.log('== 完成 ==');
  console.log(`课程 DIGI201 · 学生 ${rankings.length} · 小组 ${groupMeta.length}`);
  console.log(`登录：teacher${DOMAIN} / captain${DOMAIN} / member${DOMAIN} · 密码 ${DEMO_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
