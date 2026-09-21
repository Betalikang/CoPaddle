import { NextResponse } from 'next/server';
import { getUser } from '@/lib/db/queries';
import { getMyTasks } from '@/lib/services/tasks';

/** 「我的部分」（规格书 M-02）：我的任务、依赖谁、截止时间；依赖未就绪标记等待。 */
export async function GET() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }
  const items = await getMyTasks(user.id);
  return NextResponse.json({ tasks: items });
}
