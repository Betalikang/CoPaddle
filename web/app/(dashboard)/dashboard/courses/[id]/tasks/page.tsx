'use client';

import useSWR from 'swr';
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Plus, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Callout, PageShell, Panel } from '@/components/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { QueryError } from '@/components/query-state';
import { swrFetcher } from '@/lib/api/client';
import {
  OPEN_STATUS,
  STATUS_LABEL,
  daysLeft,
  hoursOf,
  type Assignment,
  type ContractData,
  type Member,
  type PlanData,
  type Task
} from './task-shared';
import TaskContract from './task-contract';
import TaskListPanel from './task-list';
import { AssignDialog, DepDialog, ManualTaskDialog } from './task-dialogs';

/**
 * DAG 画布按需加载：reactflow 及其样式（约 100KB+）不再进主 chunk，
 * 列表 / 表单 / 契约这些主流程不用等图形包下载完。
 * 骨架尺寸与真实画布一致（h-[440px] / md:h-[540px]），加载完成不会把下方内容顶动。
 */
const TaskDag = dynamic(() => import('./task-dag'), {
  ssr: false,
  loading: () => <div className="h-[440px] animate-pulse rounded bg-muted md:h-[540px]" />
});

/** 任务页（规格书 C-02 / P-13 的 S3 子集）：AI 拆解 + DAG 可视化 + 依赖编辑 + 清单/看板 + 契约。 */
export default function GroupTasksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: groupsData, error: groupsError, mutate: mutateGroups } = useSWR<{
    groups: { id: number; name: string; members: Member[] }[];
  }>(`/api/courses/${id}/groups`, swrFetcher);
  const { data: courseData, error: courseError, mutate: mutateCourse } = useSWR<{
    myRole: string;
  }>(`/api/courses/${id}`, swrFetcher);
  const { data: meData, error: meError, mutate: mutateMe } = useSWR<{ user: { id: number } }>(
    '/api/auth/me',
    swrFetcher
  );
  const [pickedGroupId, setPickedGroupId] = useState<number | null>(null);
  const [view, setView] = useState<'list' | 'board'>('list');

  const allGroups = groupsData?.groups ?? [];
  const memberMap = useMemo(() => {
    const m = new Map<number, Member>();
    for (const g of allGroups) for (const mem of g.members) m.set(mem.userId, mem);
    return m;
  }, [allGroups]);
  const myUserId = meData?.user?.id ?? null;
  const myRole = courseData?.myRole ?? '';
  const isTeacherSide = myRole === 'teacher' || myRole === 'assistant';
  // 指派 / 依赖 / 删除三类写接口都要求 teacher|assistant|captain；
  // 队员只有在自己主责的任务上能流转状态，所以按钮按角色只显示能用的。
  const canManage = isTeacherSide || myRole === 'captain';
  // 角色 / 小组 / 当前用户三个请求都回来之前，不能判断「我属于哪个组」：
  // myUserId 还是 null 时会兜底到 allGroups[0]，先把别组的计划渲染出来、再跳变到自己的组。
  const waitingForBasics =
    (!courseData && !courseError) ||
    (!groupsData && !groupsError) ||
    (!isTeacherSide && !meData && !meError);
  // 教师/助教：只有显式选了组才展示某组计划（不再默默取第一个组）；
  // 队长/队员：只认自己所在的组，找不到就是没被分组，绝不兜底到别组。
  const group = !courseData
    ? null
    : isTeacherSide
      ? pickedGroupId === null
        ? null
        : (allGroups.find((g) => g.id === pickedGroupId) ?? null)
      : myUserId === null
        ? null
        : (allGroups.find((g) => g.members.some((m) => m.userId === myUserId)) ?? null);

  const { data, error, isLoading, mutate } = useSWR<PlanData>(
    group ? `/api/groups/${group.id}/task-plan` : null,
    swrFetcher
  );

  const {
    data: contract,
    error: contractError,
    mutate: mutateContract
  } = useSWR<ContractData>(group ? `/api/groups/${group.id}/contract` : null, swrFetcher);

  const [assignmentText, setAssignmentText] = useState('');
  const [generating, setGenerating] = useState(false);
  // AI 拆解最长可等到 120s，只给一句静态「拆解中」用户无法判断是卡死还是仍在跑，
  // 所以用一个每秒递增的秒数做「持续状态说明」（计划 P1-5 的要求）。
  const [genElapsed, setGenElapsed] = useState(0);
  const [genError, setGenError] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  // tone 含 success：手工新增任务成功后不该复用「操作未生效」这个失败标题，
  // 否则用户会以为又出错了。title 可覆盖默认标题。
  const [notice, setNotice] = useState<{
    tone: 'success' | 'warn' | 'danger';
    text: string;
    title?: string;
  } | null>(null);
  const [assigning, setAssigning] = useState<Task | null>(null);
  const [depTarget, setDepTarget] = useState<Task | null>(null);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // 生成中每秒推进一次秒表，结束时清零。用 interval 而不是 setInterval 写在 generate 里，
  // 是为了让异常路径（catch / 409 递归重发）也统一由 generating 状态收口。
  useEffect(() => {
    if (!generating) {
      setGenElapsed(0);
      return;
    }
    const startedAt = Date.now();
    setGenElapsed(0);
    const timer = setInterval(() => setGenElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [generating]);

  const tasks = data?.tasks ?? [];
  const deps = data?.deps ?? [];
  const assignments = data?.assignments ?? [];

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

  const stats = useMemo(() => {
    const done = tasks.filter((t) => t.status === 'done').length;
    const blocked = tasks.filter((t) => t.status === 'blocked').length;
    const overdue = tasks.filter(
      (t) => OPEN_STATUS.includes(t.status) && (daysLeft(t.dueAt) ?? 0) < 0
    ).length;
    const critical = tasks.filter((t) => t.onCriticalPath).length;
    const estTotal = tasks.reduce((s, t) => s + hoursOf(t.estHours), 0);
    const actTotal = tasks.reduce((s, t) => s + hoursOf(t.actualHours), 0);
    const remaining = tasks
      .filter((t) => OPEN_STATUS.includes(t.status))
      .reduce((s, t) => s + hoursOf(t.estHours), 0);
    return { done, blocked, overdue, critical, estTotal, actTotal, remaining, total: tasks.length };
  }, [tasks]);

  const leadOf = useCallback(
    (t: Task) => {
      const lead = (assignedByTask.get(t.id) ?? []).find((a) => a.raci === 'lead');
      return lead ? (memberMap.get(lead.userId)?.name ?? null) : null;
    },
    [assignedByTask, memberMap]
  );

  /** 统一请求：服务端用 {ok:false, reason} 表达业务失败（HTTP 可能是 200），这里一并当作失败。 */
  async function call(
    url: string,
    init?: RequestInit
  ): Promise<{ ok: boolean; body: Record<string, unknown> | null; error: string }> {
    try {
      const res = await fetch(url, init);
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (body && body.ok === false) {
        return { ok: false, body, error: String(body.reason ?? body.error ?? '操作未生效') };
      }
      if (!res.ok) {
        return { ok: false, body, error: String(body?.error ?? `请求失败（HTTP ${res.status}）`) };
      }
      return { ok: true, body, error: '' };
    } catch {
      return { ok: false, body: null, error: '网络异常，操作未生效，请重试' };
    }
  }

  async function generate(confirmRegenerate = false) {
    if (!group || !assignmentText.trim()) return;
    setGenerating(true);
    setGenError('');
    setNotice(null);
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
      // 409 = 已有计划，需要用户确认后再带 confirmRegenerate 重发
      if (res.status === 409) {
        const ok = window.confirm('该小组已有任务计划，重新生成将丢弃旧计划。确定继续？');
        if (ok) await generate(true);
        return;
      }
      // AI 接口可能返回 504 的 HTML 网关页或空 body，res.json() 会直接抛错，
      // 所以先容错解析，再按 status 决定文案。
      const body = (await res.json().catch(() => null)) as
        | { error?: string; detail?: string }
        | null;
      if (!res.ok) {
        setGenError(
          body?.error ?? body?.detail ?? `拆解失败（HTTP ${res.status}），请稍后重试`
        );
        return;
      }
      setAssignmentText('');
      setHighlightId(null);
      await mutate();
      await mutateContract();
    } catch (err) {
      // 网络中断 / 超时 / 响应不是 JSON：以前这里没有 catch，按钮会一直停在「AI 拆解中」，
      // 也没有任何提示，用户只能刷新页面——而刷新后输入框里的作业要求就没了。
      // 「手工新增任务」入口确实存在（POST /api/groups/[id]/tasks），所以可以如实指路。
      setGenError(
        `${err instanceof Error && err.name === 'AbortError' ? 'AI 拆解超时' : '网络异常，AI 拆解未生效'}：作业要求已保留，可以直接重试；也可以先用「手工新增任务」把活拆开。`
      );
    } finally {
      setGenerating(false);
    }
  }

  /**
   * 手工新建一个任务（AI 不可用时的降级入口，规格书 S4.10）。
   * 返回错误文案而不是抛异常：调用方要在对话框里保留用户已填的内容。
   */
  async function createManualTask(input: { title: string; estHours: number }): Promise<string> {
    if (!group) return '还没选定小组';
    const r = await call(`/api/groups/${group.id}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    });
    if (!r.ok) return r.error;
    await mutate();
    await mutateContract();
    setNotice({
      tone: 'success',
      title: '已新增任务',
      text: `「${input.title}」已建好，记得补依赖与指派。`
    });
    return '';
  }

  async function changeStatus(task: Task, toStatus: string) {
    const r = await call(`/api/tasks/${task.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toStatus })
    });
    if (!r.ok) {
      setNotice({
        tone: 'danger',
        text: `${task.code} ${task.title}：${r.error}（当前状态「${STATUS_LABEL[task.status] ?? task.status}」）`
      });
      return;
    }
    setNotice(null);
    await mutate();
  }

  async function assign(task: Task, userId: number, raci: string) {
    const r = await call(`/api/tasks/${task.id}/assignees`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, raci })
    });
    if (!r.ok) {
      setNotice({ tone: 'danger', text: `指派失败：${r.error}` });
      return;
    }
    setNotice(null);
    await mutate();
  }

  async function unassign(task: Task, userId: number) {
    const r = await call(`/api/tasks/${task.id}/assignees/${userId}`, { method: 'DELETE' });
    if (!r.ok) {
      setNotice({ tone: 'danger', text: `取消指派失败：${r.error}` });
      return;
    }
    setNotice(null);
    await mutate();
  }

  async function removeTask(task: Task) {
    if (!window.confirm(`删除任务「${task.code} ${task.title}」？依赖它的任务会失去这条依赖边。`)) return;
    const r = await call(`/api/tasks/${task.id}`, { method: 'DELETE' });
    if (!r.ok) {
      setNotice({ tone: 'danger', text: `删除失败：${r.error}` });
      return;
    }
    setNotice(null);
    await mutate();
  }

  async function addDep(task: Task, dependsOnId: number) {
    const r = await call(`/api/tasks/${task.id}/deps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dependsOnId })
    });
    if (!r.ok) {
      // 成环时服务端回传环上任务 id，翻成编号更好读
      const cycle = Array.isArray(r.body?.cycle)
        ? (r.body?.cycle as number[]).map((cid) => depName.get(cid)?.code ?? `#${cid}`)
        : [];
      setNotice({
        tone: 'danger',
        text: cycle.length > 0 ? `${r.error}：${cycle.join(' → ')}` : r.error
      });
      return false;
    }
    setNotice(null);
    await mutate();
    return true;
  }

  async function removeDep(task: Task, dependsOnId: number) {
    const r = await call(`/api/tasks/${task.id}/deps/${dependsOnId}`, { method: 'DELETE' });
    if (!r.ok) {
      setNotice({ tone: 'danger', text: `删除依赖失败：${r.error}` });
      return false;
    }
    setNotice(null);
    await mutate();
    return true;
  }

  function jumpToTask(taskId: number) {
    setHighlightId(taskId);
    const el = document.getElementById(`task-row-${taskId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const crumbs = [
    { label: '课程工作台', href: '/dashboard' },
    { label: '课程', href: `/dashboard/courses/${id}` },
    { label: '任务与依赖' }
  ];

  // 数据没就绪（或计划还在加载）时只给骨架：绝不用兜底组先渲染一版别组的计划
  if (waitingForBasics || (isLoading && group)) {
    return (
      <PageShell title="任务与依赖" breadcrumbs={crumbs} width="wide">
        <Skeleton className="h-64 w-full" />
      </PageShell>
    );
  }

  // 读失败要说清是哪一层失败（401/403/5xx）并给出对应动作。
  // 原来一律「加载失败，请刷新重试」——403 时刷新多少次都没用，也看不出是没有权限。
  if (groupsError || courseError || meError || error) {
    const firstError = courseError ?? groupsError ?? meError ?? error;
    const title = courseError
      ? '课程信息加载失败'
      : groupsError
        ? '小组列表加载失败'
        : meError
          ? '当前用户读取失败'
          : '任务计划加载失败';
    return (
      <PageShell title="任务与依赖" breadcrumbs={crumbs} width="wide">
        <QueryError
          error={firstError}
          onRetry={() => {
            if (courseError) void mutateCourse();
            if (groupsError) void mutateGroups();
            if (meError) void mutateMe();
            if (error) void mutate();
          }}
          title={title}
        />
      </PageShell>
    );
  }

  if (allGroups.length === 0) {
    return (
      <PageShell
        title="任务与依赖"
        breadcrumbs={crumbs}
        description="本课程还没有分组，先到分组工作台生成并选定方案。"
        width="wide"
      >
        <Panel>
          <p className="py-8 text-center text-sm text-muted-foreground">
            没有可操作的小组。
          </p>
        </Panel>
      </PageShell>
    );
  }

  // 教师/助教：先选一个小组再下发计划；学生：不在任何小组就是没有计划可看，
  // 不能借用别组的计划（审计 #25）。
  if (!group) {
    return (
      <PageShell
        title="任务与依赖"
        breadcrumbs={crumbs}
        description={
          isTeacherSide
            ? '任务计划按小组下发，先选一个小组。'
            : '任务计划按小组下发，你还没有被分到小组。'
        }
        width="wide"
      >
        {isTeacherSide ? (
          <Panel title="选择小组" hint={`本课程共 ${allGroups.length} 个小组`}>
            <div className="flex flex-wrap gap-2">
              {allGroups.map((g) => (
                <Button
                  key={g.id}
                  variant="outline"
                  size="sm"
                  onClick={() => setPickedGroupId(g.id)}
                >
                  {g.name}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    {g.members.length} 人
                  </span>
                </Button>
              ))}
            </div>
          </Panel>
        ) : (
          <Panel>
            <p className="py-8 text-center text-sm text-muted-foreground">
              你还没有被分到小组，请联系教师。
            </p>
          </Panel>
        )}
      </PageShell>
    );
  }

  const plan = data?.plan ?? null;
  const hasPlan = plan !== null && tasks.length > 0;
  const members = group.members;

  return (
    <PageShell
      title={`任务与依赖 · ${group.name}`}
      breadcrumbs={crumbs}
      description={
        hasPlan
          ? `${tasks.length} 个任务、${deps.length} 条依赖，AI 拆解后由你们校订。`
          : '粘贴作业要求，AI 拆成任务与依赖，再往下派活。'
      }
      width="wide"
      actions={
        <>
          {isTeacherSide && allGroups.length > 1 && (
            <Select value={String(group.id)} onValueChange={(v) => setPickedGroupId(Number(v))}>
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {allGroups.map((g) => (
                  <SelectItem key={g.id} value={String(g.id)}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {hasPlan && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setAssignmentText('');
                document.getElementById('assignment-input')?.scrollIntoView({ behavior: 'smooth' });
                textareaRef.current?.focus();
              }}
            >
              <RefreshCw className="mr-1 h-4 w-4" />
              重新拆解
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {!isTeacherSide && (
          <p className="text-xs text-muted-foreground">
            {canManage
              ? '你是本组队长，可以指派、调整依赖并流转本组任务。'
              : '你只能流转自己主责的任务；指派与依赖调整由队长或教师操作。'}
          </p>
        )}

        {notice && (
          <Callout
            tone={notice.tone}
            title={notice.title ?? (notice.tone === 'danger' ? '操作未生效' : '提示')}
          >
            <div className="flex items-start justify-between gap-3">
              <span>{notice.text}</span>
              <button
                type="button"
                className="shrink-0 text-xs underline underline-offset-2"
                onClick={() => setNotice(null)}
              >
                知道了
              </button>
            </div>
          </Callout>
        )}

        {plan && plan.validateProblems && plan.validateProblems.length > 0 && (
          <Callout tone="warn" title="AI 输出待人工修正">
            <ul className="list-inside list-disc">
              {plan.validateProblems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </Callout>
        )}

        {/* 进度概览 */}
        {hasPlan && (
          <Panel
            title="进度概览"
            hint={`计划生成于 ${plan?.assignmentTitle ? plan.assignmentTitle : `#${plan?.id}`}`}
            actions={
              plan?.llmModel ? (
                <span className="text-xs text-muted-foreground">模型 {plan.llmModel}</span>
              ) : null
            }
          >
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex items-baseline justify-between text-xs text-muted-foreground">
                  <span>
                    完成 {stats.done} / {stats.total}
                  </span>
                  <span className="tabular-nums">
                    {stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-success transition-all"
                    style={{
                      width: `${stats.total > 0 ? (stats.done / stats.total) * 100 : 0}%`
                    }}
                  />
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
                <Stat label="剩余工时" value={`${stats.remaining}h`} sub={`总估 ${stats.estTotal}h`} />
                <Stat
                  label="已投入"
                  value={`${stats.actTotal}h`}
                  sub={stats.actTotal > 0 ? '按实际填报' : '尚未填报'}
                />
                <Stat
                  label="逾期"
                  value={String(stats.overdue)}
                  sub="未完成任务中已过截止"
                  tone={stats.overdue > 0 ? 'danger' : undefined}
                />
                <Stat
                  label="阻塞"
                  value={String(stats.blocked)}
                  sub="需要清除障碍"
                  tone={stats.blocked > 0 ? 'warn' : undefined}
                />
                <Stat label="关键路径" value={String(stats.critical)} sub="延误即整体延误" />
              </dl>
            </div>
          </Panel>
        )}

        {/* 生成区 */}
        <Panel
          id="assignment-input"
          title="作业要求"
          hint="粘贴原文即可，PDF / DOCX 里的文字都行"
        >
          <div className="space-y-3">
            <Textarea
              ref={textareaRef}
              rows={4}
              value={assignmentText}
              onChange={(e) => setAssignmentText(e.target.value)}
              placeholder="粘贴作业要求原文…"
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={generating || !assignmentText.trim()}
                onClick={() => generate(false)}
              >
                <Sparkles className="mr-1 h-4 w-4" />
                {generating ? `AI 拆解中（已 ${genElapsed} 秒）…` : hasPlan ? '按新要求重新拆解' : 'AI 拆解为任务 DAG'}
              </Button>
              {canManage && (
                <Button variant="outline" onClick={() => setManualOpen(true)}>
                  <Plus className="mr-1 h-4 w-4" />
                  手工新增任务
                </Button>
              )}
              {hasPlan && (
                <span className="text-xs text-muted-foreground">
                  已有计划，重新拆解会先让你确认。
                </span>
              )}
            </div>
            {generating && (
              // 文案与服务端超时对齐：lib/services/tasks.ts:105 的服务端上限是 120s（LLM 90s + 余量），
              // 以前这里写「最长约 90 秒」、按钮写「最长约 2 分钟」，三处数字互相矛盾。
              <p className="text-xs text-muted-foreground" role="status">
                AI 正在拆解（已等待 {genElapsed} 秒），逐条生成任务与依赖。
                通常 20–90 秒返回，服务端上限 120 秒；超过说明请求已超时，会在这里给出提示。
                等不及可以先用手工新增任务，两条路互不影响。
              </p>
            )}
            {genError && <p className="text-sm text-destructive" role="alert">{genError}</p>}
          </div>
        </Panel>

        {/* DAG 视图（reactflow 走 next/dynamic，不阻塞主流程） */}
        {hasPlan && (
          <TaskDag
            tasks={tasks}
            deps={deps}
            leadOf={leadOf}
            highlightId={highlightId}
            onSelectTask={jumpToTask}
            onClearHighlight={() => setHighlightId(null)}
            fitKey={group.id}
          />
        )}

        {/* 任务：清单 / 看板 二选一 */}
        {hasPlan && (
          <TaskListPanel
            tasks={tasks}
            deps={deps}
            assignments={assignments}
            memberMap={memberMap}
            myUserId={myUserId}
            canManage={canManage}
            view={view}
            onViewChange={setView}
            onChangeStatus={changeStatus}
            onOpenAssign={setAssigning}
            onOpenDep={setDepTarget}
            onRemoveTask={(t) => void removeTask(t)}
            highlightId={highlightId}
          />
        )}

        {/* 协作契约 */}
        <TaskContract
          contract={contract}
          error={contractError}
          members={members}
          groupId={group.id}
          onRetry={() => void mutateContract()}
          onPublished={() => void mutateContract()}
        />

        {/* 手工新增任务 */}
        {manualOpen && (
          <ManualTaskDialog onClose={() => setManualOpen(false)} onCreate={createManualTask} />
        )}

        {/* 指派对话框 */}
        {assigning && (
          <AssignDialog
            task={assigning}
            members={members}
            assigned={(assignedByTask.get(assigning.id) ?? []).slice()}
            onAssign={(userId, raci) => assign(assigning, userId, raci)}
            onUnassign={(userId) => unassign(assigning, userId)}
            onClose={() => setAssigning(null)}
          />
        )}

        {/* 依赖对话框 */}
        {depTarget && (
          <DepDialog
            task={depTarget}
            tasks={tasks}
            deps={deps.filter((d) => d.taskId === depTarget.id)}
            depName={depName}
            onAdd={(dependsOnId) => addDep(depTarget, dependsOnId)}
            onRemove={(dependsOnId) => removeDep(depTarget, dependsOnId)}
            onClose={() => setDepTarget(null)}
          />
        )}
      </div>
    </PageShell>
  );
}

function Stat({
  label,
  value,
  sub,
  tone
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'warn' | 'danger';
}) {
  const color =
    tone === 'danger'
      ? 'text-destructive'
      : tone === 'warn'
        ? 'text-warning'
        : '';
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${color}`}>{value}</dd>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
