import { NextResponse } from 'next/server';
import { getUser } from '@/lib/db/queries';
import { listMyNotifications, markRead } from '@/lib/services/notifications';

/** 我的通知列表（分页、按类型筛选）。 */
export async function GET(request: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }
  const type = new URL(request.url).searchParams.get('type') ?? undefined;
  const data = await listMyNotifications(user.id, { type });
  return NextResponse.json(data);
}

/** 标记已读（ids 或 all）。 */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const ids = body.ids === 'all' || !Array.isArray(body.ids) ? 'all' : (body.ids as number[]);
  const result = await markRead(user.id, ids);
  return NextResponse.json(result);
}
