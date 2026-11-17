'use client';

import { TeacherGate } from '@/components/course-role-gate';
import useSWR from 'swr';
import { use, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageShell, Panel, Callout } from '@/components/page-shell';
import { EmptyState } from '@/components/empty-state';
import { QueryError } from '@/components/query-state';
import { Pager, usePagination } from '@/components/ui/pager';
import { swrFetcher } from '@/lib/api/client';

type GroupHealth = {
  groupId: number;
  name: string;
  groupStatus?: string;
  overall: number | null;
  blocked: number | null;
  idle: number | null;
  overload: number | null;
  diagnosis: string[] | null;
  snapshotAt: string | null;
  /** 快照距今年小时数；null = 从未算过 */
  snapshotAgeHours?: number | null;
  /** fresh / stale / missing —— 由服务端统一判定，页面不再自己猜阈值 */
  freshness?: 'fresh' | 'stale' | 'missing';
};

function scoreColor(v: number | null) {
  if (v === null) return 'text-muted-foreground';
  if (v >= 80) return 'text-success';
  if (v >= 60) return 'text-warning';
  return 'text-danger';
}

/** 预警中心（规格书 P-15）：全班小组健康度 + 待处理预警 + 一键处理入口。 */
function AlertsBody({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, isLoading, mutate } = useSWR<{
    groups: GroupHealth[];
    coverage?: { total: number; neverComputed: number; stale: number; alerting: number };
  }>(`/api/courses/${id}/health-overview`, swrFetcher);

  const crumbs = [
    { label: '课程工作台', href: '/dashboard' },
    { label: '课程', href: `/dashboard/courses/${id}` },
    { label: '健康度与预警' }
  ];

  const groups = data?.groups ?? [];
  const coverage = data?.coverage ?? null;
  // 预警判定与健康度服务保持同一套规则（综合分 < 80 或带诊断）；
  // 未算过快照的组没有分数，不算预警，但要单独提示「没有数据 ≠ 健康」。
  const alertGroups = groups
    .filter((g) => g.overall !== null && (g.overall < 80 || (g.diagnosis?.length ?? 0) > 0))
    .sort((a, b) => (a.overall ?? 100) - (b.overall ?? 100));
  const noSnapshot = groups.filter((g) => g.overall === null);
  const staleCount = groups.filter((g) => g.freshness === 'stale').length;
  // 需要提示「数据不可用/不新鲜」的组数：从未算过 + 快照过期
  const degradedCount = noSnapshot.length + staleCount;

  // 预警卡 10 组一页；健康度是 3 列网格，9 组一页正好排满 3 行不留残缺行。
  // 必须放在任何条件 return 之前，保持 hook 调用顺序稳定
  const alertPager = usePagination(alertGroups, 10);
  const groupPager = usePagination(groups, 9);

  // 批量重算的进度与结果：按钮 in-flight 期间禁用，结束后用状态色汇报成功/失败数
  const [computing, setComputing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{ ok: number; failed: number; firstError: string } | null>(
    null
  );

  async function computeAll() {
    if (computing) return;
    setComputing(true);
    setResult(null);
    setProgress({ done: 0, total: groups.length });
    let ok = 0;
    let failed = 0;
    let firstError = '';
    // 串行发：服务端要逐组算快照，并发没有收益。单个失败只计数、不中断整批，
    // 否则第 2 个组报错会让后面 N-2 个组静默不重算（审计 #53）。
    for (const g of groups) {
      try {
        const res = await fetch(`/api/groups/${g.groupId}/health`, { method: 'POST' });
        const body = (await res.json().catch(() => null)) as
          | { snapshot?: unknown; error?: string }
          | null;
        if (res.ok && body?.snapshot) {
          ok += 1;
        } else {
          failed += 1;
          if (!firstError) {
            firstError = `${g.name}：${body?.error ?? `请求失败（HTTP ${res.status}）`}`;
          }
        }
      } catch {
        failed += 1;
        if (!firstError) firstError = `${g.name}：网络异常`;
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }
    setComputing(false);
    setResult({ ok, failed, firstError });
    await mutate();
  }

  if (isLoading) {
    return (
      <PageShell title="健康度与预警" breadcrumbs={crumbs} width="wide">
        <Skeleton className="h-64 w-full" />
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell title="健康度与预警" breadcrumbs={crumbs} width="wide">
        <QueryError error={error} onRetry={() => void mutate()} title="健康度与预警加载失败" />
      </PageShell>
    );
  }

  return (
    <PageShell
      title="健康度与预警"
      breadcrumbs={crumbs}
      description="全班小组的健康度快照：综合分低于 80 或带系统诊断的小组会进入待处理预警。"
      width="wide"
      actions={
        groups.length > 0 ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void computeAll()}
            disabled={computing}
          >
            <RefreshCw className={`mr-1 h-4 w-4 ${computing ? 'animate-spin' : ''}`} />
            {computing
              ? `重算中… ${progress.done}/${progress.total}`
              : '重新计算全班健康度'}
          </Button>
        ) : null
      }
    >
      {groups.length === 0 ? (
        <Panel>
          <EmptyState icon={ShieldAlert} title="本课程还没有分组，无需监控。" />
        </Panel>
      ) : (
        <div className="space-y-4">
          {result && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-4 py-2.5 text-sm">
              <Badge variant={result.failed === 0 ? 'default' : 'destructive'}>
                {result.failed === 0 ? '全部成功' : '部分失败'}
              </Badge>
              <span
                className={
                  result.failed === 0
                    ? 'text-success'
                    : 'text-warning'
                }
              >
                已重算 {result.ok} 个组
                {result.failed > 0 ? `，${result.failed} 个失败` : '，无失败'}
              </span>
              {result.failed > 0 && result.firstError && (
                <span className="text-xs text-muted-foreground">
                  首个失败：{result.firstError}
                </span>
              )}
            </div>
          )}
          {degradedCount > 0 && (
            <Callout tone="warn" title={`有 ${degradedCount} 个小组的数据不可用或不新鲜`}>
              健康度是快照，不是实时值：
              {coverage
                ? `本课共 ${coverage.total} 组，其中 ${coverage.neverComputed} 组从未计算过、${coverage.stale} 组的快照已超过 24 小时。`
                : `其中 ${noSnapshot.length} 组从未计算过、${staleCount} 组的快照已超过 24 小时。`}
              这些组不会出现在下面的待处理预警里 —— 那不代表它们健康，只代表没有可信数据。
              点页头「重新计算全班健康度」可刷新。
            </Callout>
          )}

          {alertGroups.length > 0 && (
            <Panel
              title={`待处理预警（${alertGroups.length}）`}
              hint="按综合分从低到高排列"
              bodyClassName="p-0"
            >
              <ul className="divide-y">
                {alertPager.pageItems.map((g) => (
                  <li key={g.groupId} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <span className="text-sm font-medium">{g.name}</span>
                    <Badge variant="outline" className={scoreColor(g.overall)}>
                      综合 {g.overall?.toFixed(0) ?? '—'}
                    </Badge>
                    <span className="min-w-0 flex-1 text-sm text-muted-foreground">
                      {(g.diagnosis ?? []).join('；') || '健康度偏低'}
                    </span>
                    <Link href={`/dashboard/courses/${id}/replans`}>
                      <Button size="sm" variant="outline">
                        去处理
                      </Button>
                    </Link>
                  </li>
                ))}
              </ul>
              <Pager {...alertPager.pagerProps} unit="组" className="px-4 pb-4" />
            </Panel>
          )}

          <Panel
            title="全班小组健康度"
            hint={
              noSnapshot.length > 0
                ? `共 ${groups.length} 个小组，其中 ${noSnapshot.length} 个尚无快照`
                : `共 ${groups.length} 个小组`
            }
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {groupPager.pageItems.map((g) => (
                <div key={g.groupId} className="rounded-md border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{g.name}</span>
                    <span className={`tabular-nums text-sm font-semibold ${scoreColor(g.overall)}`}>
                      {g.overall === null ? '未计算' : g.overall.toFixed(0)}
                    </span>
                  </div>
                  {g.overall === null ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      点页头「重新计算全班健康度」生成首份快照。
                    </p>
                  ) : (
                    <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                      <Dim label="阻塞" value={g.blocked} />
                      <Dim label="失联" value={g.idle} />
                      <Dim label="过载" value={g.overload} />
                      {g.snapshotAt && (
                        <p className={g.freshness === 'stale' ? 'text-warning' : undefined}>
                          快照于 {new Date(g.snapshotAt).toLocaleString('zh-CN')}
                          {typeof g.snapshotAgeHours === 'number' && (
                            <>
                              {' '}
                              · {g.snapshotAgeHours < 1 ? '刚刚' : `${g.snapshotAgeHours} 小时前`}
                              {g.freshness === 'stale' && '（已过期）'}
                            </>
                          )}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <Pager {...groupPager.pagerProps} unit="组" />
          </Panel>
        </div>
      )}
    </PageShell>
  );
}

function Dim({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 shrink-0">{label}</span>
      <div className="h-1.5 flex-1 rounded bg-muted">
        <div className="h-1.5 rounded bg-primary/70" style={{ width: `${value ?? 0}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right tabular-nums">{value?.toFixed(0) ?? '—'}</span>
    </div>
  );
}

/** 页面级角色闸门：非教师/助教直链访问时给出明确说明。 */
export default function AlertsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <TeacherGate courseId={id} title="健康度与预警">
      <AlertsBody params={params} />
    </TeacherGate>
  );
}
