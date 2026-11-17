'use client';

import { TeacherGate } from '@/components/course-role-gate';
import useSWR from 'swr';
import { use, useState } from 'react';
import { MessageSquare, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Callout, PageShell, Panel } from '@/components/page-shell';
import { EmptyState } from '@/components/empty-state';
import { Pager, usePagination } from '@/components/ui/pager';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { QueryError } from '@/components/query-state';
import { swrFetcher } from '@/lib/api/client';

type Round = {
  id: number;
  name: string;
  status: string;
  isAnonymous: boolean;
  dimensions: { key: string; label: string }[] | null;
  createdAt: string;
};

/** 轮次动作：开启 / 关闭并检测 / 发布结果。 */
type RoundAction = 'open' | 'close' | 'publish';

/** 单一在途动作（轮次 + 动作名），用于禁用按钮，避免双击重复发请求。 */
type PendingAction = { roundId: number; action: RoundAction } | null;

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
function ReviewsBody({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, isLoading, mutate } = useSWR<{ rounds: Round[] }>(
    `/api/courses/${id}/review-rounds`,
    swrFetcher
  );
  const rounds = data?.rounds ?? [];

  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  // 审计 #22：动作单一在途 + 失败提示，双击「关闭并检测」不再重复发请求
  const [pending, setPending] = useState<PendingAction>(null);
  const [actionError, setActionError] = useState('');

  async function create() {
    // 连点会建出两个同名轮次：未返回前忽略后续点击
    if (!name.trim() || creating) return;
    setCreating(true);
    setActionError('');
    try {
      const res = await fetch(`/api/courses/${id}/review-rounds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), dimensions: DEFAULT_DIMS, isAnonymous: true })
      });
      // 建轮次失败（重名 / 已有进行中的轮次 / 权限）此前被静默吞掉，输入框照样清空，
      // 看起来像建成功了。这里保留用户输入并把服务端原因显示出来。
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: null }));
        setActionError(body?.error ?? `新建轮次失败（HTTP ${res.status}）`);
        return;
      }
      setName('');
      await mutate();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '网络错误，请重试');
    } finally {
      setCreating(false);
    }
  }

  async function act(roundId: number, action: RoundAction) {
    // 单一在途：任一动作未返回前忽略新的点击，避免并发互斥请求
    if (pending) return;
    setPending({ roundId, action });
    setActionError('');
    try {
      const res = await fetch(`/api/review-rounds/${roundId}/${action}`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: '响应不是 JSON' }));
        // 403/409 之类此前被静默吞掉，这里把服务端原因显示出来
        setActionError(body.error ?? `操作失败（HTTP ${res.status}）`);
        return;
      }
      await mutate();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '网络错误，请重试');
    } finally {
      setPending(null);
    }
  }

  const crumbs = [
    { label: '课程工作台', href: '/dashboard' },
    { label: '课程', href: `/dashboard/courses/${id}` },
    { label: '互评轮次' }
  ];

  if (isLoading) {
    return (
      <PageShell title="同伴互评" breadcrumbs={crumbs}>
        <Skeleton className="h-40 w-full" />
      </PageShell>
    );
  }

  // 读失败不能落到下面的「还没有互评轮次」空态：403 被当成空列表会让人以为
  // 数据没建，实际是没有权限，再建一次也是白建。
  if (error) {
    return (
      <PageShell title="同伴互评" breadcrumbs={crumbs}>
        <QueryError error={error} onRetry={() => void mutate()} title="互评轮次加载失败" />
      </PageShell>
    );
  }

  const openCount = rounds.filter((r) => r.status === 'open').length;

  return (
    <PageShell
      title="同伴互评"
      breadcrumbs={crumbs}
      description={
        rounds.length === 0
          ? '一次创建、开启、关闭、发布，四步走完一轮互评。'
          : `${rounds.length} 个轮次${openCount > 0 ? ` · ${openCount} 个开放中` : ''}。关闭后自动跑异常检测，结果取去极值中位数。`
      }
      actions={
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
                <Label htmlFor="new-round-name">轮次名称</Label>
                <Input
                  id="new-round-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="如：期中互评"
                />
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
      }
    >
      <div className="space-y-4">
        {/* 首轮创建失败时列表还是空的，如果错误只写在「轮次」面板里就永远不会显示，
            用户会以为点了没反应。这里把错误提到列表之前，两种视图都能看到。 */}
        {actionError && (
          <Callout tone="danger" title="操作未生效">{actionError}</Callout>
        )}

        {rounds.length === 0 && (
          <Panel>
            <EmptyState
              icon={MessageSquare}
              title="还没有互评轮次"
              hint="创建后组内成员即可开始互评——同伴证据是贡献归因的第三类证据。"
            />
          </Panel>
        )}

        {rounds.length > 0 && (
          <Panel title="轮次" hint="开启 → 关闭并检测 → 发布结果；排名与异常只在关闭后出现">
            <div className="divide-y">
              {rounds.map((r) => (
                <RoundRow key={r.id} round={r} onAct={act} pending={pending} />
              ))}
            </div>
          </Panel>
        )}

        <p className="text-xs text-muted-foreground">
          异常检测（互刷高分/极端低分/单一来源/未响应）只提示不自动改分；教师可据此决定是否排除某些评价。
        </p>
      </div>
    </PageShell>
  );
}

function RoundRow({
  round,
  onAct,
  pending
}: {
  round: Round;
  onAct: (roundId: number, action: RoundAction) => void;
  pending: PendingAction;
}) {
  const { data: progress, error: progressError } = useSWR<{
    submitted: number;
    expected: number;
  }>(
    round.status === 'open' || round.status === 'closed' || round.status === 'published'
      ? `/api/review-rounds/${round.id}/progress`
      : null,
    swrFetcher
  );
  const { data: results, error: resultsError } = useSWR<{
    results: { userId: number; name: string | null; studentNo: string | null; count: number; median: number }[];
  }>(
    round.status === 'closed' || round.status === 'published'
      ? `/api/review-rounds/${round.id}/results`
      : null,
    swrFetcher
  );
  const { data: anomalyData, error: anomaliesError } = useSWR<{
    anomalies: { id: number; type: string; note: string }[];
  }>(
    round.status === 'closed' || round.status === 'published'
      ? `/api/review-rounds/${round.id}/anomalies`
      : null,
    swrFetcher
  );
  const anomalies = anomalyData?.anomalies ?? [];

  // 中位数排名可能上百行，必须分页；hooks 放在组件顶部、任何 return 之前
  const ranking = usePagination(results?.results ?? [], 20);

  // 任一动作在途时本轮所有按钮禁用；正在执行的那个换成进行中文案
  const anyPending = pending !== null;
  const pendingHere = (a: RoundAction) =>
    pending !== null && pending.roundId === round.id && pending.action === a;

  return (
    <article className="space-y-2 py-4 text-sm first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">{round.name}</h3>
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
            <Button size="sm" disabled={anyPending} onClick={() => onAct(round.id, 'open')}>
              {pendingHere('open') ? '开启中…' : '开启'}
            </Button>
          )}
          {round.status === 'open' && (
            <Button
              size="sm"
              variant="outline"
              disabled={anyPending}
              onClick={() => onAct(round.id, 'close')}
            >
              {pendingHere('close') ? '检测中…' : '关闭并检测'}
            </Button>
          )}
          {round.status === 'closed' && (
            <Button size="sm" disabled={anyPending} onClick={() => onAct(round.id, 'publish')}>
              {pendingHere('publish') ? '发布中…' : '发布结果'}
            </Button>
          )}
        </div>
      </div>

      {progress && progress.expected > 0 && (
        <div className="h-1.5 rounded bg-muted">
          <div
            className="h-1.5 rounded bg-primary/70"
            style={{ width: `${Math.min((progress.submitted / progress.expected) * 100, 100)}%` }}
          />
        </div>
      )}

      {progressError && (
        <QueryError error={progressError} title="完成率加载失败" compact />
      )}

      {(results?.results?.length ?? 0) > 0 && (
        <div>
          <p className="mb-1 text-xs text-muted-foreground">中位数排名</p>
          <ul className="space-y-0.5">
            {ranking.pageItems.map((r: any, i: number) => (
              <li key={r.userId} className="flex justify-between gap-3">
                <span>
                  {ranking.start + i + 1}. {r.name ?? `#${r.userId}`}
                  {r.studentNo ? ` · ${r.studentNo}` : ''}
                  <span className="ml-1 text-muted-foreground">（{r.count} 份）</span>
                </span>
                <span className="tabular-nums">{r.median.toFixed(1)}</span>
              </li>
            ))}
          </ul>
          <Pager {...ranking.pagerProps} unit="名" />
        </div>
      )}

      {resultsError && (
        <QueryError error={resultsError} title="排名结果加载失败" compact />
      )}

      {anomaliesError && (
        <QueryError error={anomaliesError} title="异常检测结果加载失败" compact />
      )}

      {anomalies.length > 0 && (
        <Callout tone="warn" title={`检测到 ${anomalies.length} 条异常（只提示，不改分）`}>
          <ul className="list-inside list-disc text-xs">
            {anomalies.slice(0, 5).map((a: any) => (
              <li key={a.id}>
                [{a.type === 'mutual_inflation' ? '互刷高分' : a.type === 'extreme_low' ? '极端低分' : a.type === 'single_source' ? '单一来源' : '未响应'}] {a.note}
              </li>
            ))}
          </ul>
        </Callout>
      )}
    </article>
  );
}

/** 页面级角色闸门：非教师/助教直链访问时给出明确说明。 */
export default function ReviewsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <TeacherGate courseId={id} title="同伴互评">
      <ReviewsBody params={params} />
    </TeacherGate>
  );
}
