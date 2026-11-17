import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertCourseRole } from '@/lib/auth/course-access';
import { createRound, listRounds } from '@/lib/services/peer-reviews';
import { parseId } from '@/lib/api/params';

type Params = { params: Promise<{ id: string }> };

const createSchema = z.object({
  name: z.string().min(1, '轮次名称不能为空').max(100),
  openAt: z.string().datetime().nullable().optional(),
  closeAt: z.string().datetime().nullable().optional(),
  dimensions: z.array(z.object({ key: z.string().max(10), label: z.string().max(20) })).optional(),
  isAnonymous: z.boolean().optional()
});

/**
 * 轮次列表。
 *
 * 教师/助教看全部；学生只能看已开启及之后的轮次——「我的互评」需要先知道
 * 哪一轮在开放中，才能去拉自己的待评价任务。草稿轮次对学生不可见。
 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const courseId = parseId(id);
  if (courseId === null) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain', 'member']);
  if (!auth.ok) return auth.response;

  const rounds = await listRounds(courseId);
  const isStaff = auth.membership.role === 'teacher' || auth.membership.role === 'assistant';
  // 学生只看已开启及之后的轮次。原来写的是 `!== 'draft'`，但 createRound 写的是
  // 'scheduled'、schema 默认也是 'scheduled' → 该过滤形同虚设，未开启的轮次也会露出来。
  const VISIBLE = new Set(['open', 'closed', 'published']);
  return NextResponse.json({
    rounds: isStaff ? rounds : rounds.filter((round) => VISIBLE.has(round.status))
  });
}

/** 新建轮次（时间窗、维度、是否匿名；教师/助教）。 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const courseId = parseId(id);
  if (courseId === null) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant'], { write: true });
  if (!auth.ok) return auth.response;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误', issues: parsed.error.flatten() }, { status: 400 });
  }

  const round = await createRound(courseId, auth.user.id, parsed.data);
  return NextResponse.json({ round }, { status: 201 });
}
