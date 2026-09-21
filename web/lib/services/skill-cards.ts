import { and, eq } from 'drizzle-orm';
import { db } from '../db/drizzle';
import { SkillCard, skillCards } from '../db/schema';
import type { SkillCardInput } from '@/lib/validation/courses';

/** 提交/更新我的技能卡（每课程每人一张，upsert）。 */
export async function upsertSkillCard(
  courseId: number,
  userId: number,
  input: SkillCardInput
): Promise<SkillCard> {
  const values = {
    skills: input.skills,
    availability: input.availability ?? {},
    preferRoles: input.preferRoles ?? [],
    preferTeammates: input.preferTeammates ?? [],
    avoidTeammates: input.avoidTeammates ?? [],
    selfNote: input.selfNote ?? null,
    updatedAt: new Date()
  };

  const [card] = await db
    .insert(skillCards)
    .values({ courseId, userId, ...values })
    .onConflictDoUpdate({
      target: [skillCards.courseId, skillCards.userId],
      set: values
    })
    .returning();
  return card;
}

export async function getMySkillCard(
  courseId: number,
  userId: number
): Promise<SkillCard | null> {
  const [card] = await db
    .select()
    .from(skillCards)
    .where(and(eq(skillCards.courseId, courseId), eq(skillCards.userId, userId)))
    .limit(1);
  return card ?? null;
}
