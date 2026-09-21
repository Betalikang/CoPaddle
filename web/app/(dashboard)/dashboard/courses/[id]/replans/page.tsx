'use client';

import useSWR from 'swr';
import { use, useState } from 'react';
import { GitMerge, Play, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type Option = {
  id: number;
  label: string;
  action: string;
  payload: Record<string, unknown>[];
  costSummary: string;
  estImpactDays: string;
};

type Event = {
  id: number;
  triggerType: string;
  triggerPayload: { trigger_label?: string; delay_days?: number } | null;
  status: string;
  createdAt: string;
  options: Option[];
};

const TRIGGER_LABEL: Record<string, string> = {
  critical_delay: '关键路径延误',
  member_idle: '成员失联',
  rework_overflow: '返工超限',
  deadline_changed: '截止变更',
  manual: '手动触发'
};

const ACTION_LABEL: Record<string, string> = {
  redistribute: '重新分配',
  scope_cut: '缩减范围',
  borrow_member: '组间补位'
};

/** 重规划中心（规格书 P-18）：事件列表 + 三方案对比 + 采纳/拒绝。 */
export default function ReplansPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: groupsData } = useSWR<{ groups: { id: number; name: string }[] }>(
    `/api/courses/${id}/groups`,
    fetcher
  );
  const { data: courseData } = useSWR<{ myRole: string }>(`/api/courses/${id}`, fetcher);
  const group = groupsData?.groups?.[0];
  const myRole = courseData?.myRole ?? 'member';
  const isTeacher = myRole === 'teacher';

  const { data, isLoading, mutate } = useSWR<{ events: Event[] }>(
    group ? `/api/groups/${group.id}/replans` : null,
    fetcher
  );

  const [triggering, setTriggering] = useState(false);
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);

  const events = data?.events ?? [];

  async function generate() {
    if (!group) return;
    setTriggering(true);
    try {
      await fetch(`/api/groups/${group.id}/replans/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggerType: 'manual' })
      });
      await mutate();
    } finally {
      setTriggering(false);
    }
  }

  async function adopt(eventId: number, optionId: number) {
    setBusy(true);
    try {
      const res = await fetch(`/api/replans/${eventId}/options/${optionId}/adopt`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) {
        alert(body.error ?? '采纳失败');
      }
      await mutate();
    } finally {
      setBusy(false);
    }
  }

  async function reject(eventId: number) {
    if (!rejectReason.trim()) return;
    setBusy(true);
    try {
      await fetch(`/api/replans/${eventId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason })
      });
      setRejecting(null);
      setRejectReason('');
      await mutate();
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) {
    return (
      <section className="flex-1">
        <Skeleton className="h-8 w-48" />
      </section>
    );
  }

  return (
    <section className="flex-1">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg lg:text-2xl font-medium">重规划中心</h1>
        {group && (
          <Button disabled={triggering} onClick={generate}>
            <Play className="mr-1 h-4 w-4" />
            {triggering ? '生成中…' : '触发重规划（生成决策包）'}
          </Button>
        )}
      </div>

      {!group && <p className="text-sm text-muted-foreground">本课程还没有分组。</p>}

      {events.length === 0 && group && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            还没有重规划事件。关键路径延误、成员失联、返工超限会触发决策包，也可以手动触发。
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {events.map((ev) => (
          <Card key={ev.id}>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">
                  {TRIGGER_LABEL[ev.triggerType] ?? ev.triggerType}
                  {ev.triggerPayload?.delay_days ? ` · 延期 ${ev.triggerPayload.delay_days} 天` : ''}
                </CardTitle>
                <Badge variant={ev.status === 'adopted' ? 'default' : ev.status === 'rejected' ? 'secondary' : 'outline'}>
                  {ev.status === 'adopted' ? '已采纳' : ev.status === 'rejected' ? '已拒绝' : '待决策'}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {new Date(ev.createdAt).toLocaleString('zh-CN')}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 lg:grid-cols-3">
                {ev.options.map((opt) => {
                  const teacherOnly = opt.action !== 'redistribute';
                  const canAdopt =
                    ev.status === 'pending' && !busy && (teacherOnly ? isTeacher : true);
                  return (
                    <div key={opt.id} className="rounded-lg border p-3 text-sm">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="font-medium">{opt.label}</span>
                        <Badge variant="outline">{ACTION_LABEL[opt.action] ?? opt.action}</Badge>
                      </div>
                      <p className="mb-2 text-xs text-muted-foreground">{opt.costSummary}</p>
                      {opt.payload.length > 0 && (
                        <ul className="mb-2 space-y-1 text-xs text-muted-foreground">
                          {opt.payload.slice(0, 4).map((item, i) => (
                            <li key={i}>
                              {String(item.task_code ?? item.task_id ?? '')} {String(item.title ?? item.chunk ?? item.to_member_name ?? '')}
                              {item.hours ? ` · ${item.hours}h` : ''}
                            </li>
                          ))}
                        </ul>
                      )}
                      {teacherOnly && (
                        <p className="mb-1 text-xs text-amber-600">需教师采纳</p>
                      )}
                      {ev.status === 'pending' && (
                        <div className="flex gap-1">
                          <Button size="sm" disabled={!canAdopt} onClick={() => adopt(ev.id, opt.id)}>
                            采纳
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {ev.status === 'pending' && (
                <div className="mt-2">
                  {rejecting === ev.id ? (
                    <div className="flex items-end gap-2">
                      <Textarea
                        rows={1}
                        className="max-w-md"
                        placeholder="拒绝理由（必填，进审计）"
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                      />
                      <Button size="sm" variant="outline" disabled={busy || !rejectReason.trim()} onClick={() => reject(ev.id)}>
                        确认拒绝
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRejecting(null)}>
                        取消
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setRejecting(ev.id)}>
                      <XCircle className="mr-1 h-3.5 w-3.5" />
                      拒绝全部方案
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        <GitMerge className="mr-1 inline h-3 w-3" />
        采纳「重新分配」自动改派主责；「缩减范围」将任务标记取消；「组间补位」需教师授权并通知双方队长。
      </p>
    </section>
  );
}
