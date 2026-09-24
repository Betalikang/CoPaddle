'use client';

import useSWR from 'swr';
import { use, useMemo, useState } from 'react';
import { GitMerge, Play, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

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
  groupId: number;
  groupName?: string | null;
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

/** 重规划中心（规格书 P-18）：全班事件流 + 三方案对比 + 采纳/拒绝。 */
export default function ReplansPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: groupsData } = useSWR<{ groups: { id: number; name: string; status?: string }[] }>(
    `/api/courses/${id}/groups`,
    fetcher
  );
  const { data: courseData } = useSWR<{ myRole: string }>(`/api/courses/${id}`, fetcher);
  const myRole = courseData?.myRole ?? 'member';
  const isTeacher = myRole === 'teacher' || myRole === 'assistant';

  // 课程级事件流：不再只挂第 0 组（旧逻辑落在 smooth 组上永远为空）
  const { data, isLoading, mutate } = useSWR<{ events: Event[] }>(
    `/api/courses/${id}/replans`,
    fetcher
  );

  const activeGroups = useMemo(
    () => (groupsData?.groups ?? []).filter((g) => g.status !== 'dissolved'),
    [groupsData]
  );
  const [targetGroupId, setTargetGroupId] = useState<string>('');
  const generateGroupId = targetGroupId || String(activeGroups[0]?.id ?? '');

  const [triggering, setTriggering] = useState(false);
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);

  const events = useMemo(() => {
    const list = data?.events ?? [];
    // 待决策优先，其次按时间倒序
    return [...list].sort((a, b) => {
      const pa = a.status === 'pending' ? 0 : 1;
      const pb = b.status === 'pending' ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [data]);

  const pendingCount = events.filter((e) => e.status === 'pending').length;

  async function generate() {
    if (!generateGroupId) return;
    setTriggering(true);
    try {
      // 注意：生成接口是 POST /api/groups/:id/replans（无 /generate 后缀）
      const res = await fetch(`/api/groups/${generateGroupId}/replans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggerType: 'manual', delayDays: 2 })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body.error ?? '生成失败');
      } else if (body.triggered === false) {
        alert(body.reason ?? '未达到触发阈值');
      }
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
      const res = await fetch(`/api/replans/${eventId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body.error ?? '拒绝失败');
      }
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
        <div>
          <h1 className="text-lg lg:text-2xl font-medium">重规划中心</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            共 {events.length} 条事件
            {pendingCount > 0 ? ` · ${pendingCount} 条待决策` : ''}
          </p>
        </div>
        {activeGroups.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {isTeacher && activeGroups.length > 1 && (
              <Select value={generateGroupId} onValueChange={setTargetGroupId}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="选择小组" />
                </SelectTrigger>
                <SelectContent>
                  {activeGroups.map((g) => (
                    <SelectItem key={g.id} value={String(g.id)}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button disabled={triggering || !generateGroupId} onClick={generate}>
              <Play className="mr-1 h-4 w-4" />
              {triggering ? '生成中…' : '触发重规划（生成决策包）'}
            </Button>
          </div>
        )}
      </div>

      {activeGroups.length === 0 && (
        <p className="text-sm text-muted-foreground">本课程还没有分组。</p>
      )}

      {events.length === 0 && activeGroups.length > 0 && (
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
                {ev.groupName && <Badge variant="secondary">{ev.groupName}</Badge>}
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
                {(ev.options ?? []).map((opt) => {
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
                      {Array.isArray(opt.payload) && opt.payload.length > 0 && (
                        <ul className="mb-2 space-y-1 text-xs text-muted-foreground">
                          {opt.payload.slice(0, 4).map((item, i) => (
                            <li key={i}>
                              {String(item.task_code ?? item.task_id ?? '')}{' '}
                              {String(item.title ?? item.chunk ?? item.to_member_name ?? '')}
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
