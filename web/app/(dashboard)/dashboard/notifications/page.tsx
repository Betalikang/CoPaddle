'use client';

import useSWR from 'swr';
import { useEffect, useMemo, useState } from 'react';
import { Bell, CheckCheck, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Pager, usePagination } from '@/components/ui/pager';
import { Callout, PageShell, Panel } from '@/components/page-shell';
import { EmptyState } from '@/components/empty-state';
import { QueryError } from '@/components/query-state';
import { swrFetcher } from '@/lib/api/client';
import Link from 'next/link';

const PAGE_SIZE = 20;

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
  const { data, isLoading, error, mutate } = useSWR<{ items: Item[]; unread: number }>(
    '/api/notifications',
    swrFetcher
  );
  const [kw, setKw] = useState('');
  const [pending, setPending] = useState(false);
  const [markError, setMarkError] = useState('');
  const items = data?.items ?? [];

  const filtered = useMemo(() => {
    const k = kw.trim().toLowerCase();
    if (!k) return items;
    return items.filter((n) =>
      [TYPE_LABEL[n.type] ?? n.type, n.title, n.body ?? '']
        .join(' ')
        .toLowerCase()
        .includes(k)
    );
  }, [items, kw]);

  // 通知会持续累积，一页放不下；检索变化回到第一页
  const listPager = usePagination(filtered, PAGE_SIZE);
  const paged = listPager.pageItems;
  useEffect(() => {
    listPager.setPage(1);
  }, [kw, listPager.setPage]);
  const unread = data?.unread ?? 0;

  async function markAll() {
    if (pending) return;
    setPending(true);
    setMarkError('');
    try {
      const res = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: 'all' })
      });
      if (!res.ok) {
        // 原来不检查 res.ok：401/400 时按钮看起来成功了，未读却一条没少（审计 #55）
        setMarkError(`标记失败（HTTP ${res.status}），请刷新重试。`);
        return;
      }
      await mutate();
    } catch {
      setMarkError('标记失败，请检查网络后重试。');
    } finally {
      setPending(false);
    }
  }

  return (
    <PageShell
      breadcrumbs={[{ label: '课程工作台', href: '/dashboard' }, { label: '通知中心' }]}
      title="通知中心"
      description={
        unread > 0
          ? `${unread} 条未读。任务指派、契约发布、重规划决策都在这里提醒。`
          : '任务指派、契约发布、重规划决策会在这里提醒。'
      }
      actions={
        items.some((i) => !i.readAt) ? (
          <Button variant="outline" size="sm" onClick={() => void markAll()} disabled={pending}>
            <CheckCheck className="mr-1 h-4 w-4" />
            {pending ? '标记中…' : '全部已读'}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-2">
        {error && (
          <QueryError error={error} onRetry={() => void mutate()} title="通知加载失败" />
        )}
        {markError && <Callout tone="danger">{markError}</Callout>}

        <Panel
          title="通知"
          hint={filtered.length > 0 ? `共 ${filtered.length} 条` : undefined}
          actions={
            <div className="relative">
              <Search
                className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground"
                aria-hidden
              />
              <Input
                className="w-52 pl-8"
                placeholder="搜索通知（类型 / 标题）"
                aria-label="搜索通知（类型 / 标题）"
                value={kw}
                onChange={(e) => setKw(e.target.value)}
              />
            </div>
          }
          bodyClassName="p-0"
        >
          {isLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : paged.length === 0 ? (
            <EmptyState
              icon={Bell}
              title={items.length === 0 ? '还没有通知' : '没有匹配的通知'}
              hint={items.length === 0 ? '任务指派、契约发布、重规划决策会在这里提醒。' : undefined}
            />
          ) : (
            <ul className="divide-y">
              {paged.map((n) => (
                <li
                  key={n.id}
                  className={`flex flex-wrap items-center gap-3 px-4 py-3 ${
                    n.readAt ? 'opacity-60' : ''
                  }`}
                >
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
                  {!n.readAt && (
                    <span className="size-2 rounded-full bg-destructive" aria-label="未读" />
                  )}
                </li>
              ))}
            </ul>
          )}
          <Pager {...listPager.pagerProps} unit="条" className="px-4 pb-4" />
        </Panel>
      </div>
    </PageShell>
  );
}
