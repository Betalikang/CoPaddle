import { z } from 'zod';

export const generatePlanSchema = z.object({
  assignmentText: z.string().min(1, '作业要求不能为空'),
  assignmentTitle: z.string().max(200).optional(),
  // 重新拆解需确认（丢弃旧计划）
  confirmRegenerate: z.boolean().optional()
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  estHours: z.number().min(0).max(200).optional(),
  dueAt: z.string().datetime().nullable().optional(),
  priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
  deliverableType: z.enum(['document', 'figure', 'table', 'code', 'slide', 'dataset']).optional(),
  milestone: z.string().max(100).nullable().optional(),
  orderIndex: z.number().int().min(0).optional()
});

export const addDepSchema = z.object({
  dependsOnId: z.number().int().positive()
});

export const assignSchema = z.object({
  userId: z.number().int().positive(),
  raci: z.enum(['lead', 'contributor', 'reviewer'])
});

// 状态机（规格书 S4.1）：todo→doing→reviewing→done；
// todo/doing→blocked→doing；任意→cancelled（队长权限）
export const changeStatusSchema = z.object({
  toStatus: z.enum(['todo', 'doing', 'blocked', 'reviewing', 'done', 'cancelled']),
  note: z.string().max(500).optional()
});

export const requestExtensionSchema = z.object({
  newDueAt: z.string().datetime(),
  reason: z.string().min(1, '请填写延期理由').max(500)
});

export type GeneratePlanInput = z.infer<typeof generatePlanSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ChangeStatusInput = z.infer<typeof changeStatusSchema>;

/** 状态机合法迁移表 */
export const TASK_TRANSITIONS: Record<string, string[]> = {
  todo: ['doing', 'blocked', 'cancelled'],
  doing: ['reviewing', 'blocked', 'cancelled'],
  blocked: ['doing', 'cancelled'],
  reviewing: ['done', 'doing', 'cancelled'],
  done: [],
  cancelled: []
};
