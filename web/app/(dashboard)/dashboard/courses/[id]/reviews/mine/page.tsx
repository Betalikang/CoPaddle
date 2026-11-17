'use client';

import useSWR from 'swr';
import { use, useId, useState } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageShell, Panel } from '@/components/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { QueryError } from '@/components/query-state';
import { swrFetcher } from '@/lib/api/client';

type Target = {
  userId: number;
  name: string | null;
  studentNo: string | null;
  submitted: boolean;
};

/** 互评填写（规格书 M-10）：按被评人逐个填五维评分 + 文字评语。 */
export default function MyReviewsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const {
    data: roundsData,
    error: roundsError,
    isLoading: roundsLoading,
    mutate: mutateRounds
  } = useSWR<{ rounds: { id: number; name: string; status: string }[] }>(
    `/api/courses/${id}/review-rounds`,
    swrFetcher
  );
  // 取最近一个 open 轮次
  const openRound = (roundsData?.rounds ?? []).find((r) => r.status === 'open');

  const {
    data,
    error,
    isLoading,
    mutate
  } = useSWR<{ targets: Target[] }>(
    openRound ? `/api/review-rounds/${openRound.id}/my-tasks` : null,
    swrFetcher
  );

  const targets = data?.targets ?? [];
  const [scores, setScores] = useState<Record<number, Record<string, number>>>({});
  const [comments, setComments] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState<number | null>(null);
  // 审计 #23：按被评人记录失败原因，失败时保留已填评分与评语，只提示不刷新
  const [errors, setErrors] = useState<Record<number, string>>({});
  // 五维评分按钮组的标题 id 前缀：useId 保证列表内多个被评人互不冲突
  const scoreIdBase = useId();

  const dims = [
    { key: '贡献', label: '工作贡献' },
    { key: '沟通', label: '沟通协作' },
    { key: '负责', label: '责任担当' },
    { key: '质量', label: '工作质量' },
    { key: '技能', label: '知识技能' }
  ];

  async function submit(revieweeId: number) {
    if (!openRound) return;
    // 单一在途守卫：连点提交只发一次，也避免多行同时提交
    if (submitting !== null) return;
    const s = scores[revieweeId];
    if (!s || Object.keys(s).length < dims.length) {
      setErrors((prev) => ({ ...prev, [revieweeId]: '请先完成全部维度评分' }));
      return;
    }
    setSubmitting(revieweeId);
    setErrors((prev) => ({ ...prev, [revieweeId]: '' }));
    try {
      const res = await fetch(`/api/review-rounds/${openRound.id}/submissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          revieweeId,
          scores: s,
          comment: comments[revieweeId] || undefined
        })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: '响应不是 JSON' }));
        // 失败不 mutate、不清空已填内容：学生能看到原因并直接重试
        setErrors((prev) => ({
          ...prev,
          [revieweeId]: body.error ?? `提交失败（HTTP ${res.status}）`
        }));
        return;
      }
      await mutate();
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [revieweeId]: err instanceof Error ? err.message : '网络错误，请重试'
      }));
    } finally {
      setSubmitting(null);
    }
  }

  const crumbs = [
    { label: '课程工作台', href: '/dashboard' },
    { label: '课程', href: `/dashboard/courses/${id}` },
    { label: '我的互评' }
  ];

  // 轮次列表读失败时说「取不到轮次」，不再把它当成「没有开放轮次」——
  // 403 被渲染成空状态正是旧 fetcher 的老毛病，学生会误以为教师没开互评。
  if (roundsError) {
    return (
      <PageShell title="我的互评" breadcrumbs={crumbs}>
        <QueryError
          error={roundsError}
          onRetry={() => void mutateRounds()}
          title="互评轮次加载失败"
        />
      </PageShell>
    );
  }

  if (roundsLoading) {
    return (
      <PageShell title="我的互评" breadcrumbs={crumbs}>
        <Skeleton className="h-40 w-full" />
      </PageShell>
    );
  }

  if (isLoading) {
    return (
      <PageShell title="我的互评" breadcrumbs={crumbs}>
        <Skeleton className="h-40 w-full" />
      </PageShell>
    );
  }

  // 待评价名单读失败：不显示空的待评价列表（会被理解成「没有要评的人」）
  if (error) {
    return (
      <PageShell title="我的互评" breadcrumbs={crumbs}>
        <QueryError error={error} onRetry={() => void mutate()} title="待评价名单加载失败" />
      </PageShell>
    );
  }

  if (!openRound) {
    return (
      <PageShell title="我的互评" breadcrumbs={crumbs}>
        <Panel>
          <p className="py-8 text-center text-sm text-muted-foreground">
            当前没有开放中的互评轮次。教师开启后，这里会出现待评价的组内成员。
          </p>
        </Panel>
      </PageShell>
    );
  }

  const done = targets.filter((t: any) => t.submitted).length;

  return (
    <PageShell
      title={`同伴互评 · ${openRound.name}`}
      breadcrumbs={crumbs}
      description={`已提交 ${done} / ${targets.length} 人。结果按去极值中位数进入贡献账本，请如实、具体地打分。`}
    >
      <Panel title="待评价成员" hint="每个维度 1–5 分，五项打完才能提交">
        <div className="divide-y">
          {targets.map((t: any) => (
            <article
              key={t.userId}
              className={`space-y-3 py-4 first:pt-0 last:pb-0 ${t.submitted ? 'opacity-60' : ''}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-medium">
                  {t.name ?? `#${t.userId}`}
                  {t.studentNo ? ` · ${t.studentNo}` : ''}
                </h3>
                {t.submitted && <Badge variant="default">已提交</Badge>}
              </div>

              {!t.submitted && (
                <>
                  <div className="grid gap-2 sm:grid-cols-5">
                    {dims.map((d, i) => {
                      const v = scores[t.userId]?.[d.key] ?? 0;
                      const labelId = `${scoreIdBase}-${t.userId}-${i}`;
                      return (
                        <div key={d.key} className="text-center sm:text-left">
                          {/* 审计 #58：评分是一组按钮而非可标注控件，故用 group + aria-labelledby 关联标题 */}
                          <span id={labelId} className="block text-xs text-muted-foreground">
                            {d.label}
                          </span>
                          <div
                            role="group"
                            aria-labelledby={labelId}
                            className="mt-1 flex justify-center gap-0.5 sm:justify-start"
                          >
                            {[1, 2, 3, 4, 5].map((n) => (
                              <button
                                type="button"
                                key={n}
                                aria-pressed={v === n}
                                aria-label={`${d.label} ${n} 分`}
                                className={`h-6 w-6 rounded text-xs ${
                                  v === n
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-muted hover:bg-accent'
                                }`}
                                onClick={() =>
                                  setScores((prev) => ({
                                    ...prev,
                                    [t.userId]: { ...(prev[t.userId] ?? {}), [d.key]: n }
                                  }))
                                }
                              >
                                {n}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <Textarea
                    rows={2}
                    placeholder="文字评语（可选）"
                    aria-label="文字评语（可选）"
                    value={comments[t.userId] ?? ''}
                    onChange={(e) => setComments((prev) => ({ ...prev, [t.userId]: e.target.value }))}
                  />
                  {errors[t.userId] && (
                    <p className="text-sm text-destructive">{errors[t.userId]}</p>
                  )}
                  <Button
                    size="sm"
                    disabled={submitting !== null}
                    onClick={() => submit(t.userId)}
                  >
                    <Send className="mr-1 h-3.5 w-3.5" />
                    {submitting === t.userId ? '提交中…' : '提交评价'}
                  </Button>
                </>
              )}
            </article>
          ))}
        </div>
      </Panel>
    </PageShell>
  );
}
