'use client';

import useSWR from 'swr';
import { use } from 'react';
import Link from 'next/link';
import { AlertTriangle, Activity, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type GroupHealth = {
  groupId: number;
  name: string;
  overall: number | null;
  blocked: number | null;
  idle: number | null;
  overload: number | null;
  diagnosis: string[] | null;
  snapshotAt: string | null;
};

function scoreColor(v: number | null) {
  if (v === null) return 'text-muted-foreground';
  if (v >= 80) return 'text-green-600';
  if (v >= 60) return 'text-amber-600';
  return 'text-red-600';
}

/** 预警中心（规格书 P-15）：全班小组健康度 + 待处理预警 + 一键处理入口。 */
export default function AlertsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, isLoading, mutate } = useSWR<{ groups: GroupHealth[] }>(
    `/api/courses/${id}/health-overview`,
    fetcher
  );

  const groups = data?.groups ?? [];
  const alertGroups = groups
    .filter((g) => g.overall !== null && (g.overall < 80 || (g.diagnosis?.length ?? 0) > 0))
    .sort((a, b) => (a.overall ?? 100) - (b.overall ?? 100));
  const noSnapshot = groups.filter((g) => g.overall === null);

  async function computeAll() {
    for (const g of groups) {
      await fetch(`/api/groups/${g.groupId}/health`, { method: 'POST' });
    }
    await mutate();
  }

  return (
    <section className="flex-1">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg lg:text-2xl font-medium">健康度与预警</h1>
        <Button variant="outline" size="sm" onClick={computeAll}>
          <RefreshCw className="mr-1 h-4 w-4" />
          重新计算全班健康度
        </Button>
      </div>

      {isLoading && <Skeleton className="h-40" />}

      {!isLoading && groups.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            本课程还没有分组，无需监控。
          </CardContent>
        </Card>
      )}

      {/* 待处理预警 */}
      {alertGroups.length > 0 && (
        <div className="mb-6 space-y-2">
          <h2 className="flex items-center gap-2 text-base font-medium">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            待处理预警（{alertGroups.length}）
          </h2>
          {alertGroups.map((g) => (
            <Card key={g.groupId} className="border-amber-300">
              <CardContent className="flex flex-wrap items-center gap-3 py-3">
                <span className="font-medium">{g.name}</span>
                <Badge variant="outline" className={scoreColor(g.overall)}>
                  综合 {g.overall?.toFixed(0) ?? '—'}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {(g.diagnosis ?? []).join('；') || '健康度偏低'}
                </span>
                <Link href={`/dashboard/courses/${id}/replans`} className="ml-auto">
                  <Button size="sm" variant="outline">
                    去处理
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 全班健康度 */}
      <h2 className="mb-2 text-base font-medium">全班小组健康度</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => (
          <Card key={g.groupId}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                {g.name}
                <span className={`tabular-nums font-semibold ${scoreColor(g.overall)}`}>
                  {g.overall === null ? '未计算' : g.overall.toFixed(0)}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              {g.overall === null ? (
                <p>点击右上角「重新计算」生成首份快照。</p>
              ) : (
                <>
                  <Dim label="阻塞" value={g.blocked} />
                  <Dim label="失联" value={g.idle} />
                  <Dim label="过载" value={g.overload} />
                  {g.snapshotAt && (
                    <p>快照于 {new Date(g.snapshotAt).toLocaleString('zh-CN')}</p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {noSnapshot.length > 0 && groups.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          <Activity className="mr-1 inline h-3 w-3" />
          {noSnapshot.length} 个小组尚无健康度快照。
        </p>
      )}
    </section>
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

