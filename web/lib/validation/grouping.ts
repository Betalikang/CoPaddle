import { z } from 'zod';

export const groupingMoveSchema = z.object({
  userId: z.number().int().positive(),
  fromGroup: z.number().int().min(0),
  toGroup: z.number().int().min(0)
});

export const groupingSwapSchema = z.object({
  userA: z.number().int().positive(),
  userB: z.number().int().positive()
});

export type GroupingMoveInput = z.infer<typeof groupingMoveSchema>;
export type GroupingSwapInput = z.infer<typeof groupingSwapSchema>;
