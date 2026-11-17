'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CheckCircle2, Link2, Search, SearchX, Trash2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Panel } from '@/components/page-shell';
import { EmptyState } from '@/components/empty-state';
import { Input } from '@/components/ui/input';
import { Pager, usePagination } from '@/components/ui/pager';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  NEXT_STATUS,
  OPEN_STATUS,
  RACI_LABEL,
  RACI_ORDER,
  STATUS_COLOR,
  STATUS_LABEL,
  daysLeft,
  dueText,
  hoursOf,
  type Assignment,
  type Dep,
  type Member,
  type Task
} from './task-shared';

/**
 * 任务区「清单 / 看板 二选一」面板。
 *
 * 筛选、排序、分页都是纯展示状态，留在组件内部；写操作（流转状态 / 指派 / 依赖 / 删除）
 * 由页面传进来——它们持有 SWR mutate 与 notice，不能下沉到这里。
 */
export default function TaskListPanel({
  tasks,
  deps,
  assignments,
  memberMap,
  myUserId,
  canManage,
  view,
  onViewChange,
  onChangeStatus,
  onOpenAssign,
  onOpenDep,
  onRemoveTask,
  highlightId
}: {
  tasks: Task[];
  deps: Dep[];
  assignments: Assignment[];
  memberMap: Map<number, Member>;
  myUserId: number | null;
  canManage: boolean;
  view: 'list' | 'board';
  onViewChange: (view: 'list' | 'board') => void;
  onChangeStatus: (task: Task, toStatus: string) => Promise<void>;
  onOpenAssign: (task: Task) => void;
  onOpenDep: (task: Task) => void;
  onRemoveTask: (task: Task) => void;
  highlightId: number | null;
}) {
  const [kw, setKw] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [focusFilter, setFocusFilter] = useState<'all' | 'critical' | 'overdue' | 'mine'>('all');
  const [sortBy, setSortBy] = useState<'order' | 'due' | 'hours'>('order');

  const depName = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const assignedByTask = useMemo(() => {
    const m = new Map<number, Assignment[]>();
    for (const a of assignments) {
      const list = m.get(a.taskId) ?? [];
      list.push(a);
      m.set(a.taskId, list);
    }
    return m;
  }, [assignments]);
  const depCountByTask = useMemo(() => {
    const m = new Map<number, number>();
    for (const d of deps) m.set(d.taskId, (m.get(d.taskId) ?? 0) + 1);
    return m;
  }, [deps]);

  const shownTasks = useMemo(() => {
    const q = kw.trim().toLowerCase();
    const list = tasks.filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (focusFilter === 'critical' && !t.onCriticalPath) return false;
      if (focusFilter === 'overdue') {
        if (!OPEN_STATUS.includes(t.status) || (daysLeft(t.dueAt) ?? -1) >= 0) return false;
      }
      if (focusFilter === 'mine') {
        const mine = assignedByTask.get(t.id) ?? [];
        if (!myUserId || !mine.some((a) => a.userId === myUserId)) return false;
      }
      if (!q) return true;
      const lead = (assignedByTask.get(t.id) ?? [])
        .map((a) => memberMap.get(a.userId)?.name ?? '')
        .join(' ');
      return (
        t.title.toLowerCase().includes(q) ||
        t.code.toLowerCase().includes(q) ||
        (t.description ?? '').toLowerCase().includes(q) ||
        (t.milestone ?? '').toLowerCase().includes(q) ||
        lead.toLowerCase().includes(q)
      );
    });
    const sorted = [...list];
    if (sortBy === 'due') {
      sorted.sort((a, b) => (daysLeft(a.dueAt) ?? 9999) - (daysLeft(b.dueAt) ?? 9999));
    } else if (sortBy === 'hours') {
      sorted.sort((a, b) => hoursOf(b.estHours) - hoursOf(a.estHours));
    } else {
      sorted.sort((a, b) => a.orderIndex - b.orderIndex);
    }
    return sorted;
  }, [tasks, kw, statusFilter, focusFilter, sortBy, assignedByTask, memberMap, myUserId]);

  const taskPager = usePagination(shownTasks, 20);
  useEffect(() => {
    taskPager.setPage(1);
  }, [kw, statusFilter, focusFilter, sortBy, taskPager.setPage]);

  const filtering =
    kw.trim() !== '' || statusFilter !== 'all' || focusFilter !== 'all';

  return (
    <Panel
      title={view === 'list' ? `任务清单（${filtering ? `${shownTasks.length} / ${tasks.length}` : tasks.length}）` : '任务看板'}
      hint={view === 'board' ? '拖动卡片改状态，服务端会校验流转是否合法' : undefined}
      actions={
        <div className="flex gap-1">
          <Button
            size="sm"
            variant={view === 'list' ? 'default' : 'outline'}
            onClick={() => onViewChange('list')}
          >
            清单
          </Button>
          <Button
            size="sm"
            variant={view === 'board' ? 'default' : 'outline'}
            onClick={() => onViewChange('board')}
          >
            看板
          </Button>
        </div>
      }
      bodyClassName="overflow-x-auto"
    >
      {view === 'board' ? (
        <KanbanBoard
          tasks={tasks}
          assignments={assignments}
          memberMap={memberMap}
          onMove={onChangeStatus}
          canMoveTask={(t) =>
            canManage ||
            assignments.some(
              (a) => a.taskId === t.id && a.raci === 'lead' && a.userId === myUserId
            )
          }
        />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={kw}
                onChange={(e) => setKw(e.target.value)}
                placeholder="搜索标题 / 编号 / 负责人"
                className="h-8 w-full pl-7 text-xs sm:w-56"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                {OPEN_STATUS.concat(['done', 'cancelled']).map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={focusFilter}
              onValueChange={(v) => setFocusFilter(v as typeof focusFilter)}
            >
              <SelectTrigger className="h-8 w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部任务</SelectItem>
                <SelectItem value="critical">只看关键路径</SelectItem>
                <SelectItem value="overdue">只看逾期</SelectItem>
                <SelectItem value="mine">只看我的</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
              <SelectTrigger className="h-8 w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="order">按拆解顺序</SelectItem>
                <SelectItem value="due">按截止时间</SelectItem>
                <SelectItem value="hours">按工时</SelectItem>
              </SelectContent>
            </Select>
            {filtering && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-xs"
                onClick={() => {
                  setKw('');
                  setStatusFilter('all');
                  setFocusFilter('all');
                }}
              >
                清除筛选
              </Button>
            )}
          </div>

          {shownTasks.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="没有符合条件的任务"
              hint="试试清除筛选。"
            />
          ) : (
            <>
              <Table className="min-w-[880px]">
                <TableHeader>
                  <TableRow className="text-left text-xs text-muted-foreground">
                    <TableHead className="h-auto py-2 pr-3 font-normal">编号</TableHead>
                    <TableHead className="h-auto py-2 pr-3 font-normal">任务</TableHead>
                    <TableHead className="h-auto py-2 pr-3 font-normal">状态</TableHead>
                    <TableHead className="h-auto py-2 pr-3 font-normal">负责人</TableHead>
                    <TableHead className="h-auto py-2 pr-3 font-normal">工时</TableHead>
                    <TableHead className="h-auto py-2 pr-3 font-normal">截止</TableHead>
                    <TableHead className="h-auto py-2 pr-3 font-normal">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {taskPager.pageItems.map((t) => {
                    const assigned = (assignedByTask.get(t.id) ?? [])
                      .slice()
                      .sort(
                        (a, b) => RACI_ORDER.indexOf(a.raci) - RACI_ORDER.indexOf(b.raci)
                      );
                    const nexts = NEXT_STATUS[t.status] ?? [];
                    const upstream = deps
                      .filter((d) => d.taskId === t.id)
                      .map((d) => depName.get(d.dependsOnId))
                      .filter((d): d is Task => Boolean(d));
                    const due = dueText(t.dueAt, t.status);
                    const isMyLead = assigned.some(
                      (a) => a.userId === myUserId && a.raci === 'lead'
                    );
                    const canMove = canManage || isMyLead;
                    return (
                      <TableRow
                        key={t.id}
                        id={`task-row-${t.id}`}
                        className={`border-b align-top last:border-0 ${
                          highlightId === t.id ? 'bg-brand/5' : ''
                        }`}
                      >
                        <TableCell className="py-2.5 pr-3 font-mono text-xs whitespace-nowrap">
                          {t.code}
                        </TableCell>
                        <TableCell className="py-2.5 pr-3">
                          <div className="font-medium">
                            {t.title}
                            {t.onCriticalPath && (
                              <span className="ml-1.5 text-xs font-normal text-danger">
                                关键路径
                              </span>
                            )}
                            {t.priority === 'high' && (
                              <span className="ml-1.5 text-xs font-normal text-warning">
                                高优先
                              </span>
                            )}
                          </div>
                          {t.description && (
                            <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                              {t.description}
                            </div>
                          )}
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            {t.milestone && (
                              <span className="rounded bg-muted px-1.5 py-0.5">{t.milestone}</span>
                            )}
                            {upstream.length > 0 ? (
                              <span>
                                前置 {upstream.map((u) => u.code).join('、')}
                              </span>
                            ) : (
                              <span>无前置</span>
                            )}
                            {t.blockedReason && (
                              <span className="text-destructive">阻塞：{t.blockedReason}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="py-2.5 pr-3 whitespace-nowrap">
                          <Badge
                            variant="outline"
                            style={{ borderColor: STATUS_COLOR[t.status] }}
                          >
                            {STATUS_LABEL[t.status] ?? t.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-2.5 pr-3">
                          {assigned.length === 0 ? (
                            <span className="text-xs text-muted-foreground">未指派</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {assigned.map((a) => (
                                <span
                                  key={a.id}
                                  className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs whitespace-nowrap"
                                >
                                  {memberMap.get(a.userId)?.name ?? `#${a.userId}`}
                                  <span className="text-muted-foreground">
                                    {RACI_LABEL[a.raci] ?? a.raci}
                                  </span>
                                </span>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="py-2.5 pr-3 text-xs whitespace-nowrap tabular-nums">
                          <div>{hoursOf(t.estHours)}h</div>
                          {t.actualHours !== null && (
                            <div className="text-muted-foreground">
                              实 {hoursOf(t.actualHours)}h
                            </div>
                          )}
                        </TableCell>
                        <TableCell className={`py-2.5 pr-3 text-xs whitespace-nowrap ${due.className}`}>
                          {due.text}
                        </TableCell>
                        <TableCell className="py-2.5 pr-3">
                          <div className="flex flex-wrap items-center gap-1">
                            {nexts.length > 0 && canMove ? (
                              <Select onValueChange={(v) => void onChangeStatus(t, v)}>
                                <SelectTrigger className="h-7 w-20 text-xs">
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
                            ) : (
                              <span className="inline-flex h-7 items-center gap-1 px-1 text-xs text-muted-foreground">
                                {t.status === 'done' ? (
                                  <>
                                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                                    {STATUS_LABEL[t.status]}
                                  </>
                                ) : canMove ? (
                                  STATUS_LABEL[t.status]
                                ) : (
                                  '无权限流转'
                                )}
                              </span>
                            )}
                            {canManage && (
                              <>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => onOpenAssign(t)}
                                >
                                  <UserPlus className="mr-1 h-3.5 w-3.5" />
                                  指派
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => onOpenDep(t)}
                                >
                                  <Link2 className="mr-1 h-3.5 w-3.5" />
                                  依赖{depCountByTask.get(t.id) ? `(${depCountByTask.get(t.id)})` : ''}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-destructive"
                                  onClick={() => onRemoveTask(t)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <Pager {...taskPager.pagerProps} unit="条" />
            </>
          )}
        </div>
      )}
    </Panel>
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
  onMove,
  canMoveTask
}: {
  tasks: Task[];
  assignments: Assignment[];
  memberMap: Map<number, Member>;
  onMove: (task: Task, toStatus: string) => Promise<void>;
  canMoveTask: (task: Task) => boolean;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [dragTask, setDragTask] = useState<Task | null>(null);
  // 主责人（RACI=lead）映射
  const leadByTask = useMemo(() => {
    const m = new Map<number, number>();
    for (const a of assignments) {
      if (a.raci === 'lead') m.set(a.taskId, a.userId);
    }
    return m;
  }, [assignments]);

  const byStatus = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const col of BOARD_COLUMNS) m.set(col.status, []);
    for (const t of tasks) {
      const list = m.get(t.status);
      if (list) list.push(t);
    }
    for (const list of m.values()) {
      list.sort((a, b) => (daysLeft(a.dueAt) ?? 9999) - (daysLeft(b.dueAt) ?? 9999));
    }
    return m;
  }, [tasks]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setDragTask(null);
    if (!over) return;
    const taskId = Number(active.id);
    const toStatus = String(over.id);
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === toStatus) return;
    void onMove(task, toStatus);
  }

  const dragging = dragTask;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e: DragStartEvent) =>
        setDragTask(tasks.find((t) => t.id === Number(e.active.id)) ?? null)
      }
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDragTask(null)}
    >
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {BOARD_COLUMNS.map((col) => {
          const list = byStatus.get(col.status) ?? [];
          const hours = list.reduce((s, t) => s + hoursOf(t.estHours), 0);
          return (
            <BoardColumn
              key={col.status}
              status={col.status}
              label={col.label}
              count={list.length}
              hours={hours}
            >
              {list.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  member={memberMap.get(leadByTask.get(t.id) ?? 0)}
                  dragging={dragging?.id === t.id}
                  draggable={canMoveTask(t)}
                />
              ))}
            </BoardColumn>
          );
        })}
      </div>
      <DragOverlay>
        {dragging ? (
          <TaskCard
            task={dragging}
            member={memberMap.get(leadByTask.get(dragging.id) ?? 0)}
            overlay
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function BoardColumn({
  status,
  label,
  count,
  hours,
  children
}: {
  status: string;
  label: string;
  count: number;
  hours: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={`min-h-32 rounded-lg border bg-muted/40 p-2 ${isOver ? 'border-primary ring-1 ring-primary/30' : ''}`}
    >
      <div className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">
          {count}
          {hours > 0 && <span className="ml-1 font-normal">{hours}h</span>}
        </span>
      </div>
      <div className="space-y-2">
        {count === 0 ? (
          <EmptyState compact className="border-0 bg-transparent" title="空" />
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function TaskCard({
  task,
  member,
  dragging,
  overlay,
  draggable = true
}: {
  task: Task;
  member: Member | undefined;
  dragging?: boolean;
  overlay?: boolean;
  draggable?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    disabled: !draggable
  });
  const due = dueText(task.dueAt, task.status);
  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      {...(overlay || !draggable ? {} : listeners)}
      {...(overlay || !draggable ? {} : attributes)}
      className={`rounded border bg-white p-2 text-xs shadow-sm ${
        draggable ? 'cursor-grab' : ''
      } ${isDragging || dragging ? 'opacity-50' : ''} ${overlay ? 'shadow-lg' : ''}`}
    >
      <div className="flex items-center justify-between gap-1 font-mono text-muted-foreground">
        <span>{task.code}</span>
        {task.onCriticalPath && (
          <span className="font-sans text-danger">关键</span>
        )}
      </div>
      <div className="font-medium">{task.title}</div>
      <div className="mt-1 text-muted-foreground">
        {member?.name ?? '未指派'} · {hoursOf(task.estHours)}h
        {task.milestone && <span className="ml-1">· {task.milestone}</span>}
      </div>
      <div className={`mt-0.5 ${due.className}`}>{due.text}</div>
    </div>
  );
}