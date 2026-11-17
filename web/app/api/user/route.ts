import { NextResponse } from 'next/server';
import { getUser, toPublicUser } from '@/lib/db/queries';

export async function GET() {
  const user = await getUser();
  // 未登录返回 401，但 body 仍是 null：客户端 fetcher 是 res.json(),
  // 保持 body 形状不变可避免解构报错（调用方都以 `!user` 判断）。
  if (!user) {
    return NextResponse.json(null, { status: 401 });
  }
  return NextResponse.json(toPublicUser(user));
}
