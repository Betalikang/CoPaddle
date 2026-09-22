import {
  pgTable,
  serial,
  varchar,
  text,
  timestamp,
  integer,
  boolean,
  smallint,
  numeric,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ============================================================
// 基座表（nextjs/saas-starter，登录流依赖，保留原样）
// 注意：teams/team_members/invitations 是基座的「团队」概念，
// 共桨的教学域用 courses/classes/groups（S2 期建），二者并存。
// users.role 为基座遗留字段；共桨的角色是课程级的，
// 权威来源是 course_memberships.role（规格书 S1 建模红线）。
// ============================================================

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }),
  email: varchar('email', { length: 255 }).notNull().unique(),
  // 共桨扩展：学号唯一（教师批量导入名单的主键之一）
  studentNo: varchar('student_no', { length: 32 }).unique(),
  avatarUrl: text('avatar_url'),
  locale: varchar('locale', { length: 10 }).notNull().default('zh-CN'),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  lastLoginAt: timestamp('last_login_at'),
  passwordHash: text('password_hash').notNull(),
  role: varchar('role', { length: 20 }).notNull().default('member'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
});

export const teams = pgTable('teams', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  stripeCustomerId: text('stripe_customer_id').unique(),
  stripeSubscriptionId: text('stripe_subscription_id').unique(),
  stripeProductId: text('stripe_product_id'),
  planName: varchar('plan_name', { length: 50 }),
  subscriptionStatus: varchar('subscription_status', { length: 20 }),
});

export const teamMembers = pgTable('team_members', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
  role: varchar('role', { length: 50 }).notNull(),
  joinedAt: timestamp('joined_at').notNull().defaultNow(),
});

export const activityLogs = pgTable('activity_logs', {
  id: serial('id').primaryKey(),
  // 共桨账号级操作（登录/登出/改密）也写活动记录：team_id 可空
  teamId: integer('team_id').references(() => teams.id),
  userId: integer('user_id').references(() => users.id),
  action: text('action').notNull(),
  timestamp: timestamp('timestamp').notNull().defaultNow(),
  ipAddress: varchar('ip_address', { length: 45 }),
});

// 基座的「团队邀请」；共桨的「课程邀请」见 courseInvitations（避免同名冲突）
export const invitations = pgTable('invitations', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
  email: varchar('email', { length: 255 }).notNull(),
  role: varchar('role', { length: 50 }).notNull(),
  invitedBy: integer('invited_by')
    .notNull()
    .references(() => users.id),
  invitedAt: timestamp('invited_at').notNull().defaultNow(),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
});

// ============================================================
// 共桨域①：身份与课程（规格书 S1）
// ============================================================

export const courses = pgTable(
  'courses',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    code: varchar('code', { length: 32 }),
    term: varchar('term', { length: 20 }).notNull().default('2026-2027-1'),
    teacherId: integer('teacher_id')
      .notNull()
      .references(() => users.id),
    description: text('description'),
    // draft 可自由改设置；active 后需先移除已有分组才能改组数与规模；archived 只读
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    startAt: timestamp('start_at'),
    endAt: timestamp('end_at'),
    coverUrl: text('cover_url'),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    deletedAt: timestamp('deleted_at'),
  },
  (t) => [
    index('courses_teacher_id_idx').on(t.teacherId),
    index('courses_status_idx').on(t.status),
  ]
);

