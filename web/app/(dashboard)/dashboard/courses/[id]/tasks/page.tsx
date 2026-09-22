'use client';

import useSWR from 'swr';
import { use, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  type Edge,
  type Node
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { FileText, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type Task = {
  id: number;
  code: string;
  title: string;
  status: string;
  estHours: string;
  dueAt: string | null;
  deliverableType: string;
  onCriticalPath: boolean;
};

type PlanData = {
  plan: {
    id: number;
    validated: boolean;
    validateProblems: string[] | null;
    assignmentTitle: string | null;
    llmModel: string | null;
  } | null;
  tasks: Task[];
  deps: { taskId: number; dependsOnId: number }[];
  assignments: { id: number; taskId: number; userId: number; raci: string }[];
};

const STATUS_LABEL: Record<string, string> = {
  todo: '待启动',
  doing: '进行中',
  blocked: '阻塞',
  reviewing: '审阅中',
  done: '已完成',
  cancelled: '已取消'
};

const STATUS_COLOR: Record<string, string> = {
  todo: '#a1a1aa',
  doing: '#3b82f6',
  blocked: '#ef4444',
  reviewing: '#f59e0b',
  done: '#22c55e',
  cancelled: '#71717a'
};

const NEXT_STATUS: Record<string, string[]> = {
  todo: ['doing', 'blocked'],
  doing: ['reviewing', 'blocked'],
  blocked: ['doing'],
  reviewing: ['done', 'doing'],
  done: [],
  cancelled: []
};

/** 分层布局：Kahn 拓扑分层，同层纵排。DAG 编辑交互（拖拽/连线）为后续迭代。 */
function layoutDag(tasks: Task[], deps: PlanData['deps']): { nodes: Node[]; edges: Edge[] } {
  const level = new Map<number, number>();
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const remaining = new Set(tasks.map((t) => t.id));
  let guard = 0;
  while (remaining.size > 0 && guard++ < 100) {
    for (const id of [...remaining]) {
      const myDeps = deps.filter((d) => d.taskId === id).map((d) => d.dependsOnId);
      if (myDeps.every((d) => !byId.has(d) || level.has(d))) {
        level.set(id, myDeps.length ? Math.max(...myDeps.map((d) => level.get(d) ?? 0)) + 1 : 0);
        remaining.delete(id);
      }
    }
  }
  // 兜底：环上任务放最后一层
  for (const id of remaining) level.set(id, 0);

  const perLevel = new Map<number, number>();
  const nodes: Node[] = tasks.map((t) => {
    const lv = level.get(t.id) ?? 0;
    const idx = perLevel.get(lv) ?? 0;
    perLevel.set(lv, idx + 1);
    return {
      id: String(t.id),
      position: { x: lv * 260, y: idx * 110 },
      data: {
        label: (
          <div className="text-xs">
            <div className="font-medium">
              {t.code} {t.title}
            </div>
            <div className="text-muted-foreground">
              {STATUS_LABEL[t.status] ?? t.status} · {t.estHours}h
            </div>
          </div>
        )
      },
      style: {
        border: `2px solid ${STATUS_COLOR[t.status] ?? '#a1a1aa'}`,
        borderRadius: 8,
        background: 'white',
        width: 220,
        fontSize: 12
      }
    };
  });

  const edges: Edge[] = deps
    .filter((d) => byId.has(d.taskId) && byId.has(d.dependsOnId))
    .map((d) => ({
      id: `e${d.dependsOnId}-${d.taskId}`,
      source: String(d.dependsOnId),
      target: String(d.taskId),
      markerEnd: { type: MarkerType.ArrowClosed }
    }));

  return { nodes, edges };
}

/** 任务页（规格书 C-02 / P-13 的 S3 子集）：AI 拆解 + DAG 可视化 + 表格操作 + 契约。 */
export default function GroupTasksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const { data: groupsData } = useSWR<{
    groups: { id: number; name: string; members: { userId: number; name: string | null; studentNo: string | null; className?: string | null }[] }[];
  }>(`/api/courses/${id}/groups`, fetcher);
  const { data: courseData } = useSWR<{ myRole: string }>(`/api/courses/${id}`, fetcher);
  const { data: meData } = useSWR<{ user: { id: number } }>('/api/auth/me', fetcher);
  const [pickedGroupId, setPickedGroupId] = useState<number | null>(null);
  const [view, setView] = useState<'list' | 'board'>('list');

  const allGroups = groupsData?.groups ?? [];
  const memberMap = useMemo(() => {
    const m = new Map<number, { name: string | null; studentNo: string | null }>();
    for (const g of allGroups) for (const mem of g.members) m.set(mem.userId, mem);
    return m;
  }, [allGroups]);
  const isTeacherSide = courseData?.myRole === 'teacher' || courseData?.myRole === 'assistant';
  // 教师/助教：按小组下发（切换目标小组，作业要求下发给该组组长）
  // 队长/队员：锁定自己所在的小组
  const group = isTeacherSide
    ? (allGroups.find((g) => g.id === pickedGroupId) ?? allGroups[0])
    : (allGroups.find((g) => g.members.some((m) => m.userId === meData?.user?.id)) ?? allGroups[0]);

  const { data, error, isLoading, mutate } = useSWR<PlanData>(
    group ? `/api/groups/${group.id}/task-plan` : null,
    fetcher
  );

  const { data: contract } = useSWR(
    group ? `/api/groups/${group.id}/contract` : null,
    fetcher
  );

  const [assignmentText, setAssignmentText] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');
  const [assigning, setAssigning] = useState<Task | null>(null);

  const tasks = data?.tasks ?? [];
  const deps = data?.deps ?? [];
  const { nodes, edges } = useMemo(() => layoutDag(tasks, deps), [tasks, deps]);

  async function generate(confirmRegenerate = false) {
    if (!group || !assignmentText.trim()) return;
    setGenerating(true);
    setGenError('');
    try {
      const res = await fetch(`/api/groups/${group.id}/task-plan/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignmentText: assignmentText.trim(),
          assignmentTitle: '小组作业',
          confirmRegenerate
        })
      });
      const body = await res.json();
      if (res.status === 409) {
        // 已有计划：重新生成需确认
        const ok = window.confirm('该小组已有任务计划，重新生成将丢弃旧计划。确定继续？');
        if (ok) await generate(true);
        return;
      }
      if (!res.ok) {
        setGenError(body.error ?? '拆解失败');
        return;
      }
      setAssignmentText('');
      await mutate();
    } finally {
      setGenerating(false);
    }
  }

  async function changeStatus(taskId: number, toStatus: string) {
    await fetch(`/api/tasks/${taskId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toStatus })
    });
    await mutate();
  }

  async function assign(taskId: number, userId: number, raci: string) {
    await fetch(`/api/tasks/${taskId}/assignees`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, raci })
    });
    setAssigning(null);
    await mutate();
  }

  async function removeTask(taskId: number) {
    if (!window.confirm('删除该任务？依赖它的任务将失去这条依赖边。')) return;
    await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
    await mutate();
  }

  if (isLoading && group) {
    return (
      <section className="flex-1">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-4 h-96" />
      </section>
    );
  }

  if (error) {
    return (
      <section className="flex-1">
        <p className="text-sm text-destructive">加载失败，请刷新重试。</p>
      </section>
    );
  }

  if (!group) {
    return (
      <section className="flex-1">
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            本课程还没有分组。请先在分组工作台生成并选定方案。
          </CardContent>
        </Card>
      </section>
    );
  }

  const plan = data?.plan ?? null;
  const hasPlan = plan && tasks.length > 0;

  return (
    <section className="flex-1">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg lg:text-2xl font-medium">
          任务与依赖 · {group.name}
          {!isTeacherSide && <span className="ml-2 text-sm text-muted-foreground">（你所在的小组）</span>}
        </h1>
        {isTeacherSide && allGroups.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {allGroups.map((g) => (
              <Button
                key={g.id}
                size="sm"
                variant={g.id === group.id ? 'default' : 'outline'}
                onClick={() => setPickedGroupId(g.id)}
              >
                {g.name}
              </Button>
            ))}
          </div>
        )}
        {hasPlan && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setAssignmentText('');
              document.getElementById('assignment-input')?.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            <RefreshCw className="mr-1 h-4 w-4" />
            重新拆解
          </Button>
        )}
      </div>

      {plan && plan.validateProblems && plan.validateProblems.length > 0 && (
        <Card className="mb-4 border-amber-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-amber-600">AI 输出待人工修正</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-inside list-disc text-sm text-amber-700">
              {plan.validateProblems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* 生成区 */}
      <Card className="mb-4" id="assignment-input">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" />
            作业要求
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            rows={4}
            value={assignmentText}
            onChange={(e) => setAssignmentText(e.target.value)}
            placeholder="粘贴作业要求原文（PDF/DOCX 文本均可）…"
          />
          <div className="flex items-center gap-3">
            <Button
              disabled={generating || !assignmentText.trim()}
              onClick={() => generate(false)}
            >
              <Sparkles className="mr-1 h-4 w-4" />
              {generating ? 'AI 拆解中（最长 90s）…' : 'AI 拆解为任务 DAG'}
            </Button>
            {plan?.llmModel && (
              <span className="text-xs text-muted-foreground">模型：{plan.llmModel}</span>
            )}
          </div>
          {genError && <p className="text-sm text-destructive">{genError}</p>}
        </CardContent>
      </Card>

      {/* DAG 视图 */}
      {hasPlan && (
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">任务 DAG（节点颜色 = 状态，箭头 = 依赖方向）</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-96 rounded border">
              <ReactFlow nodes={nodes} edges={edges} fitView>
                <Background />
                <Controls />
              </ReactFlow>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 视图切换：列表 / 看板 */}
      {hasPlan && (
        <div className="mb-3 flex gap-1">
          <Button size="sm" variant={view === 'list' ? 'default' : 'outline'} onClick={() => setView('list')}>
            任务清单
          </Button>
          <Button size="sm" variant={view === 'board' ? 'default' : 'outline'} onClick={() => setView('board')}>
            任务看板
          </Button>
        </div>
      )}

      {/* 任务看板（C-04）：五列，拖拽改状态 */}
      {hasPlan && view === 'board' && (
        <KanbanBoard
          tasks={tasks}
          assignments={data?.assignments ?? []}
          memberMap={memberMap}
          onMove={async (taskId, toStatus) => {
            await fetch(`/api/tasks/${taskId}/status`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ toStatus })
            });
            await mutate();
          }}
        />
      )}

      {/* 任务表格 */}
      {hasPlan && view === 'list' && (
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">任务清单（{tasks.length}）</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3">编号</th>
                  <th className="py-2 pr-3">标题</th>
                  <th className="py-2 pr-3">状态</th>
                  <th className="py-2 pr-3">主责/协作</th>
                  <th className="py-2 pr-3">工时</th>
                  <th className="py-2 pr-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => {
                  const assigned = (data?.assignments ?? []).filter((a) => a.taskId === t.id);
                  const memberName = (uid: number) =>
                    group.members.find((m) => m.userId === uid)?.name ?? `#${uid}`;
                  const nexts = NEXT_STATUS[t.status] ?? [];
                  return (
                    <tr key={t.id} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-mono text-xs">{t.code}</td>
                      <td className="py-2 pr-3">{t.title}</td>
                      <td className="py-2 pr-3">
                        <Badge
                          variant="outline"
                          style={{ borderColor: STATUS_COLOR[t.status] }}
                        >
                          {STATUS_LABEL[t.status] ?? t.status}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3">
                        {assigned.length === 0 ? (
                          <span className="text-muted-foreground">未指派</span>
                        ) : (
                          assigned.map((a) => (
                            <span key={a.id} className="mr-2">
                              {memberName(a.userId)}
                              <span className="text-muted-foreground">
                                （{a.raci === 'lead' ? '主责' : a.raci === 'reviewer' ? '审阅' : '协作'}）
                              </span>
                            </span>
                          ))
                        )}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{t.estHours}h</td>
                      <td className="py-2 pr-3">
                        <div className="flex gap-1">
                          {nexts.length > 0 && (
                            <Select onValueChange={(v) => changeStatus(t.id, v)}>
                              <SelectTrigger className="h-7 w-24 text-xs">
                                <SelectValue placeholder="流转" />
                              </SelectTrigger>
                              <SelectContent>
                                {nexts.map((s) => (
                                  <SelectItem key={s} value={s}>
                                    {STATUS_LABEL[s]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7"
                            onClick={() => setAssigning(t)}
                          >
                            指派
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-destructive"
                            onClick={() => removeTask(t.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* 协作契约 */}
      {contract?.latest && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              协作契约 v{contract.latest.version}
              {contract.latest.publishedAt ? (
                <Badge variant="default" className="ml-2">已发布</Badge>
              ) : (
                <Badge variant="secondary" className="ml-2">草稿</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {contract.glossary.map((g: any) => (
              <div key={g.id} className="flex gap-2">
                <span className="font-medium">{g.term}</span>
                <span className="text-muted-foreground">{g.definition}</span>
                {g.unit && <span className="text-muted-foreground">（单位：{g.unit}）</span>}
              </div>
            ))}
            <p className="text-muted-foreground">
              签署情况：{contract.acceptances?.length ?? 0} / {group.members.length} 人
            </p>
            <PublishButton groupId={group.id} onDone={() => router.refresh()} />
          </CardContent>
        </Card>
      )}

      {/* 指派对话框 */}
      {assigning && (
        <Dialog open onOpenChange={() => setAssigning(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>
                指派：{assigning.code} {assigning.title}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              {group.members.map((m) => (
                <div key={m.userId} className="flex items-center justify-between gap-2">
                  <span className="text-sm">
                    {m.name ?? `#${m.userId}`}
                    {m.studentNo ? ` · ${m.studentNo}` : ''}
                  </span>
                  <span className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => assign(assigning.id, m.userId, 'lead')}>
                      主责
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => assign(assigning.id, m.userId, 'contributor')}>
                      协作
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => assign(assigning.id, m.userId, 'reviewer')}>
                      审阅
                    </Button>
                  </span>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}

function PublishButton({ groupId, onDone }: { groupId: number; onDone: () => void }) {
  const [publishing, setPublishing] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={publishing}
      onClick={async () => {
        setPublishing(true);
        try {
          await fetch(`/api/groups/${groupId}/contract`, { method: 'POST' });
          onDone();
        } finally {
          setPublishing(false);
        }
      }}
    >
      {publishing ? '发布中…' : '发布契约，通知成员确认'}
    </Button>
  );
}


const BOARD_COLUMNS = [
  { status: 'todo', label: '待启动' },
  { status: 'doing', label: '进行中' },
  { status: 'blocked', label: '阻塞' },
  { status: 'reviewing', label: '审阅中' },
  { status: 'done', label: '已完成' }
];

/** 组内看板（规格书 C-04）：五列，任务卡片拖拽改状态（服务端状态机校验）。 */
function KanbanBoard({
  tasks,
  assignments,
  memberMap,
  onMove
}: {
  tasks: Task[];
  assignments: { taskId: number; userId: number; raci: string }[];
  memberMap: Map<number, { name: string | null; studentNo: string | null }>;
  onMove: (taskId: number, toStatus: string) => Promise<void>;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  // 主责人（RACI=lead）映射
  const leadByTask = useMemo(() => {
    const m = new Map<number, number>();
    for (const a of assignments) {
      if (a.raci === 'lead') m.set(a.taskId, a.userId);
    }
    return m;
  }, [assignments]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const taskId = Number(active.id);
    const toStatus = String(over.id);
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === toStatus) return;
    void onMove(taskId, toStatus);
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {BOARD_COLUMNS.map((col) => (
          <BoardColumn key={col.status} status={col.status} label={col.label} count={
            tasks.filter((t) => t.status === col.status).length
          }>
            {tasks
              .filter((t) => t.status === col.status)
              .map((t) => (
                <TaskCard key={t.id} task={t} member={memberMap.get(leadByTask.get(t.id) ?? 0)} />
              ))}
          </BoardColumn>
        ))}
      </div>
    </DndContext>
  );
}

function BoardColumn({
  status,
  label,
  count,
  children
}: {
  status: string;
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={`min-h-32 rounded-lg border bg-muted/40 p-2 ${isOver ? 'border-primary' : ''}`}
    >
      <div className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        <span>{count}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function TaskCard({
  task,
  member
}: {
  task: Task;
  member: { name: string | null; studentNo: string | null } | undefined;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`cursor-grab rounded border bg-white p-2 text-xs shadow-sm ${isDragging ? 'opacity-50' : ''}`}
    >
      <div className="font-mono text-muted-foreground">{task.code}</div>
      <div className="font-medium">{task.title}</div>
      <div className="mt-1 text-muted-foreground">
        {member?.name ?? '未指派'} · {task.estHours}h
        {task.onCriticalPath && <span className="ml-1 text-orange-600">关键路径</span>}
      </div>
    </div>
  );
}
