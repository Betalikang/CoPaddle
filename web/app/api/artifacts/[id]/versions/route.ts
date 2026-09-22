import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertCourseRole } from '@/lib/auth/course-access';
import { getArtifactCourseId, saveVersion } from '@/lib/services/artifacts';

type Params = { params: Promise<{ id: string }> };

// 段落提交：保存时提交段落数组，服务端 diff 后写 segments/edits
const MAX_CONTENT_CHARS = 1_000_000; // 单交付物文本上限（约 1MB，远低于 20MB 文件限制）

const versionSchema = z.object({
  segments: z
    .array(
      z.object({
        seq: z.number().int().min(0),
        kind: z.string().max(20).optional(),
        content: z.string(),
        sourceTaskId: z.number().int().positive().nullable().optional()
      })
    )
    .min(1, '至少一个段落')
    .refine(
      (segs) => segs.reduce((n, s) => n + s.content.length, 0) <= MAX_CONTENT_CHARS,
      `交付物内容超过上限（${MAX_CONTENT_CHARS} 字符）`
    )
});

/** 保存新版本（段落 diff → 归属沉淀）。 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const artifactId = Number.parseInt(id, 10);
  if (!Number.isFinite(artifactId)) {
    return NextResponse.json({ error: '交付物 id 无效' }, { status: 400 });
  }

  const courseId = await getArtifactCourseId(artifactId);
  if (courseId === null) {
    return NextResponse.json({ error: '交付物不存在' }, { status: 404 });
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain', 'member']);
  if (!auth.ok) return auth.response;

  const parsed = versionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误', issues: parsed.error.flatten() }, { status: 400 });
  }

  const result = await saveVersion(artifactId, auth.user.id, parsed.data.segments);
  return NextResponse.json(result, { status: 201 });
}
