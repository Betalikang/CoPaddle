import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/db/queries';
import { getMyNotificationSettings, updateMyNotificationSettings } from '@/lib/services/notifications';

const patchSchema = z.object({
  emailEnabled: z.boolean().optional(),
  wechatEnabled: z.boolean().optional(),
  muteTypes: z.array(z.string().max(50)).optional(),
  digestMode: z.enum(['instant', 'daily']).optional()
});

export async function GET() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }
  const settings = await getMyNotificationSettings(user.id);
  return NextResponse.json({ settings });
}

export async function PATCH(request: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误', issues: parsed.error.flatten() }, { status: 400 });
  }
  const settings = await updateMyNotificationSettings(user.id, parsed.data);
  return NextResponse.json({ settings });
}
