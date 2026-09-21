'use client';

import useSWR from 'swr';
import { use, useState } from 'react';
import { FileText, Lock, MessageSquarePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type Entry = {
  userId: number;
  snapshotId: number;
  comp: Record<string, number>;
  low: number;
  high: number;
  confidence: string;
  fairShareRatio: number;
  warning: string | null;
  review: {
    id: number;
    adjustedLow: string | null;
    adjustedHigh: string | null;
    finalNote: string | null;
    isLocked: boolean;
  } | null;
};

const CONFIDENCE_LABEL: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低'
};

/**
 * 贡献账本（规格书 P-19 答辩杀手锏 2）+ 教师终审（P-20）合一：
 * 区间 + 置信度 + 构成 + 证据下钻抽屉；教师可直接调整区间并锁定。
 * 铁律：界面任何位置不出现单一分数。
 */
export default function ContributionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: groupsData, isLoading: groupsLoading } = useSWR<{
    groups: { id: number; name: string; members: { userId: number; name: string | null; studentNo: string | null }[] }[];
  }>(`/api/courses/${id}/groups`, fetcher);
  const group = groupsData?.groups?.[0];

  const { data: ledgerData, isLoading, mutate } = useSWR<{
    snapshotAt: string | null;
    memberCount: number;
    entries: Entry[];
  }>(group ? `/api/groups/${group.id}/contributions` : null, fetcher);

  const { data: courseData } = useSWR<{
    course: { name: string };
    myRole: string;
  }>(`/api/courses/${id}`, fetcher);

  const [evidenceSnapId, setEvidenceSnapId] = useState<number | null>(null);
  const [reviewing, setReviewing] = useState<Entry | null>(null);
  const [appealing, setAppealing] = useState<Entry | null>(null);

  const myRole = courseData?.myRole ?? 'member';
  const isTeacher = myRole === 'teacher';
  const entries = ledgerData?.entries ?? [];
  const memberMap = new Map((group?.members ?? []).map((m) => [m.userId, m]));

  // 队员只看自己的区间（规格书 S5：他人区间默认不可见）
  const { data: meData } = useSWR<{ user: { id: number } }>('/api/auth/me', fetcher);
  const myId = meData?.user?.id;
  const visibleEntries = isTeacher || myRole === 'assistant' || myRole === 'captain'
    ? entries
    : entries.filter((e) => e.userId === myId);

  async function lockAll() {
    if (!group) return;
    if (!window.confirm('锁定后不可再调整区间，确定锁定终审结果？')) return;
    await fetch(`/api/groups/${group.id}/contributions/lock`, { method: 'POST' });
    await mutate();
  }

  async function compute() {
    if (!group) return;
    await fetch(`/api/groups/${group.id}/contributions`, { method: 'POST' });
    await mutate();
  }

  if (groupsLoading || isLoading) {
    return (
      <section className="flex-1">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-4 h-96" />
      </section>
    );
  }

  if (!group || !ledgerData?.snapshotAt) {
    return (
      <section className="flex-1">
        <h1 className="mb-4 text-lg lg:text-2xl font-medium">贡献账本</h1>
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <FileText className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {group ? '还没有贡献快照。成员在平台内撰写交付物并汇编后，点击「计算贡献」。' : '本课程还没有分组。'}
            </p>
            {group && (
              <Button onClick={compute}>
                计算贡献
              </Button>
            )}
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="flex-1">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg lg:text-2xl font-medium">贡献账本 · {group.name}</h1>
          <p className="text-sm text-muted-foreground">
            快照时间 {new Date(ledgerData.snapshotAt).toLocaleString('zh-CN')} ·
            系统输出区间与证据，评分权归教师
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={compute}>重新计算</Button>
          {isTeacher && (
            <Button variant="outline" onClick={lockAll}>
              <Lock className="mr-1 h-4 w-4" />
              批量锁定终审
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {visibleEntries.map((e) => {
          const m = memberMap.get(e.userId);
          const compEntries = Object.entries(e.comp).sort((a, b) => b[1] - a[1]);
          return (
            <Card key={e.userId}>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">
                    {m?.name ?? `#${e.userId}`}
                    {m?.studentNo ? ` · ${m.studentNo}` : ''}
                  </CardTitle>
                  <Badge variant="outline">置信度 {CONFIDENCE_LABEL[e.confidence] ?? e.confidence}</Badge>
                  {e.review?.isLocked && <Badge>已锁定</Badge>}
                  {e.review && !e.review.isLocked && <Badge variant="secondary">教师已调</Badge>}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* 区间可视化（无单一分数） */}
                <div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">系统区间</span>
                    <span className="tabular-nums font-medium">
                      {e.low.toFixed(1)}% – {e.high.toFixed(1)}%
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded bg-muted">
                    <div
                      className="h-2 rounded bg-orange-400"
                      style={{ marginLeft: `${e.low}%`, width: `${Math.max(e.high - e.low, 0.5)}%` }}
                    />
                  </div>
                  {e.review && (e.review.adjustedLow || e.review.adjustedHigh) && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      教师终审区间：
                      {e.review.adjustedLow ?? e.low.toFixed(1)}% – {e.review.adjustedHigh ?? e.high.toFixed(1)}%
                      {e.review.finalNote ? `（${e.review.finalNote}）` : ''}
                    </p>
                  )}
                </div>

                {/* 构成 */}
                <div className="space-y-1">
                  {compEntries.map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2 text-xs">
                      <span className="w-20 shrink-0 text-muted-foreground">{k}</span>
                      <div className="h-1.5 flex-1 rounded bg-muted">
                        <div className="h-1.5 rounded bg-primary/70" style={{ width: `${Math.min(v, 100)}%` }} />
                      </div>
                      <span className="w-12 shrink-0 tabular-nums text-right">{v.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>

                {e.warning && (
                  <p className="rounded bg-amber-50 p-2 text-xs text-amber-700">{e.warning}</p>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEvidenceSnapId(e.snapshotId)}>
                    查看证据（{''}下钻）
                  </Button>
                  {isTeacher && !e.review?.isLocked && (
                    <Button size="sm" variant="outline" onClick={() => setReviewing(e)}>
                      终审调整
                    </Button>
                  )}
                  {(myRole === 'captain' || myRole === 'member') && e.userId === myId && (
                    <Button size="sm" variant="ghost" onClick={() => setAppealing(e)}>
                      <MessageSquarePlus className="mr-1 h-3.5 w-3.5" />
                      我要申诉
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* 证据下钻抽屉 */}
      {evidenceSnapId !== null && (
        <EvidenceDrawer snapshotId={evidenceSnapId} onClose={() => setEvidenceSnapId(null)} />
      )}

      {/* 教师终审 */}
      {reviewing && (
        <ReviewDialog
          entry={reviewing}
          onClose={() => setReviewing(null)}
          onDone={async () => {
            setReviewing(null);
            await mutate();
          }}
        />
      )}

      {/* 学生申诉 */}
      {appealing && (
        <AppealDialog
          entry={appealing}
          onClose={() => setAppealing(null)}
        />
      )}
    </section>
  );
}

function EvidenceDrawer({ snapshotId, onClose }: { snapshotId: number; onClose: () => void }) {
  const { data, isLoading } = useSWR(`/api/contributions/${snapshotId}/evidence`, fetcher);
  const items = data?.items ?? [];

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>证据下钻（{items.length} 条）</DialogTitle>
        </DialogHeader>
        {isLoading && <Skeleton className="h-40" />}
        {!isLoading && items.length === 0 && (
          <p className="text-sm text-muted-foreground">该成员暂无证据条目。</p>
        )}
        <ul className="space-y-2">
          {items.map((i: any) => (
            <li key={i.id} className="rounded border p-2 text-sm">
              <div className="flex items-center gap-2">
                <Badge variant="outline">
                  {i.source === 'artifact' ? '产出物' : i.source === 'peer' ? '同伴' : '过程'}
                </Badge>
                <span className="text-muted-foreground">{i.note}</span>
                <span className="ml-auto tabular-nums text-muted-foreground">{i.value} 字/次</span>
              </div>
              {i.segment && (
                <p className="mt-1 line-clamp-2 rounded bg-muted p-1 text-xs text-muted-foreground">
                  第 {i.segment.seq} 段原文：{i.segment.content.slice(0, 80)}
                  {i.segment.content.length > 80 ? '…' : ''}（作者 #{i.segment.authorId}）
                </p>
              )}
              {i.task && (
                <p className="mt-1 text-xs text-muted-foreground">
                  任务 {i.task.code} {i.task.title}（{i.task.status}）
                </p>
              )}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function ReviewDialog({
  entry,
  onClose,
  onDone
}: {
  entry: Entry;
  onClose: () => void;
  onDone: () => void;
}) {
  const [low, setLow] = useState(String(entry.low.toFixed(1)));
  const [high, setHigh] = useState(String(entry.high.toFixed(1)));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await fetch(`/api/contributions/${entry.snapshotId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adjustedLow: Number(low),
          adjustedHigh: Number(high),
          finalNote: note || undefined
        })
      });
      await onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>终审调整（#{entry.userId}）</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            系统建议区间 {entry.low.toFixed(1)}% – {entry.high.toFixed(1)}%。系统只给依据，最终值由你确定。
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>下限 %</Label>
              <Input type="number" min={0} max={100} step={0.1} value={low} onChange={(e) => setLow(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>上限 %</Label>
              <Input type="number" min={0} max={100} step={0.1} value={high} onChange={(e) => setHigh(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>评语</Label>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button disabled={saving} onClick={save}>{saving ? '保存中…' : '保存终审'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AppealDialog({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [evidenceText, setEvidenceText] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  async function submit() {
    setSaving(true);
    try {
      const res = await fetch(`/api/contributions/${entry.snapshotId}/appeal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, evidenceText: evidenceText || undefined })
      });
      if (res.ok) {
        setMsg('申诉已提交，教师处理后你会收到通知。');
      } else {
        setMsg((await res.json()).error ?? '提交失败');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>对贡献区间提出申诉</DialogTitle>
        </DialogHeader>
        {msg ? (
          <p className="text-sm text-muted-foreground">{msg}</p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>申诉理由</Label>
              <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>补充证据</Label>
              <Textarea rows={3} value={evidenceText} onChange={(e) => setEvidenceText(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>取消</Button>
              <Button disabled={saving || !reason.trim()} onClick={submit}>
                {saving ? '提交中…' : '提交申诉'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
