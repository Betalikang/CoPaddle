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
  const body = await request.json().catch(() => null);
  // 只有显式传 'all' 才全标已读；坏 body / 缺字段一律 400，
  // 原来 `!Array.isArray(body.ids)` 会把「请求体写错」当成「全部已读」。
  if (body?.ids !== 'all' && !Array.isArray(body?.ids)) {
    return NextResponse.json({ error: '参数错误：ids 需为数组或 "all"' }, { status: 400 });
  }
  const ids = body.ids === 'all' ? 'all' : (body.ids as number[]);
  const result = await markRead(user.id, ids);
  return NextResponse.json(result);
}
