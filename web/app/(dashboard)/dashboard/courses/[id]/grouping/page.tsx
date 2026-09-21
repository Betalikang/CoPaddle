'use client';

import useSWR from 'swr';
import { use, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core';
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer
} from 'recharts';
import { Gauge, RotateCcw, Shuffle, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type Plan = {
  id: number;
  label: string;
  strategy: string;
  totalScore: string;
  scoreSkillCover: string;
  scoreWeakTie: string;
  scoreBalance: string;
  scoreHistoryAvoid: string;
  groups: number[][];
};

type Member = { userId: number; name: string | null; studentNo: string | null };

const DIMS = [
  { key: 'skill_cover', label: '技能覆盖', field: 'scoreSkillCover' },
  { key: 'weak_tie', label: '弱连接', field: 'scoreWeakTie' },
  { key: 'balance', label: '组间均衡', field: 'scoreBalance' },
  { key: 'history_avoid', label: '历史规避', field: 'scoreHistoryAvoid' }
] as const;

/**
 * 分组工作台（规格书 P-09，答辩杀手锏 1）：
 * 三方案 Tab + 小组卡片网格（dnd-kit 拖拽）+ 右侧实时得分面板。
 * 交互约定（技术选型 T2）：松手 → preview-move（服务端权威，≤50ms）→
 * 合法则 apply-move 落库快照并更新面板；违规则本地回滚、卡片标红、显示原因。
 */
export default function GroupingWorkbenchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const courseId = Number(id);

  const { data, error, isLoading, mutate } = useSWR<{
    run: { id: number; status: string; degraded: boolean | null } | null;
    plans: Plan[];
  }>(`/api/courses/${courseId}/grouping/latest`, fetcher);

  const { data: roster } = useSWR<{ enrollments: Member[] }>(
    `/api/courses/${courseId}/enrollments`,
    fetcher
  );

  const memberMap = useMemo(() => {
    const m = new Map<number, Member>();
    for (const e of roster?.enrollments ?? []) {
      m.set(e.userId, { userId: e.userId, name: e.name, studentNo: e.studentNo });
    }
    return m;
  }, [roster]);

  const plans = data?.plans ?? [];
  const [activePlanId, setActivePlanId] = useState<number | null>(null);
  const currentPlanId = activePlanId ?? plans[0]?.id ?? null;
  const currentPlan = plans.find((p) => p.id === currentPlanId) ?? null;

  // 本地快照：记录属于哪个方案，切 Tab 时自动回落到该方案的库内快照
  const [local, setLocal] = useState<{ planId: number; value: number[][] } | null>(null);
  const shownGroups =
    local && local.planId === currentPlanId ? local.value : (currentPlan?.groups ?? []);

  const [dragId, setDragId] = useState<number | null>(null);
  const [preview, setPreview] = useState<{
    deltas: Record<string, number>;
    totalBefore: number;
    totalAfter: number;
  } | null>(null);
  const [violations, setViolations] = useState<{ code: string; message: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function selectPlan(planId: number) {
    setActivePlanId(planId);
    setLocal(null);
    setPreview(null);
    setViolations([]);
    setSelected(null);
  }

  async function post(path: string, body: unknown = {}) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return res.json();
  }

  /** 一次移动的完整流程：preview（服务端权威）→ 合法则 apply → 更新面板。 */
  async function moveFlow(userId: number, fromGroup: number, toGroup: number) {
    if (!currentPlan || fromGroup === toGroup) return;
    setBusy(true);
    try {
      const previewRes = await post(`/api/grouping/plans/${currentPlan.id}/preview-move`, {
        userId,
        fromGroup,
        toGroup
      });
      if (!previewRes.ok) {
        setViolations(previewRes.violations ?? []);
        setPreview(null);
        return;
      }
      setViolations([]);
      setPreview({
        deltas: previewRes.deltas,
        totalBefore: previewRes.totalBefore,
        totalAfter: previewRes.totalAfter
      });
      const applyRes = await post(`/api/grouping/plans/${currentPlan.id}/apply-move`, {
        userId,
        fromGroup,
        toGroup
      });
      if (applyRes.ok) {
        setLocal({ planId: currentPlan.id, value: applyRes.groups });
      }
    } finally {
      setBusy(false);
    }
  }

  function onDragEnd(event: DragEndEvent) {
    setDragId(null);
    const { active, over } = event;
    if (!over) return;
    const userId = Number(active.id);
    const toGroup = Number(over.id);
    const fromGroup = shownGroups.findIndex((g) => g.includes(userId));
    if (fromGroup === -1) return;
    void moveFlow(userId, fromGroup, toGroup);
  }

  async function moveSelectedTo(toGroup: number) {
    if (selected === null) return;
    const fromGroup = shownGroups.findIndex((g) => g.includes(selected));
    if (fromGroup === -1) return;
    await moveFlow(selected, fromGroup, toGroup);
    setSelected(null);
  }

  async function resetPlan() {
    if (!currentPlan) return;
    setBusy(true);
    try {
      await post(`/api/grouping/plans/${currentPlan.id}/reset`);
      setLocal(null);
      setPreview(null);
      setViolations([]);
      await mutate();
    } finally {
      setBusy(false);
    }
  }

  async function rerun() {
    setBusy(true);
    try {
      await post(`/api/courses/${courseId}/grouping/run`);
      setActivePlanId(null);
      setLocal(null);
      setPreview(null);
      setViolations([]);
      await mutate();
    } finally {
      setBusy(false);
    }
  }

  async function selectCurrent() {
    if (!currentPlan) return;
    setBusy(true);
    try {
      const res = await post(`/api/grouping/plans/${currentPlan.id}/select`);
      if (res.ok) {
        router.push(`/dashboard/courses/${courseId}?grouped=1`);
      } else {
        setViolations([{ code: 'SELECT', message: res.error ?? '选定失败' }]);
      }
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) {
    return (
      <section className="flex-1">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-4 h-96" />
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className="flex-1">
        <p className="text-sm text-destructive">加载失败，请刷新重试。</p>
      </section>
    );
  }

  if (!data.run || plans.length === 0) {
    return (
      <section className="flex-1">
        <h1 className="mb-4 text-lg lg:text-2xl font-medium">分组工作台</h1>
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Users className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              还没有生成过分组方案。确保名单已导入且学生已填技能卡，然后点击「生成分组方案」。
            </p>
            <Button disabled={busy} onClick={rerun}>
              <Shuffle className="mr-1 h-4 w-4" />
              {busy ? '求解中…' : '生成分组方案'}
            </Button>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="flex-1">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg lg:text-2xl font-medium">分组工作台</h1>
        <div className="flex gap-2">
          <Button variant="outline" disabled={busy} onClick={rerun}>
            <Shuffle className="mr-1 h-4 w-4" />
            重新求解
          </Button>
          <Button disabled={busy} onClick={selectCurrent}>
            选定此方案
          </Button>
        </div>
      </div>

      {data.run.degraded && (
        <p className="mb-3 text-sm text-amber-600">
          本次为快速模式（求解器超时回退贪心），结果未达最优，可重试。
        </p>
      )}

      <Tabs value={String(currentPlanId ?? '')} onValueChange={(v) => selectPlan(Number(v))}>
        <TabsList>
          {plans.map((p) => (
            <TabsTrigger key={p.id} value={String(p.id)}>
              {p.label}
              <span className="ml-2 tabular-nums text-muted-foreground">
                {Number(p.totalScore).toFixed(1)}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>

        {plans.map((plan) => (
          <TabsContent key={plan.id} value={String(plan.id)}>
            <div className="grid gap-4 lg:grid-cols-3">
              {/* 左：小组卡片网格 */}
              <div className="lg:col-span-2">
                <DndContext
                  sensors={sensors}
                  onDragStart={(e: DragStartEvent) => setDragId(Number(e.active.id))}
                  onDragEnd={onDragEnd}
                  onDragCancel={() => setDragId(null)}
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    {shownGroups.map((g, gi) => (
                      <GroupCard
                        key={gi}
                        index={gi}
                        members={g}
                        memberMap={memberMap}
                        violations={violations}
                        canReceive={selected !== null}
                        onReceive={() => moveSelectedTo(gi)}
                        selected={selected}
                        onSelectMember={setSelected}
                      />
                    ))}
                  </div>
                  <DragOverlay>
                    {dragId !== null && <MemberChip member={memberMap.get(dragId)} dragging />}
                  </DragOverlay>
                </DndContext>
                <div className="mt-3">
                  <Button variant="outline" size="sm" disabled={busy} onClick={resetPlan}>
                    <RotateCcw className="mr-1 h-4 w-4" />
                    还原到求解器原始结果
                  </Button>
                </div>
              </div>

              {/* 右：得分面板 */}
              <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Gauge className="h-4 w-4" />
                      四维得分
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-52">
                      <ResponsiveContainer>
                        <RadarChart
                          data={DIMS.map((d) => ({ dim: d.label, score: Number(plan[d.field]) }))}
                        >
                          <PolarGrid />
                          <PolarAngleAxis dataKey="dim" tick={{ fontSize: 12 }} />
                          <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                          <Radar dataKey="score" stroke="#f97316" fill="#f97316" fillOpacity={0.35} />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="mt-2 text-center text-sm text-muted-foreground">
                      综合得分{' '}
                      <span className="text-lg font-semibold text-foreground tabular-nums">
                        {Number(plan.totalScore).toFixed(1)}
                      </span>
                    </p>
                  </CardContent>
                </Card>

                {preview && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">上次拖动的影响</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1 text-sm">
                      {DIMS.map((d) => {
                        const delta = preview.deltas[d.key];
                        if (delta === undefined) return null;
                        return (
                          <div key={d.key} className="flex justify-between">
                            <span>{d.label}</span>
                            <span
                              className={
                                delta > 0
                                  ? 'text-green-600 tabular-nums'
                                  : delta < 0
                                    ? 'text-red-600 tabular-nums'
                                    : 'tabular-nums text-muted-foreground'
                              }
                            >
                              {delta > 0 ? '+' : ''}
                              {delta.toFixed(2)}
                            </span>
                          </div>
                        );
                      })}
                      <div className="flex justify-between border-t pt-1 font-medium">
                        <span>总分</span>
                        <span className="tabular-nums">
                          {preview.totalBefore.toFixed(1)} → {preview.totalAfter.toFixed(1)}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {violations.length > 0 && (
                  <Card className="border-destructive">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base text-destructive">硬约束违规（已拒绝）</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-1 text-sm text-destructive">
                        {violations.map((v, i) => (
                          <li key={i}>
                            [{v.code}] {v.message}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                <p className="text-xs text-muted-foreground">
                  键盘替代路径：点击成员选中，再点目标组卡片上的「移至此处」。
                </p>
              </div>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}

function GroupCard({
  index,
  members,
  memberMap,
  violations,
  canReceive,
  onReceive,
  selected,
  onSelectMember
}: {
  index: number;
  members: number[];
  memberMap: Map<number, Member>;
  violations: { code: string; message: string }[];
  canReceive: boolean;
  onReceive: () => void;
  selected: number | null;
  onSelectMember: (id: number | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: index });
  // 只标红违规消息中提及本组的卡片（消息格式：「第 N 组…」）
  const groupNo = `第 ${index + 1} 组`;
  const myViolations = violations.filter((v) => v.message.includes(groupNo));

  return (
    <Card
      ref={setNodeRef}
      className={
        myViolations.length > 0
          ? 'border-destructive border-2'
          : isOver
            ? 'border-primary border-2'
            : ''
      }
    >
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm">第{index + 1}组</CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{members.length} 人</Badge>
          {canReceive && (
            <Button size="sm" variant="outline" onClick={onReceive}>
              移至此处
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {members.map((uid) => (
          <MemberChip
            key={uid}
            member={memberMap.get(uid)}
            selected={selected === uid}
            onSelect={() => onSelectMember(selected === uid ? null : uid)}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function MemberChip({
  member,
  dragging = false,
  selected = false,
  onSelect
}: {
  member: Member | undefined;
  dragging?: boolean;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: member?.userId ?? 0,
    disabled: !member
  });
  if (!member) return null;

  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onSelect}
      className={
        'rounded-full border px-3 py-1 text-xs transition-colors ' +
        (dragging ? 'cursor-grabbing opacity-50 ' : 'cursor-grab hover:bg-accent ') +
        (selected ? 'border-primary bg-primary/10 font-medium ' : '')
      }
      title={`${member.name ?? ''} ${member.studentNo ?? ''}`}
    >
      {member.name ?? `#${member.userId}`}
      {member.studentNo ? ` · ${member.studentNo}` : ''}
    </button>
  );
}
