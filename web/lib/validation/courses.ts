import { z } from 'zod';

// 课程级角色（规格书 S5 权限矩阵）。角色是课程级的：
// 同一学生可以在 A 课当队长、B 课当队员，判定时与小组级 duty 求交。
export const courseRoleSchema = z.enum(['teacher', 'assistant', 'captain', 'member']);

export const courseStatusSchema = z.enum(['draft', 'active', 'archived']);

export const createCourseSchema = z.object({
  name: z.string().min(1, '课程名不能为空').max(100),
  code: z.string().max(32).optional(),
  term: z.string().max(20).optional(),
  description: z.string().max(2000).optional()
});

export const updateCourseSchema = createCourseSchema.partial().extend({
  status: courseStatusSchema.optional()
});

// 权重取值 0–2（四维目标）/ 0–1（三类证据）；证据权重合计必须为 1.0（服务层复核）
export const updateSettingsSchema = z.object({
  groupCount: z.number().int().min(1).max(50).optional(),
  minGroupSize: z.number().int().min(1).max(8).optional(),
  maxGroupSize: z.number().int().min(1).max(8).optional(),
  allowCrossClass: z.boolean().optional(),
  requireContract: z.boolean().optional(),
  requirePeerReview: z.boolean().optional(),
  wSkillCover: z.number().min(0).max(2).optional(),
  wWeakTie: z.number().min(0).max(2).optional(),
  wBalance: z.number().min(0).max(2).optional(),
  wHistoryAvoid: z.number().min(0).max(2).optional(),
  wArtifact: z.number().min(0).max(1).optional(),
  wProcess: z.number().min(0).max(1).optional(),
  wPeer: z.number().min(0).max(1).optional(),
  fairShareThreshold: z.number().min(0).max(1).optional(),
  delayTriggerDays: z.number().int().min(0).max(30).optional(),
  idleTriggerDays: z.number().int().min(1).max(30).optional(),
  aiEnabled: z.boolean().optional(),
  aiMonthlyBudgetCents: z.number().int().min(0).nullable().optional()
});

export const addEnrollmentSchema = z
  .object({
    email: z.string().email().optional(),
    studentNo: z.string().max(32).optional(),
    name: z.string().max(100).optional(),
    classId: z.number().int().optional(),
    role: courseRoleSchema.optional()
  })
  .refine((v) => v.email || v.studentNo, 'email 或 studentNo 至少提供一个');

// CSV 批量导入：表头 name,email,student_no,class_name（逗号分隔）
export const importEnrollmentsSchema = z.object({
  csv: z.string().min(1, 'CSV 内容不能为空')
});

// 30 秒可填完的技能卡：七维技能 0–5 + 可用时间 + 意愿
export const skillCardSchema = z.object({
  skills: z.record(z.string().max(16), z.number().int().min(0).max(5)),
  availability: z
    .record(z.string().max(8), z.array(z.string().max(24)))
    .optional()
    .default({}),
  preferRoles: z.array(z.string().max(20)).optional().default([]),
  preferTeammates: z.array(z.number().int()).optional().default([]),
  avoidTeammates: z.array(z.number().int()).optional().default([]),
  selfNote: z.string().max(500).optional()
});

export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
export type AddEnrollmentInput = z.infer<typeof addEnrollmentSchema>;
// 技能卡有带默认值的可选字段，服务层入参用 input 类型（允许省略）
export type SkillCardInput = z.input<typeof skillCardSchema>;
