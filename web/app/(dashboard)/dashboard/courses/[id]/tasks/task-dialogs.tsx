'use client';

import { useMemo, useState } from 'react';
import { Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
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
  DialogTitle
} from '@/components/ui/dialog';
import {
  RACI_LABEL,
  RACI_ORDER,
  STATUS_LABEL,
  type Assignment,
  type Dep,
  type Member,
  type Task
} from './task-shared';

/**
 * 任务页的三个对话框（手工新增 / 指派 / 依赖）。
 *
 * 组件本身不持页面级写操作：新增、指派、解绑、加依赖、删依赖都由 page.tsx 通过
 * props 传进来，对话框只负责表单状态与提交时序，便于页面的 SWR mutate 统一收口。
 */

/** 手工新建任务（AI 不可用 / 只想补一条时的入口）。失败时对话框不关，保留已填内容。 */
export function ManualTaskDialog({
  onClose,
  onCreate
}: {
  onClose: () => void;
  onCreate: (input: { title: string; estHours: number }) => Promise<string>;
}) {
  const [title, setTitle] = useState('');
  const [estHours, setEstHours] = useState('2');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const hours = Number(estHours);
  const hoursInvalid = !Number.isFinite(hours) || hours <= 0 || hours > 200;

  async function submit() {
    if (!title.trim() || hoursInvalid || busy) return;
    setBusy(true);
    setError('');
    const err = await onCreate({ title: title.trim(), estHours: hours });
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    onClose();
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>手工新增任务</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="manual-task-title" className="text-xs">任务标题</Label>
            <Input
              id="manual-task-title"
              className="mt-1"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="如：整理访谈记录并做主题编码"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
            />
          </div>
          <div>
            <Label htmlFor="manual-task-hours" className="text-xs">预估工时（小时）</Label>
            <Input
              id="manual-task-hours"
              className="mt-1 w-28"
              inputMode="decimal"
              value={estHours}
              onChange={(e) => setEstHours(e.target.value)}
            />
            {hoursInvalid && (
              <p className="mt-1 text-xs text-destructive">工时需为 0–200 之间的正数</p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            建好后可以在任务卡片里加依赖、指派主责人；依赖会做环检测。
          </p>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button
            size="sm"
            disabled={busy || !title.trim() || hoursInvalid}
            onClick={() => void submit()}
          >
            {busy ? '创建中…' : '创建任务'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AssignDialog({
  task,
  members,
  assigned,
  onAssign,
  onUnassign,
  onClose
}: {
  task: Task;
  members: Member[];
  assigned: Assignment[];
  onAssign: (userId: number, raci: string) => Promise<void>;
  onUnassign: (userId: number) => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const byUser = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const a of assigned) {
      const list = m.get(a.userId) ?? [];
      list.push(a.raci);
      m.set(a.userId, list);
    }
    return m;
  }, [assigned]);
  const leadCount = assigned.filter((a) => a.raci === 'lead').length;

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(true);
    setPending(key);
    try {
      await fn();
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            指派：{task.code} {task.title}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          主责人可自己流转状态；协作与审阅只用于分工与贡献判定。
          {leadCount > 1 && (
            <span className="ml-1 text-warning">
              当前有 {leadCount} 个主责，建议只留一个。
            </span>
          )}
        </p>
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {members.map((m) => {
            const raciList = byUser.get(m.userId) ?? [];
            return (
              <div key={m.userId} className="flex items-center justify-between gap-2">
                <span className="text-sm">
                  {m.name ?? `#${m.userId}`}
                  {m.studentNo ? ` · ${m.studentNo}` : ''}
                  {raciList.length > 0 && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      （{raciList.map((r) => RACI_LABEL[r] ?? r).join('、')}）
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 gap-1">
                  {RACI_ORDER.map((raci) => {
                    const active = raciList.includes(raci);
                    const key = `${m.userId}-${raci}`;
                    return (
                      <Button
                        key={raci}
                        size="sm"
                        variant={active ? 'default' : 'outline'}
                        className="h-7 px-2 text-xs"
                        disabled={busy || active}
                        onClick={() => void run(key, () => onAssign(m.userId, raci))}
                      >
                        {pending === key ? '…' : RACI_LABEL[raci]}
                      </Button>
                    );
                  })}
                  {raciList.length > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-destructive"
                      disabled={busy}
                      onClick={() =>
                        void run(`${m.userId}-remove`, () => onUnassign(m.userId))
                      }
                    >
                      移除
                    </Button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={onClose}>
            完成
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DepDialog({
  task,
  tasks,
  deps,
  depName,
  onAdd,
  onRemove,
  onClose
}: {
  task: Task;
  tasks: Task[];
  deps: Dep[];
  depName: Map<number, Task>;
  onAdd: (dependsOnId: number) => Promise<boolean>;
  onRemove: (dependsOnId: number) => Promise<boolean>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState('');
  const existing = new Set(deps.map((d) => d.dependsOnId));
  const candidates = tasks.filter((t) => t.id !== task.id && !existing.has(t.id));

  async function add() {
    const target = Number(pick);
    if (!Number.isFinite(target)) return;
    setBusy(true);
    try {
      if (await onAdd(target)) setPick('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            依赖：{task.code} {task.title}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-xs text-muted-foreground">当前前置（必须先完成这些）</p>
            {deps.length === 0 ? (
              <p className="rounded border border-dashed px-2 py-3 text-center text-xs text-muted-foreground">
                没有前置任务，可以随时开工。
              </p>
            ) : (
              <ul className="space-y-1">
                {deps.map((d) => {
                  const up = depName.get(d.dependsOnId);
                  return (
                    <li
                      key={d.dependsOnId}
                      className="flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-sm"
                    >
                      <span>
                        <span className="font-mono text-xs text-muted-foreground">{up?.code}</span>{' '}
                        {up?.title ?? `#${d.dependsOnId}`}
                        {up && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            （{STATUS_LABEL[up.status] ?? up.status}）
                          </span>
                        )}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 shrink-0 px-2 text-xs text-destructive"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await onRemove(d.dependsOnId);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        删除
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">新增前置任务（会做环检测，成环会被拒绝）</p>
            <div className="flex items-center gap-2">
              <Select value={pick} onValueChange={setPick}>
                <SelectTrigger className="h-8 flex-1 text-xs">
                  <SelectValue placeholder="选择任务" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">没有可选任务</div>
                  ) : (
                    candidates.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.code} {c.title}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <Button size="sm" className="h-8" disabled={busy || !pick} onClick={() => void add()}>
                <Link2 className="mr-1 h-3.5 w-3.5" />
                添加
              </Button>
            </div>
          </div>
        </div>
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={onClose}>
            完成
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}