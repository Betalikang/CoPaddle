'use client';

import useSWR from 'swr';
import { use, useState } from 'react';
import { ClipboardCheck, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type Round = {
  id: number;
  name: string;
  status: string;
  isAnonymous: boolean;
  dimensions: { key: string; label: string }[] | null;
  createdAt: string;
};

const STATUS_LABEL: Record<string, string> = {
  scheduled: '未开始',
  open: '开放中',
  closed: '已关闭',
  published: '已发布'
};

const DEFAULT_DIMS = [
  { key: '贡献', label: '工作贡献' },
  { key: '沟通', label: '沟通协作' },
  { key: '负责', label: '责任担当' },
  { key: '质量', label: '工作质量' },
  { key: '技能', label: '知识技能' }
];

/** 互评管理（规格书 P-22）：轮次设置、完成率、结果排名、异常检测。 */
export default function ReviewsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, isLoading, mutate } = useSWR<{ rounds: Round[] }>(
    `/api/courses/${id}/review-rounds`,
    fetcher
  );
  const rounds = data?.rounds ?? [];

  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  async function create() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      await fetch(`/api/courses/${id}/review-rounds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), dimensions: DEFAULT_DIMS, isAnonymous: true })
      });
      setName('');
      await mutate();
    } finally {
      setCreating(false);
    }
  }

  async function act(roundId: number, action: 'open' | 'close' | 'publish') {
    await fetch(`/api/review-rounds/${roundId}/${action}`, { method: 'POST' });
    await mutate();
  }

  return (
    <section className="flex-1">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg lg:text-2xl font-medium">同伴互评</h1>
        <Dialog>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-1 h-4 w-4" />
              新建轮次
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>新建互评轮次</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>轮次名称</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：期中互评" />
              </div>
              <p className="text-xs text-muted-foreground">
                默认五维（贡献/沟通/负责/质量/技能），匿名制。开启后组内成员互评，关闭后自动跑异常检测；
                结果取去极值中位数（≥4 份时去最高最低各一份）。
              </p>
              <div className="flex justify-end">
                <Button size="sm" disabled={creating || !name.trim()} onClick={create}>
                  {creating ? '创建中…' : '创建'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading && <Skeleton className="h-32" />}

      {!isLoading && rounds.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <ClipboardCheck className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              还没有互评轮次。创建后组内成员即可开始互评——同伴证据是贡献归因的第三类证据。
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {rounds.map((r) => (
          <RoundCard key={r.id} round={r} onAct={act} />
        ))}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        异常检测（互刷高分/极端低分/单一来源/未响应）只提示不自动改分；教师可据此决定是否排除某些评价。
      </p>
    </section>
  );
}

function RoundCard({
  round,
  onAct
}: {
  round: Round;
  onAct: (roundId: number, action: 'open' | 'close' | 'publish') => void;
}) {
  const { data: progress } = useSWR(
    round.status === 'open' || round.status === 'closed' || round.status === 'published'
      ? `/api/review-rounds/${round.id}/progress`
      : null,
    fetcher
  );
  const { data: results } = useSWR(
    round.status === 'closed' || round.status === 'published'
      ? `/api/review-rounds/${round.id}/results`
      : null,
    fetcher
  );
  const { data: anomalyData } = useSWR(
    round.status === 'closed' || round.status === 'published'
      ? `/api/review-rounds/${round.id}/anomalies`
      : null,
    fetcher
  );
  const anomalies = anomalyData?.anomalies ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{round.name}</CardTitle>
          <Badge variant={round.status === 'open' ? 'default' : 'secondary'}>
            {STATUS_LABEL[round.status] ?? round.status}
          </Badge>
          <Badge variant="outline">{round.isAnonymous ? '匿名' : '实名'}</Badge>
          {progress && (
            <span className="text-xs text-muted-foreground">
              完成 {progress.submitted} / {progress.expected}
            </span>
          )}
          <div className="ml-auto flex gap-1">
            {round.status === 'scheduled' && (
              <Button size="sm" onClick={() => onAct(round.id, 'open')}>开启</Button>
            )}
            {round.status === 'open' && (
              <Button size="sm" variant="outline" onClick={() => onAct(round.id, 'close')}>
                关闭并检测
              </Button>
            )}
            {round.status === 'closed' && (
              <Button size="sm" onClick={() => onAct(round.id, 'publish')}>发布结果</Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {progress && progress.expected > 0 && (
          <div className="h-1.5 rounded bg-muted">
            <div
              className="h-1.5 rounded bg-primary/70"
              style={{ width: `${Math.min((progress.submitted / progress.expected) * 100, 100)}%` }}
            />
          </div>
        )}
        {results?.results?.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">中位数排名</p>
            <ul className="space-y-0.5 text-sm">
              {results.results.map((r: any, i: number) => (
                <li key={r.userId} className="flex justify-between">
                  <span>
                    {i + 1}. {r.name ?? `#${r.userId}`}
                    {r.studentNo ? ` · ${r.studentNo}` : ''}
                    <span className="text-muted-foreground">（{r.count} 份）</span>
                  </span>
                  <span className="tabular-nums">{r.median.toFixed(1)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {anomalies.length > 0 && (
          <div className="rounded bg-amber-50 p-2 text-xs text-amber-700">
            <p className="font-medium">检测到 {anomalies.length} 条异常（只提示，不改分）：</p>
            <ul className="mt-1 list-inside list-disc">
              {anomalies.slice(0, 5).map((a: any) => (
                <li key={a.id}>
                  [{a.type === 'mutual_inflation' ? '互刷高分' : a.type === 'extreme_low' ? '极端低分' : a.type === 'single_source' ? '单一来源' : '未响应'}] {a.note}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
