'use client';

import useSWR from 'swr';
import { CalendarClock, ListChecks, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { PageShell, Panel } from '@/components/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { Pager, usePagination } from '@/components/ui/pager';
import { EmptyState } from '@/components/empty-state';
import { QueryError } from '@/components/query-state';
import { swrFetcher } from '@/lib/api/client';

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
  const { data, error, isLoading, mutate } = useSWR<{ tasks: MyTask[] }>(
    '/api/me/tasks',
    swrFetcher
  );
  const tasks = data?.tasks ?? [];

  // 分页：一个学生一学期会累积几十条任务。hook 紧贴数据推导，位于任何条件回报之前。
  const taskPager = usePagination(tasks, 10);

  const crumbs = [{ label: '课程工作台', href: '/dashboard' }, { label: '我的部分' }];

  return (
    <PageShell
      title="我的部分"
      breadcrumbs={crumbs}
      description="我在各门课小组里的任务：负责什么、依赖谁、什么时候必须交。"
      width="wide"
    >
      <div className="space-y-4">
        {isLoading && <Skeleton className="h-40 w-full" />}

        {error && (
          <QueryError error={error} onRetry={() => void mutate()} title="我的任务加载失败" />
        )}

        {!isLoading && !error && tasks.length === 0 && (
          <Panel>
            <EmptyState
              icon={ListChecks}
              title="还没有分配给你的任务"
              hint="等队长完成任务拆解与分工后，这里会出现你的任务。"
            />
          </Panel>
        )}

        {tasks.length > 0 && (
          <Panel title={`我的任务（${tasks.length}）`} hint="卡片灰掉 = 还在等前置任务交付">
            <div className="divide-y">
              {taskPager.pageItems.map(({ task, assignment, waitingOn }) => (
                <article
                  key={assignment.id}
                  className={`flex flex-wrap items-start justify-between gap-x-6 gap-y-1 py-3 first:pt-0 last:pb-0 ${
                    waitingOn > 0 ? 'opacity-70' : ''
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-mono text-xs text-muted-foreground">{task.code}</span>
                      <span className="font-medium">{task.title}</span>
                      <Badge variant={task.status === 'done' ? 'default' : 'secondary'}>
                        {STATUS_LABEL[task.status] ?? task.status}
                      </Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" aria-hidden />
                        我的角色：{RACI_LABEL[assignment.raci] ?? assignment.raci}
                      </span>
                      <span className="flex items-center gap-1">
                        <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                        {task.dueAt
                          ? `截止 ${new Date(task.dueAt).toLocaleDateString('zh-CN')}`
                          : '未设截止时间'}
                      </span>
                      <span className="tabular-nums">预估 {task.estHours}h</span>
                      {waitingOn > 0 && (
                        <span className="text-warning">
                          等待 {waitingOn} 个前置任务交付后开始
                        </span>
                      )}
                      {waitingOn === 0 && task.status === 'todo' && (
                        <span className="text-success">依赖已就绪，可以开始</span>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
            <Pager {...taskPager.pagerProps} unit="条" />
          </Panel>
        )}
      </div>
    </PageShell>
  );
}
