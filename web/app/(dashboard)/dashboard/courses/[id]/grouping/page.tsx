'use client';

import { TeacherGate } from '@/components/course-role-gate';
import useSWR from 'swr';
import { use, useEffect, useMemo, useRef, useState } from 'react';
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
import { RotateCcw, Shuffle, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Callout, PageShell, Panel } from '@/components/page-shell';
import { EmptyState } from '@/components/empty-state';
import { QueryError } from '@/components/query-state';
import { Pager, usePagination } from '@/components/ui/pager';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { apiSend, describeApiError, isApiError, swrFetcher } from '@/lib/api/client';

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

type Member = { userId: number; name: string | null; studentNo: string | null; className: string | null };

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
function GroupingWorkbenchBody({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const courseId = Number(id);

  const { data, error, isLoading, mutate } = useSWR<{
    run: { id: number; status: string; degraded: boolean | null } | null;
    plans: Plan[];
    /** 服务端自愈回填出来的占位方案（分组未经求解器优化，分数已按当前数据重算） */
    synthesizedPlanIds?: number[];
  }>(`/api/courses/${courseId}/grouping/latest`, swrFetcher);

  const {
    data: groupsData,
    error: groupsError,
    isLoading: groupsLoading,
    mutate: mutateGroups
  } = useSWR<{
    groups: { id: number; name: string; status?: string; members: Member[] }[];
  }>(`/api/courses/${courseId}/groups`, swrFetcher);
  const { data: courseData } = useSWR<{ myRole: string }>(
    `/api/courses/${courseId}`,
    swrFetcher
  );

  /** 已落库、可用于解散的小组（解散指的是真小组，不是候选方案里的分组预览）。 */
  const activeGroups = useMemo(
    () => (groupsData?.groups ?? []).filter((g) => g.status !== 'dissolved'),
    [groupsData]
  );
  const [dissolveOpen, setDissolveOpen] = useState(false);
  const [dissolveId, setDissolveId] = useState<number | null>(null);

  // 成员信息取自 groups（组内角色均可读）：姓名 + 学号 + 班级
  const memberMap = useMemo(() => {
    const m = new Map<number, Member>();
    for (const g of groupsData?.groups ?? []) {
      for (const e of g.members) {
        m.set(e.userId, e);
      }
    }
    return m;
  }, [groupsData]);

  const plans = data?.plans ?? [];
  /**
   * 服务端自愈回填的占位方案 id。
   * 这些方案没有经过求解器、也没有重新打分，得分列是初始值。
   * 必须在界面上标出来——否则教师会把「由现有分组倒推出来的快照」当成
   * 求解器推荐的最佳方案直接选定。
   */
  const synthesizedPlanIds = useMemo(
    () => new Set(data?.synthesizedPlanIds ?? []),
    [data?.synthesizedPlanIds]
  );
  const [activePlanId, setActivePlanId] = useState<number | null>(null);
  const currentPlanId = activePlanId ?? plans[0]?.id ?? null;
  const currentPlan = plans.find((p) => p.id === currentPlanId) ?? null;

  // 本地快照：记录属于哪个方案，切 Tab 时自动回落到该方案的库内快照
  const [local, setLocal] = useState<{ planId: number; value: number[][] } | null>(null);
  // 预览分组：优先方案快照；空快照时用已落库小组兜底，避免左侧整块空白
  const formedFallback = useMemo(
    () =>
      (groupsData?.groups ?? [])
        .filter((g) => g.status !== 'dissolved')
        .map((g) => g.members.map((m) => m.userId))
        .filter((g) => g.length > 0),
    [groupsData]
  );
  const shownGroups = useMemo(() => {
    if (local && local.planId === currentPlanId) return local.value;
    const fromPlan = currentPlan?.groups ?? [];
    if (fromPlan.some((g) => (g?.length ?? 0) > 0)) return fromPlan;
    return formedFallback;
  }, [local, currentPlanId, currentPlan, formedFallback]);

  // 组数多（每班 8 组、24 组常见）时按页展示，避免一屏几十张卡片
  const groupingPager = usePagination(shownGroups, 8);
  const setGroupPage = groupingPager.setPage;
  // 切方案时回到第一页
  useEffect(() => {
    setGroupPage(1);
  }, [currentPlanId, setGroupPage]);

  const [dragId, setDragId] = useState<number | null>(null);
  const [preview, setPreview] = useState<{
    deltas: Record<string, number>;
    totalBefore: number;
    totalAfter: number;
  } | null>(null);
  // 实时得分（拖动后立刻刷新雷达与总分，规格书 P-09）
  const [liveScores, setLiveScores] = useState<{
    skill_cover: number;
    weak_tie: number;
    balance: number;
    history_avoid: number;
    total: number;
  } | null>(null);
  const [violations, setViolations] = useState<{ code: string; message: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);

  /**
   * 读屏播报区的内容（渲染成两个常驻 live region，见下方 sr-only 区块）。
   *
   * 移动成功/被拒绝只改变了 DOM（卡片挪位、违规条出现），屏幕阅读器听不到任何变化；
   * 违规 Callout 本身是条件渲染出来的新节点，不是「先存在再更新」的 live region，
   * 所以它出现时也不会被播报。这里把结果压成一句话送进常驻区域。
   * tone=alert 用于失败（assertive），tone=status 用于成功（polite）。
   * 带自增 id 是因为同一个文本节点重复写同一句话不会再次播报——
   * 换 key 才能让「连续两次同样的失败」都被听到。
   */
  const [announcement, setAnnouncement] = useState<{
    id: number;
    text: string;
    tone: 'status' | 'alert';
  } | null>(null);
  const announceSeq = useRef(0);
  function announce(text: string, tone: 'status' | 'alert' = 'status') {
    announceSeq.current += 1;
    setAnnouncement({ id: announceSeq.current, text, tone });
  }

  /**
   * 分组卡片的 DOM 引用，只为「移动成功后把焦点接住」这一件事存在。
   * 「移至此处」按钮在移动成功后会随选中态一起消失（canReceive = selected !== null），
   * 焦点若留在被移除的节点上，浏览器会把它丢回 <body>，键盘用户下一次 Tab
   * 直接从页面开头重新数一遍。所以成功时把焦点交到目标分组卡片上。
   */
  const groupRefs = useRef(new Map<number, HTMLDivElement | null>());

  /** 播报里用的成员称呼：有姓名用姓名，缺名单信息时退回用户编号。 */
  function memberLabelText(userId: number) {
    const m = memberMap.get(userId);
    return m?.name ?? `用户 ${userId}`;
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function selectPlan(planId: number) {
    setActivePlanId(planId);
    setLocal(null);
    setPreview(null);
    setLiveScores(null);
    setViolations([]);
    setSelected(null);
  }

  /**
   * 写请求一律走 apiSend：非 2xx 抛 ApiError，绝不把错误 JSON 当成功结果。
   * 以前这里是 `return res.json()` 不判 ok，于是 403/500 的 `{error}` 会被
   * 当成正常响应读取，`res.ok` 恒为 undefined，所有失败都被静默吞掉。
   */
  async function post<T>(path: string, body: unknown = {}): Promise<T> {
    return apiSend<T>(path, { body });
  }

  /** 当前面板展示的四维得分：优先实时值，否则回落到方案库内快照。 */
  const shownScores = useMemo(() => {
    if (liveScores) return liveScores;
    if (!currentPlan) return null;
    return {
      skill_cover: Number(currentPlan.scoreSkillCover),
      weak_tie: Number(currentPlan.scoreWeakTie),
      balance: Number(currentPlan.scoreBalance),
      history_avoid: Number(currentPlan.scoreHistoryAvoid),
      total: Number(currentPlan.totalScore)
    };
  }, [liveScores, currentPlan]);

  /**
   * 一次移动的完整流程：preview（服务端权威）→ 合法则 apply → 刷新主得分面板。
   * 返回值只表示「卡片是不是真的动过」，调用方据此决定要不要清掉选中态。
   *
   * 关键约定：右侧「四维得分」只在 apply 落库成功后才更新。
   * 之前 preview 一成功就把 liveScores 设成预演值，于是卡片还停在原处、
   * 面板已经显示移动后的分数——用户在「没有真正移动」的状态下看到了新分数。
   * 预演结果现在只用于「上次拖动的影响」那块对比（previewTotal），
   * 主面板保持落库后的真实值。
   */
  async function moveFlow(userId: number, fromGroup: number, toGroup: number): Promise<boolean> {
    if (!currentPlan || fromGroup === toGroup) return false;
    const who = memberLabelText(userId);
    const toLabel = `第 ${toGroup + 1} 组`;
    setBusy(true);
    setPreview(null);
    try {
      const previewRes = await post<{
        deltas?: Record<string, number>;
        totalBefore?: number;
        totalAfter?: number;
      }>(`/api/grouping/plans/${currentPlan.id}/preview-move`, { userId, fromGroup, toGroup });
      setViolations([]);
      setPreview({
        deltas: previewRes.deltas ?? {},
        totalBefore: previewRes.totalBefore ?? 0,
        totalAfter: previewRes.totalAfter ?? 0
      });
    } catch (e) {
      // 预演失败：有违规原因就展示原因；没有就说明服务异常，绝不能静默吞掉
      const previewViolations =
        isApiError(e) && e.violations.length > 0
          ? e.violations.map((v) => ({ code: v.code ?? 'PREVIEW', message: v.message ?? '' }))
          : [{ code: 'PREVIEW', message: describeApiError(e) }];
      setViolations(previewViolations);
      announce(
        `移动被拒绝：${who} 移到${toLabel}未生效。${previewViolations
          .map((v) => v.message)
          .filter(Boolean)
          .join('；')}`,
        'alert'
      );
      setBusy(false);
      return false;
    }

    try {
      const applyRes = await post<{ groups: number[][]; scores?: typeof liveScores }>(
        `/api/grouping/plans/${currentPlan.id}/apply-move`,
        { userId, fromGroup, toGroup }
      );
      setViolations([]);
      setLocal({ planId: currentPlan.id, value: applyRes.groups });
      // 落库成功才更新主面板——这是「分数与卡片同时变」的唯一时刻
      if (applyRes.scores) setLiveScores(applyRes.scores);
      announce(`已移动：${who} 从第 ${fromGroup + 1} 组移到${toLabel}。`);
      // apply-move 已把新的分组快照与四维得分写回 grouping_plans；
      // 必须重新拉取，否则三个方案 Tab 上仍是求解时的旧分数（看起来"方案分数不变"）。
      await mutate();
      return true;
    } catch (e) {
      // 预演通过但落库失败：分数与卡片都不动，并明确告知「未生效」
      const applyViolations =
        isApiError(e) && e.violations.length > 0
          ? e.violations.map((v) => ({ code: v.code ?? 'APPLY', message: v.message ?? '' }))
          : [{ code: 'APPLY', message: `${describeApiError(e)}（移动未落库）` }];
      setViolations(applyViolations);
      announce(
        `移动被拒绝：${who} 移到${toLabel}没有落库，分组未改变。${applyViolations
          .map((v) => v.message)
          .filter(Boolean)
          .join('；')}`,
        'alert'
      );
      setPreview(null);
      return false;
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
    const ok = await moveFlow(selected, fromGroup, toGroup);
    // 成功才收起选中态：失败时保留选中，键盘/读屏用户可以直接换一个目标组重试，
    // 不用回到成员身上再按一次空格。
    if (ok) {
      setSelected(null);
      // 按钮自己会随选中态一起消失，焦点必须显式交给目标分组卡片（见 groupRefs 注释）
      groupRefs.current.get(toGroup)?.focus();
    }
  }

  /**
   * 点选 / 取消选中一个成员，并把结果送进读屏播报区。
   *
   * aria-pressed 只能让读屏知道「这个按钮现在是按下的」，但整页有上百个 chip，
   * 用户点完之后并不知道「接下来该点哪里」。所以选中时播报一句带操作指引的话，
   * 取消时也明说取消了——否则点了两下的人无法判断自己是选中了还是取消了。
   * 纯前端状态，不发请求，不需要 busy。
   */
  function selectMember(userId: number | null) {
    setSelected(userId);
    if (userId === null) {
      announce('已取消选中。');
      return;
    }
    announce(
      `已选中 ${memberLabelText(userId)}。按 Tab 到目标组的「移至此处」按钮并回车完成移动，或再点它取消选中。`
    );
  }

  async function resetPlan() {
    if (!currentPlan) return;
    setBusy(true);
    try {
      const res = await post<{ scores?: typeof liveScores }>(
        `/api/grouping/plans/${currentPlan.id}/reset`
      );
      setLocal(null);
      setPreview(null);
      setLiveScores(res?.scores ?? null);
      setViolations([]);
      announce('已还原到求解器原始分组。');
      await mutate();
    } catch (e) {
      // 还原失败必须说话：以前无条件 setLocal(null) 会让界面看起来「已还原」，
      // 其实库里还是拖动后的快照，一刷新就退回去。
      const message = `${describeApiError(e)}（未还原）`;
      setViolations([{ code: 'RESET', message }]);
      announce(`还原失败：${message}`, 'alert');
    } finally {
      setBusy(false);
    }
  }

  /**
   * 解散分组：必须让教师选「解散哪一组」。
   *
   * 旧实现直接取 groupsData.groups[0]——教师点「解散分组」时，被解散的永远是
   * 列表第一组，与他想解散的那组无关。现在弹窗里逐组列出，默认不预选。
   */
  async function dissolve(groupId: number) {
    const target = activeGroups.find((g) => g.id === groupId);
    if (!target) return;
    setBusy(true);
    try {
      await apiSend(`/api/groups/${groupId}/dissolve`);
      setDissolveOpen(false);
      await mutateGroups();
      router.push(`/dashboard/courses/${courseId}`);
    } catch (e) {
      const message = describeApiError(e);
      setViolations([{ code: 'DISSOLVE', message }]);
      announce(`解散「${target.name}」失败：${message}`, 'alert');
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
      setLiveScores(null);
      setViolations([]);
      announce('已重新求解，三套候选方案已更新。');
      await mutate();
      await mutateGroups();
    } catch (e) {
      // 求解失败（含超时、名单不足）以前完全静默：按钮转一圈什么也没变。
      const message = describeApiError(e);
      setViolations([{ code: 'RERUN', message }]);
      announce(`求解失败：${message}`, 'alert');
    } finally {
      setBusy(false);
    }
  }

  async function selectCurrent() {
    if (!currentPlan) return;
    setBusy(true);
    try {
      await post(`/api/grouping/plans/${currentPlan.id}/select`);
      router.push(`/dashboard/courses/${courseId}?grouped=1`);
    } catch (e) {
      const message = describeApiError(e);
      setViolations([{ code: 'SELECT', message }]);
      announce(`选定「${currentPlan.label}」失败：${message}`, 'alert');
      setBusy(false);
    }
  }

  const crumbs = [
    { label: '课程工作台', href: '/dashboard' },
    { label: '课程', href: `/dashboard/courses/${courseId}` },
    { label: '分组工作台' }
  ];

  // 两个请求都要等到：groups 提供成员姓名/学号/班级，latest 提供方案与候选分组。
  // 只等 latest 会让卡片先用 `#690` 这类占位 id 渲染一遍，等 groups 回来再换成
  // 「压测学生39 · B0287b87a039」——每个 chip 从一行变成带学号的宽度，卡片高度
  // 124px→316px，下方整块内容被顶下去 192px（实测 CLS 0.1443，超 0.1 良好线）。
  // 所以这里沿用同一套骨架屏，等成员信息齐了再一次性画出成品。
  if (isLoading || groupsLoading) {
    return (
      <PageShell
        title="分组工作台"
        breadcrumbs={crumbs}
        description="正在读取最近的求解结果…"
        width="wide"
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Skeleton className="h-96" />
          <Skeleton className="h-72" />
        </div>
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell title="分组工作台" breadcrumbs={crumbs} width="wide">
        <QueryError error={error} onRetry={() => void mutate()} title="加载分组方案失败" />
      </PageShell>
    );
  }

  if (groupsError) {
    return (
      <PageShell title="分组工作台" breadcrumbs={crumbs} width="wide">
        <QueryError
          error={groupsError}
          onRetry={() => void mutateGroups()}
          title="加载分组成员失败"
        />
      </PageShell>
    );
  }

  if (!data || !groupsData) {
    return (
      <PageShell title="分组工作台" breadcrumbs={crumbs} width="wide">
        <Skeleton className="h-96 w-full" />
      </PageShell>
    );
  }

  if (!data.run || plans.length === 0) {
    return (
      <PageShell
        title="分组工作台"
        breadcrumbs={crumbs}
        description="名单与技能卡齐备后，求解器会给出三套候选方案。"
        width="wide"
      >
        <Panel>
          <EmptyState
            className="py-8"
            icon={Users}
            title="还没有生成过分组方案"
            hint="确保名单已导入且学生已填技能卡，然后点击「生成分组方案」。"
            action={
              <Button disabled={busy} onClick={rerun}>
                <Shuffle className="mr-1 h-4 w-4" />
                {busy ? '求解中…' : '生成分组方案'}
              </Button>
            }
          />
        </Panel>
      </PageShell>
    );
  }

  const isTeacherSide =
    courseData?.myRole === 'teacher' || courseData?.myRole === 'assistant';
  const shownTotal = (shownScores?.total ?? 0).toFixed(1);
  /** 当前被点选的成员名；按钮和提示里都要点名，避免「移至此处」指向不明。 */
  const selectedLabel = selected === null ? null : memberLabelText(selected);
  // 增减量必须由页面真正显示的那两个一位小数算出来：algo 返回的是两位小数，
  // 直接展示会出现「96.7 → 95.5  -1.19」这种前后对不上的观感（被当成算错）。
  const previewTotal = preview
    ? {
        before: Number(preview.totalBefore.toFixed(1)),
        after: Number(preview.totalAfter.toFixed(1))
      }
    : null;
  const previewTotalDelta = previewTotal
    ? Number((previewTotal.after - previewTotal.before).toFixed(1))
    : 0;

  return (
    <PageShell
      title="分组工作台"
      breadcrumbs={crumbs}
      description={
        currentPlan
          ? `当前「${currentPlan.label}」综合得分 ${shownTotal}；拖成员微调，违规动作当场拦下。`
          : '选一套候选方案，拖成员微调后再选定。'
      }
      width="wide"
      actions={
        <>
          <Button variant="outline" size="sm" disabled={busy} onClick={rerun}>
            <Shuffle className="mr-1 h-4 w-4" />
            重新求解
          </Button>
          <Button disabled={busy} onClick={selectCurrent}>
            选定此方案
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/*
          常驻的读屏播报区（不是条件渲染）。屏幕阅读器只监听「已存在且内容变化」的
          live region；条件渲染出来的违规 Callout 是新节点，不会被读出来。
          成功走 polite（aria-live=status），失败走 assertive（role=alert）。
          两条都常驻，只是内容不同，所以任一类结果都能被播报。
        */}
        <div className="sr-only" aria-live="polite" aria-atomic="true" data-testid="grouping-status-live">
          {announcement?.tone === 'status' ? <span key={announcement.id}>{announcement.text}</span> : null}
        </div>
        <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">
          {announcement?.tone === 'alert' ? <span key={announcement.id}>{announcement.text}</span> : null}
        </div>

        {data.run.degraded && (
          <Callout tone="warn" title="本次为快速模式">
            求解器超时回退贪心，结果未达最优，可重新求解。
          </Callout>
        )}

        {currentPlan && synthesizedPlanIds.has(currentPlan.id) && (
          <Callout tone="warn" title={`「${currentPlan.label}」是占位方案，不是求解结果`}>
            这套分组由已落库的小组倒推回填，不是求解器优化出来的；下面的分数是按当前名单、
            技能卡与约束重新算过的真实得分（不是伪造值），但没有做组合优化，所以通常低于
            重新求解的结果。可以拖动预览看看效果，但不要把它当成「算法给出的推荐」。
            点「重新求解」会得到真实的三套候选方案。
          </Callout>
        )}

        {violations.length > 0 && (
          <Callout tone="danger" title="硬约束违规（已拒绝）">
            <ul className="space-y-1">
              {violations.map((v, i) => (
                <li key={i}>
                  [{v.code}] {v.message}
                </li>
              ))}
            </ul>
          </Callout>
        )}

        <Tabs value={String(currentPlanId ?? '')} onValueChange={(v) => selectPlan(Number(v))}>
          {/* 三个方案带分数，手机上排不满一行：让标签条自己横向滚动，别把整页顶宽 */}
          <TabsList className="max-w-full justify-start overflow-x-auto">
            {plans.map((p) => (
              <TabsTrigger key={p.id} value={String(p.id)} className="shrink-0">
                {p.label}
                {synthesizedPlanIds.has(p.id) && (
                  // text-xs 而不是 text-[10px]：「占位」是必须被看见的警示标签，
                  // 10px 在手机上基本读不出来
                  <span className="ml-1.5 rounded-sm bg-warning/15 px-1 text-xs font-medium text-warning">
                    占位
                  </span>
                )}
                <span className="ml-2 tabular-nums text-muted-foreground">
                  {Number(p.totalScore).toFixed(1)}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>

          {plans.map((plan) => (
            <TabsContent key={plan.id} value={String(plan.id)}>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                {/* 左：小组分配（拖拽区） */}
                <Panel
                  title={`小组分配（${shownGroups.length} 组）`}
                  hint={
                    selected !== null
                      ? `已选中 ${selectedLabel}：点目标组的「移至此处」完成移动，或再点它取消选中`
                      : '把成员拖到另一组；也可以点选成员后点目标组的「移至此处」'
                  }
                  actions={
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={resetPlan}
                        title="还原到求解器原始结果"
                      >
                        <RotateCcw className="mr-1 h-4 w-4" />
                        还原
                      </Button>
                      {isTeacherSide && activeGroups.length > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive"
                          disabled={busy}
                          onClick={() => {
                            setDissolveId(null);
                            setDissolveOpen(true);
                          }}
                        >
                          <Trash2 className="mr-1 h-4 w-4" />
                          解散分组
                        </Button>
                      )}
                    </div>
                  }
                >
                  <DndContext
                    sensors={sensors}
                    accessibility={{
                      // dnd-kit 默认的说明与播报全是英文，中文界面里读屏会突然切成英文。
                      // 这里只注册了 PointerSensor（没有 KeyboardSensor），所以说明必须指向
                      // 真正可用的键盘路径「回车选中 → 目标组『移至此处』」，不能照抄
                      // 上游那句「按空格拿起、方向键移动」——那套键盘拖拽在本页并不存在。
                      screenReaderInstructions: {
                        draggable:
                          '成员标签。鼠标可直接拖动；键盘操作请按回车选中该成员，再按目标组的「移至此处」按钮。'
                      },
                      announcements: {
                        onDragStart: ({ active }) =>
                          `已拿起 ${memberLabelText(Number(active.id))}。`,
                        onDragOver: ({ active, over }) =>
                          over
                            ? `${memberLabelText(Number(active.id))} 位于第 ${Number(over.id) + 1} 组上方。`
                            : `${memberLabelText(Number(active.id))} 不在任何组上方。`,
                        onDragEnd: ({ active, over }) =>
                          over
                            ? `${memberLabelText(Number(active.id))} 放到第 ${Number(over.id) + 1} 组。`
                            : `${memberLabelText(Number(active.id))} 已放下，未改变分组。`,
                        onDragCancel: ({ active }) =>
                          `已取消移动 ${memberLabelText(Number(active.id))}。`
                      }
                    }}
                    onDragStart={(e: DragStartEvent) => setDragId(Number(e.active.id))}
                    onDragEnd={onDragEnd}
                    onDragCancel={() => setDragId(null)}
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      {shownGroups.length === 0 ? (
                        <EmptyState
                          className="col-span-full"
                          icon={Users}
                          title="暂无分组预览"
                          hint="确认名单后点「重新求解」生成方案。"
                        />
                      ) : (
                        groupingPager.pageItems.map((g, i) => {
                          // 全局组序号（跨页保持「第 N 组」与拖拽目标 id 一致）
                          const gi = groupingPager.start + i;
                          return (
                            <GroupTile
                              key={gi}
                              index={gi}
                              members={g}
                              memberMap={memberMap}
                              violations={violations}
                              canReceive={selected !== null}
                              receiveLabel={selectedLabel}
                              busy={busy}
                              onReceive={() => moveSelectedTo(gi)}
                              selected={selected}
                              onSelectMember={selectMember}
                              registerRef={(el) => {
                                // 用 Map 而不是数组：分组会随分页/移动增删，序号不能当索引
                                if (el) groupRefs.current.set(gi, el);
                                else groupRefs.current.delete(gi);
                              }}
                            />
                          );
                        })
                      )}
                    </div>
                    <DragOverlay>
                      {dragId !== null && (
                        <MemberChipGhost userId={dragId} member={memberMap.get(dragId)} />
                      )}
                    </DragOverlay>
                  </DndContext>

                  <Pager {...groupingPager.pagerProps} unit="组" />
                </Panel>

                {/* 右：得分面板 */}
                <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
                  <Panel
                    title="四维得分"
                    hint="拖动后即时刷新"
                    actions={
                      liveScores ? <Badge variant="secondary">实时</Badge> : undefined
                    }
                  >
                    <div className="h-52">
                      <ResponsiveContainer>
                        <RadarChart
                          data={DIMS.map((d) => ({
                            dim: d.label,
                            score: shownScores ? shownScores[d.key] : 0
                          }))}
                        >
                          <PolarGrid />
                          {/* 刻度字号统一 12px：10px 在 375px 手机上低于可读下限
                              （移动端巡检把 tspan 10px 记为「字号过小」） */}
                          <PolarAngleAxis dataKey="dim" tick={{ fontSize: 12 }} />
                          <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                          {/* 颜色不在组件里写死：.recharts-radar-polygon 在 globals.css 里
                              取 var(--brand)，深色主题会跟着换成提亮的那支橙。 */}
                          <Radar dataKey="score" />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="mt-2 text-center text-sm text-muted-foreground">
                      综合得分{' '}
                      <span className="text-lg font-semibold text-foreground tabular-nums">
                        {(shownScores?.total ?? 0).toFixed(1)}
                      </span>
                    </p>
                  </Panel>

                  {preview && (
                    <Panel title="上次拖动的影响">
                      <dl className="space-y-1 text-sm">
                        {DIMS.map((d) => {
                          const delta = preview.deltas[d.key];
                          if (delta === undefined) return null;
                          return (
                            <div key={d.key} className="flex justify-between">
                              <dt>{d.label}</dt>
                              <dd className={deltaClass(delta)}>{signedDelta(delta)}</dd>
                            </div>
                          );
                        })}
                        <div className="flex items-baseline justify-between border-t pt-1 font-medium">
                          <dt>总分</dt>
                          <dd className="flex items-baseline gap-2 tabular-nums">
                            <span>
                              {previewTotal?.before.toFixed(1)} → {previewTotal?.after.toFixed(1)}
                            </span>
                            <span className={deltaClass(previewTotalDelta)}>
                              {signedDelta(previewTotalDelta)}
                            </span>
                          </dd>
                        </div>
                      </dl>
                    </Panel>
                  )}

                  <p className="text-xs text-muted-foreground">
                    {selected !== null ? (
                      <>
                        已选中 <span className="font-medium text-foreground">{selectedLabel}</span>
                        ：点目标组的「移至此处」完成移动，
                        <button
                          type="button"
                          className="rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-hidden"
                          onClick={() => selectMember(null)}
                        >
                          取消选中
                        </button>
                        。
                      </>
                    ) : (
                      '键盘替代路径：Tab 到成员后按回车/空格选中，再 Tab 到目标组的「移至此处」按回车。'
                    )}
                  </p>
                </div>
              </div>
            </TabsContent>
          ))}
        </Tabs>

        {/* 解散必须指名道姓：让教师挑具体一组，而不是默认拿第一组去解散 */}
        <Dialog open={dissolveOpen} onOpenChange={setDissolveOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>解散分组</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                解散后该组成员回池，小组任务与交付物归档。此操作不可撤销。
              </p>
              <Select
                value={dissolveId === null ? '' : String(dissolveId)}
                onValueChange={(v) => setDissolveId(Number(v))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择要解散的小组" />
                </SelectTrigger>
                <SelectContent>
                  {activeGroups.map((g) => (
                    <SelectItem key={g.id} value={String(g.id)}>
                      {g.name}（{g.members.length} 人）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDissolveOpen(false)}>
                取消
              </Button>
              <Button
                variant="destructive"
                disabled={busy || dissolveId === null}
                onClick={() => dissolveId !== null && void dissolve(dissolveId)}
              >
                确认解散
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </PageShell>
  );
}

/** 拖拽影响的行内着色：正绿负红，0 或缺失为弱化灰。 */
function deltaClass(delta: number | undefined) {
  if (delta === undefined || delta === 0) return 'tabular-nums text-muted-foreground';
  return delta > 0
    ? 'tabular-nums text-success'
    : 'tabular-nums text-danger';
}

function signedDelta(delta: number | undefined) {
  if (delta === undefined) return '—';
  return `${delta > 0 ? '+' : ''}${delta.toFixed(1)}`;
}

function GroupTile({
  index,
  members,
  memberMap,
  violations,
  canReceive,
  receiveLabel,
  busy,
  onReceive,
  selected,
  onSelectMember,
  registerRef
}: {
  index: number;
  members: number[];
  memberMap: Map<number, Member>;
  violations: { code: string; message: string }[];
  canReceive: boolean;
  /** 待移动成员的名字，用于把「移至此处」按钮说清楚移的是谁 */
  receiveLabel: string | null;
  busy: boolean;
  onReceive: () => void;
  selected: number | null;
  onSelectMember: (id: number | null) => void;
  /** 把卡片节点交给父级，移动成功后父级把焦点落到这里 */
  registerRef?: (el: HTMLDivElement | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: index });
  // 只标红违规消息中提及本组的卡片（消息格式：「第 N 组…」）
  const groupNo = `第 ${index + 1} 组`;
  const myViolations = violations.filter((v) => v.message.includes(groupNo));
  // 班级构成汇总（如「数媒本24-1 ×3、数媒本24-2 ×1」）
  const classCount = new Map<string, number>();
  for (const uid of members) {
    const cn = memberMap.get(uid)?.className ?? '未分班';
    classCount.set(cn, (classCount.get(cn) ?? 0) + 1);
  }
  const classSummary = [...classCount.entries()]
    .map(([cn, n]) => `${cn}×${n}`)
    .join('、');

  return (
    <div
      ref={(el) => {
        // 一个节点要同时喂给 dnd-kit 的落点判定和父级的焦点接管，两个 ref 串联
        setNodeRef(el);
        registerRef?.(el);
      }}
      // 违规标红不能只靠颜色：同时写进读屏可读的分组名，色盲/读屏都能知道哪组出了问题
      aria-label={
        myViolations.length > 0
          ? `${groupNo}，${members.length} 人，存在硬约束违规`
          : `${groupNo}，${members.length} 人`
      }
      role="group"
      // tabIndex=-1 只为「被程序聚焦」服务（移动成功后焦点落点），
      // 不加进 Tab 序列——一页几十组，逐组停一遍是负担。
      tabIndex={-1}
      className={
        'rounded-md border bg-background px-3 py-2.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-hidden ' +
        (myViolations.length > 0
          ? 'border-destructive ring-1 ring-destructive/30 '
          : isOver
            ? 'border-primary ring-1 ring-primary/30 '
            : '')
      }
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-1">
        <div className="min-w-0">
          <p className="text-sm font-medium">{groupNo}</p>
          <p className="truncate text-xs text-muted-foreground">{classSummary || '暂无成员'}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{members.length} 人</Badge>
          {canReceive && (
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              disabled={busy}
              onClick={onReceive}
              // 只写「移至此处」，读屏听到的是一排同名按钮，分不清哪组是哪组
              aria-label={
                receiveLabel
                  ? `把 ${receiveLabel} 移到第 ${index + 1} 组`
                  : `移到第 ${index + 1} 组`
              }
            >
              移至此处
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {members.map((uid) => (
          <MemberChip
            key={uid}
            userId={uid}
            member={memberMap.get(uid)}
            selected={selected === uid}
            onSelect={() => onSelectMember(selected === uid ? null : uid)}
          />
        ))}
      </div>
    </div>
  );
}

function chipLabel(userId: number, member: Member | undefined) {
  const label = member
    ? `${member.name ?? `#${member.userId}`}${member.studentNo ? ` · ${member.studentNo}` : ''}`
    : `#${userId}`;
  const title = member ? `${member.name ?? ''} ${member.studentNo ?? ''}`.trim() : `用户 ${userId}`;
  return { label, title };
}

function chipClass({ dragging = false, selected = false, ghost = false }) {
  return (
    // focus-visible:ring 必须写在这里：globals.css 的键盘兜底只覆盖 a/select/summary，
    // 成员 chip 是 <button> 且不走 shadcn Button，没有它 Tab 过去完全看不出焦点在哪。
    'rounded-full border px-3 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-hidden ' +
    (ghost
      ? 'cursor-grabbing border-primary bg-background shadow-lg '
      : dragging
        ? 'cursor-grabbing opacity-50 '
        : 'cursor-grab hover:bg-accent ') +
    (selected ? 'border-primary bg-primary/10 font-medium ' : '')
  );
}

function MemberChip({
  userId,
  member,
  selected = false,
  onSelect
}: {
  userId: number;
  member: Member | undefined;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: userId });
  // 名单信息缺失时仍渲染占位，避免整块预览被 return null 清空
  const { label, title } = chipLabel(userId, member);
  const who = member?.name ?? `用户 ${userId}`;
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      type="button"
      onClick={onSelect}
      // 选中态必须对读屏可见：只有一个背景色变化，屏幕阅读器完全感知不到
      // 「我已经点过一个成员了」。aria-pressed 是 toggle 按钮的标准语义；
      // 合并 dnd-kit 自带的「拖动中」pressed 值，别把它的语义覆盖掉。
      aria-pressed={selected || isDragging}
      // 文案要短：一页 24 组、上百个 chip，每个都念一长句会淹没成员姓名。
      // 未选中时直接用按钮文字作为可访问名（姓名 · 学号）。
      aria-label={selected ? `${who}，已选中，再按一次取消选中` : undefined}
      className={chipClass({ dragging: isDragging, selected })}
      title={title}
    >
      {label}
    </button>
  );
}

/**
 * 拖拽浮层里只做「影子」，不能再调 useDraggable：
 * 浮层与原 chip 用同一个 id 注册会把原注册顶掉，落点判定随之失效（拖动看起来毫无反应）。
 */
function MemberChipGhost({ userId, member }: { userId: number; member: Member | undefined }) {
  const { label } = chipLabel(userId, member);
  return <div className={chipClass({ ghost: true })}>{label}</div>;
}

/** 页面级角色闸门：非教师/助教直链访问时给出明确说明。 */
export default function GroupingWorkbenchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <TeacherGate courseId={id} title="分组工作台">
      <GroupingWorkbenchBody params={params} />
    </TeacherGate>
  );
}
