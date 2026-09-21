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
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
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
