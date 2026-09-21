'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { CalendarClock, ListChecks, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type MyTask = {
  assignment: { id: number; raci: string };
  task: {
    id: number;
    code: string;
    title: string;
    status: string;
    estHours: string;
    dueAt: string | null;
    deliverableType: string;
  };
  waitingOn: number;
};

const STATUS_LABEL: Record<string, string> = {
  todo: '待启动',
  doing: '进行中',
  blocked: '阻塞',
  reviewing: '审阅中',
  done: '已完成',
  cancelled: '已取消'
};

const RACI_LABEL: Record<string, string> = {
  lead: '主责',
  contributor: '协作',
  reviewer: '审阅'
};

/** 「我的部分」（规格书 M-02）：每张卡回答三问——我负责什么/依赖谁/何时必须交。 */
export default function MyTasksPage() {
  const { data, error, isLoading } = useSWR<{ tasks: MyTask[] }>('/api/me/tasks', fetcher);
  const tasks = data?.tasks ?? [];

  return (
    <section className="flex-1 p-4 lg:p-8">
      <h1 className="mb-2 text-lg lg:text-2xl font-medium">我的部分</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        我在各门课小组里的任务：负责什么、依赖谁、什么时候必须交。
      </p>

      {isLoading && <Skeleton className="h-40" />}
      {error && <p className="text-sm text-destructive">加载失败，请刷新重试。</p>}

      {!isLoading && !error && tasks.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <ListChecks className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              还没有分配给你的任务。等队长完成任务拆解与分工后，这里会出现你的任务卡片。
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tasks.map(({ task, assignment, waitingOn }) => (
          <Card key={assignment.id} className={waitingOn > 0 ? 'opacity-70' : ''}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  <span className="mr-2 text-muted-foreground">{task.code}</span>
                  {task.title}
                </CardTitle>
                <Badge variant={task.status === 'done' ? 'default' : 'secondary'}>
                  {STATUS_LABEL[task.status] ?? task.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                我的角色：{RACI_LABEL[assignment.raci] ?? assignment.raci}
              </div>
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4" />
                {task.dueAt
                  ? `截止 ${new Date(task.dueAt).toLocaleDateString('zh-CN')}`
                  : '未设截止时间'}
                <span className="ml-auto tabular-nums">预估 {task.estHours}h</span>
              </div>
              {waitingOn > 0 && (
                <p className="text-amber-600">等待 {waitingOn} 个前置任务交付后开始</p>
              )}
              {waitingOn === 0 && task.status === 'todo' && (
                <p className="text-green-600">依赖已就绪，可以开始</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-6">
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:underline">
          ← 返回课程工作台
        </Link>
      </div>
    </section>
  );
}
