'use client';

import useSWR from 'swr';
import { use, useState } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type Target = {
  userId: number;
  name: string | null;
  studentNo: string | null;
  submitted: boolean;
};

/** 互评填写（规格书 M-10）：按被评人逐个填五维评分 + 文字评语。 */
export default function MyReviewsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: roundsData } = useSWR<{ rounds: { id: number; name: string; status: string }[] }>(
    `/api/courses/${id}/review-rounds`,
    fetcher
  );
  // 取最近一个 open 轮次
  const openRound = (roundsData?.rounds ?? []).find((r) => r.status === 'open');

  const { data, isLoading, mutate } = useSWR(
    openRound ? `/api/review-rounds/${openRound.id}/my-tasks` : null,
    fetcher
  );

  const targets = data?.targets ?? [];
  const [scores, setScores] = useState<Record<number, Record<string, number>>>({});
  const [comments, setComments] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState<number | null>(null);

  const dims = [
    { key: '贡献', label: '工作贡献' },
    { key: '沟通', label: '沟通协作' },
    { key: '负责', label: '责任担当' },
    { key: '质量', label: '工作质量' },
    { key: '技能', label: '知识技能' }
  ];

  async function submit(revieweeId: number) {
    if (!openRound) return;
    const s = scores[revieweeId];
    if (!s || Object.keys(s).length < dims.length) {
      alert('请先完成全部维度评分');
      return;
    }
    setSubmitting(revieweeId);
    try {
      await fetch(`/api/review-rounds/${openRound.id}/submissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          revieweeId,
          scores: s,
          comment: comments[revieweeId] || undefined
        })
      });
      await mutate();
    } finally {
      setSubmitting(null);
    }
  }

  if (isLoading) {
    return (
      <section className="flex-1">
        <Skeleton className="h-40" />
      </section>
    );
  }

  if (!openRound) {
    return (
      <section className="flex-1">
        <h1 className="mb-4 text-lg lg:text-2xl font-medium">同伴互评</h1>
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            当前没有开放中的互评轮次。教师开启后，这里会出现待评价的组内成员。
          </CardContent>
        </Card>
      </section>
    );
  }

  const done = targets.filter((t: any) => t.submitted).length;

  return (
    <section className="flex-1">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-lg lg:text-2xl font-medium">同伴互评 · {openRound.name}</h1>
        <Badge variant="outline">
          进度 {done} / {targets.length}
        </Badge>
      </div>

      <div className="space-y-3">
        {targets.map((t: any) => (
          <Card key={t.userId} className={t.submitted ? 'opacity-60' : ''}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">
                  {t.name ?? `#${t.userId}`}
                  {t.studentNo ? ` · ${t.studentNo}` : ''}
                </CardTitle>
                {t.submitted && <Badge variant="default">已提交</Badge>}
              </div>
            </CardHeader>
            {!t.submitted && (
              <CardContent className="space-y-3">
                <div className="grid grid-cols-5 gap-2">
                  {dims.map((d) => {
                    const v = scores[t.userId]?.[d.key] ?? 0;
                    return (
                      <div key={d.key} className="text-center">
                        <Label className="text-xs">{d.label}</Label>
                        <div className="mt-1 flex justify-center gap-0.5">
                          {[1, 2, 3, 4, 5].map((n) => (
                            <button
                              key={n}
                              className={`h-6 w-6 rounded text-xs ${
                                v === n ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-accent'
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
                <textarea
                  className="w-full rounded border p-2 text-sm"
                  rows={2}
                  placeholder="文字评语（可选）"
                  value={comments[t.userId] ?? ''}
                  onChange={(e) => setComments((prev) => ({ ...prev, [t.userId]: e.target.value }))}
                />
                <Button
                  size="sm"
                  disabled={submitting === t.userId}
                  onClick={() => submit(t.userId)}
                >
                  <Send className="mr-1 h-3.5 w-3.5" />
                  {submitting === t.userId ? '提交中…' : '提交评价'}
                </Button>
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        互评结果（去极值中位数）会作为同伴证据进入贡献账本；评分请如实、具体。
      </p>
    </section>
  );
}