export const courseSettings = pgTable('course_settings', {
  courseId: integer('course_id')
    .primaryKey()
    .references(() => courses.id, { onDelete: 'cascade' }),
  groupCount: integer('group_count').notNull().default(8),
  minGroupSize: integer('min_group_size').notNull().default(3),
  maxGroupSize: integer('max_group_size').notNull().default(6),
  allowCrossClass: boolean('allow_cross_class').notNull().default(false),
  requireContract: boolean('require_contract').notNull().default(true),
  requirePeerReview: boolean('require_peer_review').notNull().default(true),
  // 四项目标函数权重，取值 0–2，默认见规格书 S4.2
  wSkillCover: numeric('w_skill_cover', { precision: 3, scale: 2 }).notNull().default('1.20'),
  wWeakTie: numeric('w_weak_tie', { precision: 3, scale: 2 }).notNull().default('0.80'),
  wBalance: numeric('w_balance', { precision: 3, scale: 2 }).notNull().default('1.00'),
  wHistoryAvoid: numeric('w_history_avoid', { precision: 3, scale: 2 }).notNull().default('1.00'),
  // 三类证据权重，合计 1.0（默认 产出物 0.5 / 过程 0.3 / 同伴 0.2）
  wArtifact: numeric('w_artifact', { precision: 3, scale: 2 }).notNull().default('0.50'),
  wProcess: numeric('w_process', { precision: 3, scale: 2 }).notNull().default('0.30'),
  wPeer: numeric('w_peer', { precision: 3, scale: 2 }).notNull().default('0.20'),
  // 搭便车提示阈值（JSS 2023 实证研究：低于应分担份额 14% 即提示）
  fairShareThreshold: numeric('fair_share_threshold', { precision: 3, scale: 2 }).notNull().default('0.14'),
  delayTriggerDays: integer('delay_trigger_days').notNull().default(2),
  idleTriggerDays: integer('idle_trigger_days').notNull().default(3),
  aiEnabled: boolean('ai_enabled').notNull().default(true),
  aiModel: varchar('ai_model', { length: 50 }).notNull().default('deepseek-chat'),
  aiMonthlyBudgetCents: integer('ai_monthly_budget_cents'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const classes = pgTable('classes', {
  id: serial('id').primaryKey(),
  courseId: integer('course_id')
    .notNull()
    .references(() => courses.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  major: varchar('major', { length: 100 }),
  grade: varchar('grade', { length: 20 }),
  advisor: varchar('advisor', { length: 50 }),
  memberCount: integer('member_count').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('classes_course_name_uniq').on(t.courseId, t.name)]);

// ★ 角色是课程级的：同一个学生可以在 A 课当队长、B 课当队员（规格书 S1 红线）
export const courseMemberships = pgTable(
  'course_memberships',
  {
    id: serial('id').primaryKey(),
    courseId: integer('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    // teacher | assistant | captain | member
    role: varchar('role', { length: 20 }).notNull().default('member'),
    classId: integer('class_id').references(() => classes.id),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    joinedAt: timestamp('joined_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('course_memberships_course_user_uniq').on(t.courseId, t.userId),
    index('course_memberships_role_idx').on(t.role),
    index('course_memberships_class_id_idx').on(t.classId),
  ]
);

// 共桨的「课程邀请」（基座 invitations 是团队邀请，勿混用）
export const courseInvitations = pgTable('course_invitations', {
  id: serial('id').primaryKey(),
  courseId: integer('course_id')
    .notNull()
    .references(() => courses.id, { onDelete: 'cascade' }),
  inviterId: integer('inviter_id')
    .notNull()
    .references(() => users.id),
  email: varchar('email', { length: 255 }).notNull(),
  token: varchar('token', { length: 64 }).notNull().unique(),
  role: varchar('role', { length: 20 }).notNull().default('member'),
  classId: integer('class_id').references(() => classes.id),
  expiresAt: timestamp('expires_at'),
  acceptedAt: timestamp('accepted_at'),
  acceptedBy: integer('accepted_by').references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('course_invitations_token_idx').on(t.token), index('course_invitations_email_idx').on(t.email)]);

// ============================================================
// 共桨域②：画像与约束（规格书 S1）
// ============================================================

export const skillCards = pgTable('skill_cards', {
  id: serial('id').primaryKey(),
  courseId: integer('course_id')
    .notNull()
    .references(() => courses.id, { onDelete: 'cascade' }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  skills: jsonb('skills').$type<Record<string, number>>(),
  availability: jsonb('availability').$type<Record<string, string[]>>(),
  preferRoles: jsonb('prefer_roles').$type<string[]>(),
  // 仅作软偏好，不保证满足；需教师审核后才转为 constraints
  preferTeammates: jsonb('prefer_teammates').$type<number[]>(),
  // 学生自行填写的回避申请，必须经教师审核转 constraints 才生效（防排挤）
  avoidTeammates: jsonb('avoid_teammates').$type<number[]>(),
  selfNote: text('self_note'),
  submittedAt: timestamp('submitted_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('skill_cards_course_user_uniq').on(t.courseId, t.userId)]);

export const memberProfiles = pgTable('member_profiles', {
  id: serial('id').primaryKey(),
  courseId: integer('course_id')
    .notNull()
    .references(() => courses.id, { onDelete: 'cascade' }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  // 能力向量 0–5，由技能卡与历史成绩合成
  capCoding: smallint('cap_coding').notNull().default(0),
  capWriting: smallint('cap_writing').notNull().default(0),
  capDesign: smallint('cap_design').notNull().default(0),
  capSpeech: smallint('cap_speech').notNull().default(0),
  capData: smallint('cap_data').notNull().default(0),
  capResearch: smallint('cap_research').notNull().default(0),
  capLeadership: smallint('cap_leadership').notNull().default(0),
  // 协作倾向，由历史行为统计（敏感字段：不向学生互见，规格书 S5）
  onTimeRate: numeric('on_time_rate', { precision: 4, scale: 3 }).notNull().default('1.000'),
  avgDelayDays: numeric('avg_delay_days', { precision: 5, scale: 2 }).notNull().default('0.00'),
  reworkRate: numeric('rework_rate', { precision: 4, scale: 3 }).notNull().default('0.000'),
  helpCount: integer('help_count').notNull().default(0),
  leadCount: integer('lead_count').notNull().default(0),
  memberCount: integer('member_count').notNull().default(0),
  isFirstTimer: boolean('is_first_timer').notNull().default(true),
  // 来源标记，用于冷启动判定
  source: varchar('source', { length: 20 }).notNull().default('default'),
  confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull().default('0.50'),
  computedAt: timestamp('computed_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('member_profiles_course_user_uniq').on(t.courseId, t.userId)]);

export const memberSkills = pgTable('member_skills', {
  id: serial('id').primaryKey(),
  profileId: integer('profile_id')
    .notNull()
    .references(() => memberProfiles.id, { onDelete: 'cascade' }),
  skill: varchar('skill', { length: 32 }).notNull(),
  level: smallint('level').notNull().default(0),
  source: varchar('source', { length: 20 }).notNull().default('skill_card'),
}, (t) => [index('member_skills_skill_idx').on(t.skill)]);

export const socialEdges = pgTable(
  'social_edges',
  {
    id: serial('id').primaryKey(),
    courseId: integer('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    userA: integer('user_a')
      .notNull()
      .references(() => users.id),
    userB: integer('user_b')
      .notNull()
      .references(() => users.id),
    // same_group | same_class | co_edited | peer_rated
    edgeType: varchar('edge_type', { length: 20 }).notNull(),
    weight: numeric('weight', { precision: 4, scale: 2 }).notNull().default('1.00'),
    lastAt: timestamp('last_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('social_edges_uniq').on(t.courseId, t.userA, t.userB, t.edgeType)]
);

export const constraints = pgTable('constraints', {
  id: serial('id').primaryKey(),
  courseId: integer('course_id')
    .notNull()
    .references(() => courses.id, { onDelete: 'cascade' }),
  // no_same_group | must_same_group | time_conflict
  type: varchar('type', { length: 30 }).notNull(),
  memberA: integer('member_a')
    .notNull()
    .references(() => users.id),
  memberB: integer('member_b')
    .notNull()
    .references(() => users.id),
  note: text('note'),
  createdBy: integer('created_by').references(() => users.id),
  approvedBy: integer('approved_by').references(() => users.id),
  // pending 状态不参与求解
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('constraints_course_status_idx').on(t.courseId, t.status)]);

// ============================================================
// 共桨域③：分组（规格书 S1）
// ============================================================

export const groupingRuns = pgTable('grouping_runs', {
  id: serial('id').primaryKey(),
  courseId: integer('course_id')
    .notNull()
    .references(() => courses.id, { onDelete: 'cascade' }),
  triggeredBy: integer('triggered_by')
    .notNull()
    .references(() => users.id),
  // cpsat | greedy | manual
  mode: varchar('mode', { length: 20 }).notNull().default('cpsat'),
  // 本次求解的输入参数快照（人数/组数/权重/约束条数），供复现与审计
  params: jsonb('params').$type<Record<string, unknown>>(),
  // running | ok | infeasible | timeout | error
  status: varchar('status', { length: 20 }).notNull().default('running'),
  solverStatus: varchar('solver_status', { length: 20 }),
  durationMs: integer('duration_ms'),
  solutionsFound: integer('solutions_found').notNull().default(0),
  errorDetail: text('error_detail'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('grouping_runs_course_created_idx').on(t.courseId, t.createdAt)]);

export const groupingPlans = pgTable('grouping_plans', {
  id: serial('id').primaryKey(),
  runId: integer('run_id')
    .notNull()
    .references(() => groupingRuns.id, { onDelete: 'cascade' }),
  // 方案A | 方案B | 方案C
  label: varchar('label', { length: 20 }).notNull(),
  // skill_first | weaktie_first | fairness_first
  strategy: varchar('strategy', { length: 30 }).notNull(),
  totalScore: numeric('total_score', { precision: 5, scale: 2 }).notNull().default('0'),
  // 四维原始得分，0–100
  scoreSkillCover: numeric('score_skill_cover', { precision: 5, scale: 2 }).notNull().default('0'),
  scoreWeakTie: numeric('score_weak_tie', { precision: 5, scale: 2 }).notNull().default('0'),
  scoreBalance: numeric('score_balance', { precision: 5, scale: 2 }).notNull().default('0'),
  scoreHistoryAvoid: numeric('score_history_avoid', { precision: 5, scale: 2 }).notNull().default('0'),
  // 模板拼装生成的「为什么这样分」（规格书 S6.3：不让模型编理由）
  explanation: text('explanation'),
  // ---- 以下三列为规格书的工程补充：三选一期间教师要拖动微调，
  // 分组快照与得分必须可被修改并保留（preview-move 的落点）----
  // 当前分组快照：[[user_id,...],...]
  groups: jsonb('groups').$type<number[][]>().notNull(),
  // 求解器原始结果（拖动后「还原」用）
  originalGroups: jsonb('original_groups').$type<number[][]>().notNull(),
  // 本方案的四维权重预设
  weights: jsonb('weights').$type<Record<string, number>>(),
  isSelected: boolean('is_selected').notNull().default(false),
  selectedAt: timestamp('selected_at'),
  selectedBy: integer('selected_by').references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('grouping_plans_run_idx').on(t.runId)]);

export const groups = pgTable('groups', {
  id: serial('id').primaryKey(),
  courseId: integer('course_id')
    .notNull()
    .references(() => courses.id, { onDelete: 'cascade' }),
  planId: integer('plan_id').references(() => groupingPlans.id),
  name: varchar('name', { length: 50 }).notNull().default(''),
  captainId: integer('captain_id').references(() => users.id),
  // forming | active | dissolved | merged
  status: varchar('status', { length: 20 }).notNull().default('forming'),
  mergedInto: integer('merged_into'),
  milestoneProgress: numeric('milestone_progress', { precision: 4, scale: 3 }).notNull().default('0'),
  formedAt: timestamp('formed_at').notNull().defaultNow(),
  dissolvedAt: timestamp('dissolved_at'),
}, (t) => [index('groups_course_status_idx').on(t.courseId, t.status)]);

export const groupMembers = pgTable('group_members', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  // RACI 简化版：lead | contributor | reviewer
  duty: varchar('duty', { length: 20 }).notNull().default('contributor'),
  joinedAt: timestamp('joined_at').notNull().defaultNow(),
  leftAt: timestamp('left_at'),
  leaveReason: text('leave_reason'),
}, (t) => [
  uniqueIndex('group_members_active_uniq').on(t.groupId, t.userId, t.leftAt),
  index('group_members_user_idx').on(t.userId),
]);

// ============================================================
// 共桨域④：任务、依赖与契约（规格书 S1）
// ============================================================

export const taskPlans = pgTable('task_plans', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  assignmentTitle: varchar('assignment_title', { length: 200 }),
  assignmentText: text('assignment_text'),
  assignmentFileUrl: text('assignment_file_url'),
  // 一次拆解产出一个 plan，plan 下挂 tasks
  llmModel: varchar('llm_model', { length: 50 }),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  generatedAt: timestamp('generated_at').notNull().defaultNow(),
  validated: boolean('validated').notNull().default(true),
  // LLM 后置校验未过的问题清单（不静默丢弃，界面高亮人工修正）
  validateProblems: jsonb('validate_problems').$type<string[]>(),
}, (t) => [index('task_plans_group_generated_idx').on(t.groupId, t.generatedAt)]);

export const tasks = pgTable('tasks', {
  id: serial('id').primaryKey(),
  planId: integer('plan_id')
    .notNull()
    .references(() => taskPlans.id, { onDelete: 'cascade' }),
  groupId: integer('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  code: varchar('code', { length: 10 }).notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  description: text('description'),
  milestone: varchar('milestone', { length: 100 }),
  orderIndex: integer('order_index').notNull().default(0),
  estHours: numeric('est_hours', { precision: 5, scale: 1 }).notNull().default('2.0'),
  actualHours: numeric('actual_hours', { precision: 5, scale: 1 }),
  status: varchar('status', { length: 20 }).notNull().default('todo'),
  deliverableType: varchar('deliverable_type', { length: 20 }).notNull().default('document'),
  priority: varchar('priority', { length: 20 }).notNull().default('normal'),
  dueAt: timestamp('due_at'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  blockedReason: text('blocked_reason'),
  onCriticalPath: boolean('on_critical_path').notNull().default(false),
  createdBy: integer('created_by').references(() => users.id),
  deletedAt: timestamp('deleted_at'),
}, (t) => [
  index('tasks_group_status_idx').on(t.groupId, t.status),
  index('tasks_due_at_idx').on(t.dueAt),
  uniqueIndex('tasks_plan_code_uniq').on(t.planId, t.code),
]);

// 有向无环图：写入前必须做环检测（加边时校验）
export const taskDeps = pgTable('task_deps', {
  taskId: integer('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  dependsOnId: integer('depends_on_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
}, (t) => [index('task_deps_task_idx').on(t.taskId)]);

export const taskAssignments = pgTable('task_assignments', {
  id: serial('id').primaryKey(),
  taskId: integer('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  // RACI：lead 主责 | contributor 协作 | reviewer 审阅
  raci: varchar('raci', { length: 20 }).notNull().default('contributor'),
  assignedBy: integer('assigned_by').references(() => users.id),
  assignedAt: timestamp('assigned_at').notNull().defaultNow(),
  acceptedAt: timestamp('accepted_at'),
  workloadShare: numeric('workload_share', { precision: 5, scale: 4 }),
}, (t) => [uniqueIndex('task_assignments_uniq').on(t.taskId, t.userId, t.raci)]);

// 进度信号的第一手来源（B-10 从这里算延期与返工）
export const taskStatusEvents = pgTable('task_status_events', {
  id: serial('id').primaryKey(),
  taskId: integer('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  fromStatus: varchar('from_status', { length: 20 }),
  toStatus: varchar('to_status', { length: 20 }).notNull(),
  actorId: integer('actor_id').references(() => users.id),
  note: text('note'),
  evidenceUrl: text('evidence_url'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('task_status_events_task_created_idx').on(t.taskId, t.createdAt)]);

export const contracts = pgTable('contracts', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  version: smallint('version').notNull().default(1),
  // g1 = LLM 生成 | manual = 人工编辑
  generatedBy: varchar('generated_by', { length: 20 }).notNull().default('g1'),
  formatSpec: text('format_spec'),
  publishedAt: timestamp('published_at'),
  publishedBy: integer('published_by').references(() => users.id),
}, (t) => [index('contracts_group_version_idx').on(t.groupId, t.version)]);

export const contractGlossary = pgTable('contract_glossary', {
  id: serial('id').primaryKey(),
  contractId: integer('contract_id')
    .notNull()
    .references(() => contracts.id, { onDelete: 'cascade' }),
  term: varchar('term', { length: 100 }).notNull(),
  definition: text('definition'),
  // 单位与统计范围是冲突高发区
  unit: varchar('unit', { length: 50 }),
  scope: varchar('scope', { length: 100 }),
  example: text('example'),
});

export const contractAcceptances = pgTable('contract_acceptances', {
  contractId: integer('contract_id')
    .notNull()
    .references(() => contracts.id, { onDelete: 'cascade' }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  acceptedAt: timestamp('accepted_at').notNull().defaultNow(),
  device: varchar('device', { length: 100 }),
});

// ============================================================
// 共桨域⑤：交付物与溯源（规格书 S1，护城河）
// ============================================================

export const artifacts = pgTable('artifacts', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  taskId: integer('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  title: varchar('title', { length: 200 }).notNull(),
  type: varchar('type', { length: 20 }).notNull().default('document'),
  currentVersionId: integer('current_version_id'),
  status: varchar('status', { length: 20 }).notNull().default('draft'),
  // 是否最终交付物（只有它强制在平台内沉淀，规格书产品方案 07）
  isFinalDeliverable: boolean('is_final_deliverable').notNull().default(false),
  createdBy: integer('created_by')
    .notNull()
    .references(() => users.id),
  deletedAt: timestamp('deleted_at'),
}, (t) => [index('artifacts_group_status_idx').on(t.groupId, t.status)]);

export const artifactVersions = pgTable('artifact_versions', {
  id: serial('id').primaryKey(),
  artifactId: integer('artifact_id')
    .notNull()
    .references(() => artifacts.id, { onDelete: 'cascade' }),
  versionNo: smallint('version_no').notNull(),
  // 汇编后的完整文本（段落按 seq 拼接）
  content: text('content'),
  storagePath: text('storage_path'),
  fileSize: integer('file_size'),
  checksum: varchar('checksum', { length: 64 }),
  diffSummary: text('diff_summary'),
  createdBy: integer('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('artifact_versions_uniq').on(t.artifactId, t.versionNo)]);

// ★ 溯源核心表：段落级归属由「平台内撰写」行为天然产生，非学生自报
export const artifactSegments = pgTable('artifact_segments', {
  id: serial('id').primaryKey(),
  versionId: integer('version_id')
    .notNull()
    .references(() => artifactVersions.id, { onDelete: 'cascade' }),
  seq: smallint('seq').notNull(),
  kind: varchar('kind', { length: 20 }).notNull().default('paragraph'),
  authorId: integer('author_id')
    .notNull()
    .references(() => users.id),
  content: text('content').notNull(),
  contentHash: varchar('content_hash', { length: 64 }),
  wordCount: integer('word_count').notNull().default(0),
  sourceTaskId: integer('source_task_id').references(() => tasks.id, { onDelete: 'set null' }),
  revisedBy: integer('revised_by').references(() => users.id),
  revisedCount: smallint('revised_count').notNull().default(0),
}, (t) => [
  index('artifact_segments_version_seq_idx').on(t.versionId, t.seq),
  index('artifact_segments_author_idx').on(t.authorId),
]);

// 每一次段落级动作都留痕，用于区分「主责产出」与「审阅返工」
export const segmentEdits = pgTable('segment_edits', {
  id: serial('id').primaryKey(),
  segmentId: integer('segment_id')
    .notNull()
    .references(() => artifactSegments.id, { onDelete: 'cascade' }),
  editorId: integer('editor_id')
    .notNull()
    .references(() => users.id),
  editType: varchar('edit_type', { length: 20 }).notNull(),
  deltaChars: integer('delta_chars').notNull().default(0),
  beforeHash: varchar('before_hash', { length: 64 }),
  afterHash: varchar('after_hash', { length: 64 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('segment_edits_segment_idx').on(t.segmentId),
  index('segment_edits_editor_idx').on(t.editorId),
]);

// ============================================================
// 共桨域⑥⑧：贡献归因（规格书 S1）
// ============================================================

export const contributionSnapshots = pgTable('contribution_snapshots', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  snapshotAt: timestamp('snapshot_at').notNull().defaultNow(),
  // 贡献构成明细（algo comp：主责产出/协作产出/按时交付/审阅返工/主动补位/同伴评价）
  comp: jsonb('comp').$type<Record<string, number>>(),
  // 区间估计（系统永不输出单一分数）
  lowPct: numeric('low_pct', { precision: 5, scale: 2 }).notNull().default('0'),
  highPct: numeric('high_pct', { precision: 5, scale: 2 }).notNull().default('0'),
  confidence: varchar('confidence', { length: 20 }).notNull().default('low'),
  peerMedian: numeric('peer_median', { precision: 3, scale: 2 }),
  onTimeCount: integer('on_time_count').notNull().default(0),
  delayCount: integer('delay_count').notNull().default(0),
  reworkCount: integer('rework_count').notNull().default(0),
  reviewCount: integer('review_count').notNull().default(0),
  // 应分担份额占比，< 0.14 触发提示
  fairShareRatio: numeric('fair_share_ratio', { precision: 5, scale: 3 }).notNull().default('0'),
  warning: text('warning'),
}, (t) => [
  uniqueIndex('contribution_snapshots_uniq').on(t.groupId, t.userId, t.snapshotAt),
]);

// 每一条结论都必须能追到若干条 evidence_items——这是「可下钻」的实现
export const evidenceItems = pgTable('evidence_items', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  snapshotId: integer('snapshot_id')
    .notNull()
    .references(() => contributionSnapshots.id, { onDelete: 'cascade' }),
  // artifact | process | peer
  source: varchar('source', { length: 20 }).notNull(),
  refType: varchar('ref_type', { length: 30 }),
  refId: integer('ref_id'),
  weight: numeric('weight', { precision: 4, scale: 3 }).notNull().default('1.000'),
  value: numeric('value', { precision: 6, scale: 3 }).notNull().default('0'),
  note: text('note'),
  computedAt: timestamp('computed_at').notNull().defaultNow(),
}, (t) => [
  index('evidence_items_snapshot_idx').on(t.snapshotId),
  index('evidence_items_user_idx').on(t.userId),
]);

// 教师终审：系统只给区间，最终值由教师确定
export const attributionReviews = pgTable('attribution_reviews', {
  id: serial('id').primaryKey(),
  snapshotId: integer('snapshot_id')
    .notNull()
    .references(() => contributionSnapshots.id, { onDelete: 'cascade' }),
  reviewerId: integer('reviewer_id')
    .notNull()
    .references(() => users.id),
  adjustedLow: numeric('adjusted_low', { precision: 5, scale: 2 }),
  adjustedHigh: numeric('adjusted_high', { precision: 5, scale: 2 }),
  finalNote: text('final_note'),
  isLocked: boolean('is_locked').notNull().default(false),
  reviewedAt: timestamp('reviewed_at').notNull().defaultNow(),
});

// 学生申诉通道
export const attributionAppeals = pgTable('attribution_appeals', {
  id: serial('id').primaryKey(),
  snapshotId: integer('snapshot_id')
    .notNull()
    .references(() => contributionSnapshots.id, { onDelete: 'cascade' }),
  appellantId: integer('appellant_id')
    .notNull()
    .references(() => users.id),
  reason: text('reason').notNull(),
  evidenceText: text('evidence_text'),
  attachments: jsonb('attachments').$type<unknown[]>(),
  // submitted | reviewing | accepted | rejected | partially_accepted
  status: varchar('status', { length: 20 }).notNull().default('submitted'),
  handlerId: integer('handler_id').references(() => users.id),
  resultNote: text('result_note'),
  handledAt: timestamp('handled_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('attribution_appeals_status_idx').on(t.status)]);

// ============================================================
// relations（drizzle query API）
// ============================================================

export const teamsRelations = relations(teams, ({ many }) => ({
  teamMembers: many(teamMembers),
  activityLogs: many(activityLogs),
  invitations: many(invitations),
}));

export const usersRelations = relations(users, ({ many }) => ({
  teamMembers: many(teamMembers),
  invitationsSent: many(invitations),
  courseMemberships: many(courseMemberships),
  taughtCourses: many(courses),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  team: one(teams, {
    fields: [invitations.teamId],
    references: [teams.id],
  }),
  invitedBy: one(users, {
    fields: [invitations.invitedBy],
    references: [users.id],
  }),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  user: one(users, {
    fields: [teamMembers.userId],
    references: [users.id],
  }),
  team: one(teams, {
    fields: [teamMembers.teamId],
    references: [teams.id],
  }),
}));

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  team: one(teams, {
    fields: [activityLogs.teamId],
    references: [teams.id],
  }),
  user: one(users, {
    fields: [activityLogs.userId],
    references: [users.id],
  }),
}));

export const coursesRelations = relations(courses, ({ one, many }) => ({
  teacher: one(users, {
    fields: [courses.teacherId],
    references: [users.id],
  }),
  settings: one(courseSettings, {
    fields: [courses.id],
    references: [courseSettings.courseId],
  }),
  classes: many(classes),
  memberships: many(courseMemberships),
}));

export const courseSettingsRelations = relations(courseSettings, ({ one }) => ({
  course: one(courses, {
    fields: [courseSettings.courseId],
    references: [courses.id],
  }),
}));

export const classesRelations = relations(classes, ({ one, many }) => ({
  course: one(courses, {
    fields: [classes.courseId],
    references: [courses.id],
  }),
  memberships: many(courseMemberships),
}));

export const courseMembershipsRelations = relations(courseMemberships, ({ one }) => ({
  course: one(courses, {
    fields: [courseMemberships.courseId],
    references: [courses.id],
  }),
  user: one(users, {
    fields: [courseMemberships.userId],
    references: [users.id],
  }),
  class: one(classes, {
    fields: [courseMemberships.classId],
    references: [classes.id],
  }),
}));

export const skillCardsRelations = relations(skillCards, ({ one }) => ({
  user: one(users, {
    fields: [skillCards.userId],
    references: [users.id],
  }),
}));

// ============================================================
// 类型导出
// ============================================================

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
export type TeamMember = typeof teamMembers.$inferSelect;
export type NewTeamMember = typeof teamMembers.$inferInsert;
export type ActivityLog = typeof activityLogs.$inferSelect;
export type NewActivityLog = typeof activityLogs.$inferInsert;
export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;
export type TeamDataWithMembers = Team & {
  teamMembers: (TeamMember & {
    user: Pick<User, 'id' | 'name' | 'email'>;
  })[];
};

export type Course = typeof courses.$inferSelect;
export type NewCourse = typeof courses.$inferInsert;
export type CourseSettings = typeof courseSettings.$inferSelect;
export type Class = typeof classes.$inferSelect;
export type CourseMembership = typeof courseMemberships.$inferSelect;
export type CourseInvitation = typeof courseInvitations.$inferSelect;
export type SkillCard = typeof skillCards.$inferSelect;
export type MemberProfile = typeof memberProfiles.$inferSelect;
export type MemberSkill = typeof memberSkills.$inferSelect;
export type SocialEdge = typeof socialEdges.$inferSelect;
export type Constraint = typeof constraints.$inferSelect;
export type GroupingRun = typeof groupingRuns.$inferSelect;
export type GroupingPlan = typeof groupingPlans.$inferSelect;
export type Group = typeof groups.$inferSelect;
export type GroupMember = typeof groupMembers.$inferSelect;
export type TaskPlan = typeof taskPlans.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type TaskDep = typeof taskDeps.$inferSelect;
export type TaskAssignment = typeof taskAssignments.$inferSelect;
export type TaskStatusEvent = typeof taskStatusEvents.$inferSelect;
export type Contract = typeof contracts.$inferSelect;
export type ContractGlossary = typeof contractGlossary.$inferSelect;
export type Artifact = typeof artifacts.$inferSelect;
export type ArtifactVersion = typeof artifactVersions.$inferSelect;
export type ArtifactSegment = typeof artifactSegments.$inferSelect;
export type SegmentEdit = typeof segmentEdits.$inferSelect;
export type ContributionSnapshot = typeof contributionSnapshots.$inferSelect;
export type EvidenceItem = typeof evidenceItems.$inferSelect;
export type AttributionReview = typeof attributionReviews.$inferSelect;
export type AttributionAppeal = typeof attributionAppeals.$inferSelect;
export type ProgressSignal = typeof progressSignals.$inferSelect;
export type Milestone = typeof milestones.$inferSelect;
export type GroupHealthSnapshot = typeof groupHealthSnapshots.$inferSelect;
export type Conflict = typeof conflicts.$inferSelect;
export type ConflictAttribution = typeof conflictAttributions.$inferSelect;
export type ConflictResolution = typeof conflictResolutions.$inferSelect;
export type ReplanEvent = typeof replanEvents.$inferSelect;
export type ReplanOption = typeof replanOptions.$inferSelect;
export type PeerReviewRound = typeof peerReviewRounds.$inferSelect;
export type PeerReview = typeof peerReviews.$inferSelect;
export type PeerReviewAnomaly = typeof peerReviewAnomalies.$inferSelect;

// 课程级角色（规格书 S5 权限矩阵）；判定时与小组级 duty 求交
export const COURSE_ROLES = ['teacher', 'assistant', 'captain', 'member'] as const;
export type CourseRole = (typeof COURSE_ROLES)[number];

export enum ActivityType {
  SIGN_UP = 'SIGN_UP',
  SIGN_IN = 'SIGN_IN',
  SIGN_OUT = 'SIGN_OUT',
  UPDATE_PASSWORD = 'UPDATE_PASSWORD',
  DELETE_ACCOUNT = 'DELETE_ACCOUNT',
  UPDATE_ACCOUNT = 'UPDATE_ACCOUNT',
  CREATE_TEAM = 'CREATE_TEAM',
  REMOVE_TEAM_MEMBER = 'REMOVE_TEAM_MEMBER',
  INVITE_TEAM_MEMBER = 'INVITE_TEAM_MEMBER',
  ACCEPT_INVITATION = 'ACCEPT_INVITATION',
}

// ============================================================
// 共桨域⑥：进度与健康度（规格书 S1）
// ============================================================

export const progressSignals = pgTable('progress_signals', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  taskId: integer('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  // deliverable_submitted | status_changed | segment_edited | comment
  // | checkin | idle_detected | peer_helped
  signalType: varchar('signal_type', { length: 30 }).notNull(),
  weight: numeric('weight', { precision: 3, scale: 2 }).notNull().default('1.00'),
  payload: jsonb('payload').$type<Record<string, unknown>>(),
  observedAt: timestamp('observed_at').notNull().defaultNow(),
}, (t) => [
  index('progress_signals_group_observed_idx').on(t.groupId, t.observedAt),
  index('progress_signals_user_idx').on(t.userId),
]);

export const milestones = pgTable('milestones', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  orderIndex: integer('order_index').notNull().default(0),
  dueAt: timestamp('due_at'),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  completedAt: timestamp('completed_at'),
}, (t) => [uniqueIndex('milestones_group_order_uniq').on(t.groupId, t.orderIndex)]);

export const groupHealthSnapshots = pgTable('group_health_snapshots', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  snapshotAt: timestamp('snapshot_at').notNull().defaultNow(),
  // 三维健康度，0–100，越高越好
  blockedScore: numeric('blocked_score', { precision: 5, scale: 1 }).notNull().default('100'),
  idleScore: numeric('idle_score', { precision: 5, scale: 1 }).notNull().default('100'),
  overloadScore: numeric('overload_score', { precision: 5, scale: 1 }).notNull().default('100'),
  onTrackRatio: numeric('on_track_ratio', { precision: 4, scale: 3 }).notNull().default('1.000'),
  criticalDelayDays: numeric('critical_delay_days', { precision: 4, scale: 1 }).notNull().default('0'),
  openConflicts: integer('open_conflicts').notNull().default(0),
  unassignedTasks: integer('unassigned_tasks').notNull().default(0),
  diagnosis: jsonb('diagnosis').$type<string[]>(),
}, (t) => [index('group_health_snapshots_group_snapshot_idx').on(t.groupId, t.snapshotAt)]);

// ============================================================
// 共桨域⑦：冲突与重规划（规格书 S1）
// ============================================================

export const conflicts = pgTable('conflicts', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  taskId: integer('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  // dependency | contract | content
  type: varchar('type', { length: 20 }).notNull(),
  severity: varchar('severity', { length: 20 }).notNull().default('medium'),
  status: varchar('status', { length: 20 }).notNull().default('open'),
  detectedBy: varchar('detected_by', { length: 20 }).notNull().default('auto'),
  detectedAt: timestamp('detected_at').notNull().defaultNow(),
  title: varchar('title', { length: 200 }).notNull().default(''),
  summary: text('summary'),
  resolvedAt: timestamp('resolved_at'),
}, (t) => [index('conflicts_group_status_idx').on(t.groupId, t.status)]);

export const conflictAttributions = pgTable('conflict_attributions', {
  id: serial('id').primaryKey(),
  conflictId: integer('conflict_id')
    .notNull()
    .references(() => conflicts.id, { onDelete: 'cascade' }),
  kind: varchar('kind', { length: 24 }),
  severity: varchar('severity', { length: 20 }),
  reason: text('reason'),
  suggestion: text('suggestion'),
  mergedText: text('merged_text'),
  llmModel: varchar('llm_model', { length: 50 }),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  rawResponse: jsonb('raw_response').$type<unknown>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const conflictResolutions = pgTable('conflict_resolutions', {
  id: serial('id').primaryKey(),
  conflictId: integer('conflict_id')
    .notNull()
    .references(() => conflicts.id, { onDelete: 'cascade' }),
  // merge | realign | reassign | dismiss
  action: varchar('action', { length: 20 }).notNull(),
  actorId: integer('actor_id')
    .notNull()
    .references(() => users.id),
  note: text('note'),
  appliedPayload: jsonb('applied_payload').$type<Record<string, unknown>>(),
  resolvedAt: timestamp('resolved_at').notNull().defaultNow(),
});

export const replanEvents = pgTable('replan_events', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  // critical_delay | member_idle | rework_overflow | deadline_changed | manual
  triggerType: varchar('trigger_type', { length: 30 }).notNull(),
  triggerTaskId: integer('trigger_task_id').references(() => tasks.id, { onDelete: 'set null' }),
  triggerPayload: jsonb('trigger_payload').$type<Record<string, unknown>>(),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  adoptedOptionId: integer('adopted_option_id'),
  handledBy: integer('handled_by').references(() => users.id),
  handledAt: timestamp('handled_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('replan_events_group_status_idx').on(t.groupId, t.status)]);

export const replanOptions = pgTable('replan_options', {
  id: serial('id').primaryKey(),
  eventId: integer('event_id')
    .notNull()
    .references(() => replanEvents.id, { onDelete: 'cascade' }),
  label: varchar('label', { length: 50 }).notNull(),
  // redistribute | scope_cut | borrow_member
  action: varchar('action', { length: 30 }).notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>[]>(),
  // 模板拼装的代价说明（非 LLM）
  costSummary: text('cost_summary'),
  estImpactDays: numeric('est_impact_days', { precision: 4, scale: 1 }).notNull().default('0'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ============================================================
// 共桨域⑨：同伴互评（规格书 S1）
// ============================================================

export const peerReviewRounds = pgTable('peer_review_rounds', {
  id: serial('id').primaryKey(),
  courseId: integer('course_id')
    .notNull()
    .references(() => courses.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  openAt: timestamp('open_at'),
  closeAt: timestamp('close_at'),
  // scheduled | open | closed | published
  status: varchar('status', { length: 20 }).notNull().default('scheduled'),
  isAnonymous: boolean('is_anonymous').notNull().default(true),
  // 默认五维，可由教师自定义：[{key, label}]
  dimensions: jsonb('dimensions').$type<{ key: string; label: string }[]>(),
  createdBy: integer('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('peer_review_rounds_course_status_idx').on(t.courseId, t.status)]);

export const peerReviews = pgTable('peer_reviews', {
  id: serial('id').primaryKey(),
  roundId: integer('round_id')
    .notNull()
    .references(() => peerReviewRounds.id, { onDelete: 'cascade' }),
  groupId: integer('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  reviewerId: integer('reviewer_id')
    .notNull()
    .references(() => users.id),
  revieweeId: integer('reviewee_id')
    .notNull()
    .references(() => users.id),
  // {贡献:4, 沟通:5, ...}
  scores: jsonb('scores').$type<Record<string, number>>().notNull(),
  comment: text('comment'),
  submittedAt: timestamp('submitted_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('peer_reviews_uniq').on(t.roundId, t.reviewerId, t.revieweeId)]);

export const peerReviewAnomalies = pgTable('peer_review_anomalies', {
  id: serial('id').primaryKey(),
  roundId: integer('round_id')
    .notNull()
    .references(() => peerReviewRounds.id, { onDelete: 'cascade' }),
  groupId: integer('group_id')
    .notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  // mutual_inflation | extreme_low | single_source | non_response
  type: varchar('type', { length: 30 }).notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>(),
  severity: varchar('severity', { length: 20 }).notNull().default('medium'),
  detectedAt: timestamp('detected_at').notNull().defaultNow(),
  note: text('note'),
});
