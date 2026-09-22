'use client';

import useSWR from 'swr';
import { Bell, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import Link from 'next/link';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type Item = {
  id: number;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  priority: string;
  readAt: string | null;
  createdAt: string;
};

const TYPE_LABEL: Record<string, string> = {
  task_assigned: '任务指派',
  contract_published: '契约发布',
  replan_pending: '重规划待决策',
  review_done: '教师终审',
  group_dissolved: '小组解散'
};

/** 通知中心（规格书 P-26）：全部通知列表，按类型分 Tab，点击跳转关联对象。 */
export default function NotificationsPage() {
  const { data, isLoading, mutate } = useSWR<{ items: Item[]; unread: number }>(
    '/api/notifications',
    fetcher
  );
  const items = data?.items ?? [];

  async function markAll() {
    await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: 'all' })
    });
    await mutate();
  }

  return (
    <section className="flex-1">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg lg:text-2xl font-medium">
          通知中心
          {data && data.unread > 0 && (
            <Badge variant="destructive" className="ml-2">{data.unread} 未读</Badge>
          )}
        </h1>
        {items.some((i) => !i.readAt) && (
          <Button variant="outline" size="sm" onClick={markAll}>
            <CheckCheck className="mr-1 h-4 w-4" />
            全部已读
          </Button>
        )}
      </div>

      {isLoading && <Skeleton className="h-40" />}

      {!isLoading && items.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Bell className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">还没有通知。任务指派、契约发布、重规划决策会在这里提醒。</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {items.map((n) => (
          <Card key={n.id} className={n.readAt ? 'opacity-60' : ''}>
            <CardContent className="flex flex-wrap items-center gap-3 py-3">
              <Badge variant="outline">{TYPE_LABEL[n.type] ?? n.type}</Badge>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{n.title}</p>
                {n.body && <p className="text-xs text-muted-foreground">{n.body}</p>}
              </div>
              <span className="text-xs text-muted-foreground">
                {new Date(n.createdAt).toLocaleString('zh-CN')}
              </span>
              {n.link && (
                <Link href={n.link}>
                  <Button size="sm" variant="ghost">查看</Button>
                </Link>
              )}
              {!n.readAt && <span className="h-2 w-2 rounded-full bg-red-500" />}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
