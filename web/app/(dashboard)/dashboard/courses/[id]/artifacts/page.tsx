'use client';

import useSWR from 'swr';
import { use, useMemo, useState } from 'react';
import { AlignLeft, FilePlus2, FileText, Save, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Callout, PageShell, Panel } from '@/components/page-shell';
import { EmptyState } from '@/components/empty-state';
import { Pager, usePagination } from '@/components/ui/pager';
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

/**
 * 统一取数：非 2xx 一律抛错，交给 SWR 的 error 分支。
 * 旧的 `fetch(url).then(r => r.json())` 会把 403 的 `{ error: '不属于该小组' }`
 * 当成正常数据，于是「没有权限」被渲染成「还没有交付物」。
 */
const fetcher = async (url: string) => {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (body as { error?: string } | null)?.error;
    throw new Error(message ?? `请求失败（HTTP ${res.status}）`);
  }
  return body;
};

const KIND_LABEL: Record<string, string> = {
  heading: '标题',
  paragraph: '段落',
  figure: '图表',
  table: '表格',
  code: '代码',
  formula: '公式'
};

/** 交付物状态文案：列表里原来直接印英文 draft/submitted，与全站中文不一致 */
const ARTIFACT_STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  review: '待修改',
  submitted: '已提交',
  approved: '已通过',
  rejected: '已退回'
};

type Segment = { seq: number; kind: string; content: string };

type Group = {
  id: number;
  name: string;
  members?: { userId: number; name: string | null }[];
};

/**
 * 页内提示：成功 / 失败分两种 tone。
 * 审计 #49：原来失败也走 `text-green-700`，红色警报被渲染成绿色成功。
 */
type Notice = { tone: 'ok' | 'error'; text: string };

/** 交付物编辑器（规格书 M-05）：分段在线撰写，保存时服务端 diff 记录归属。 */
export default function ArtifactsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: groupsData, isLoading: groupsLoading } = useSWR<{ groups: Group[] }>(
    `/api/courses/${id}/groups`,
    fetcher
  );
  // 当前用户取 /api/user：它在 app/layout.tsx 里已由服务端预取进 SWR fallback，
  // 首帧就有 id，不会像现取的接口那样先按「查不到所在组」渲染出组选择器再跳回来。
  const { data: me, error: meError } = useSWR<{ id: number } | null>('/api/user', fetcher);
  // 课程角色：区分「教师/助教可切换小组」与「学生只能停在自己的组」
  const { data: courseData, error: courseError } = useSWR<{ myRole?: string }>(
    `/api/courses/${id}`,
    fetcher
  );
  const myRole = courseData?.myRole ?? '';
  const isTeacherSide = myRole === 'teacher' || myRole === 'assistant';

  const allGroups = groupsData?.groups ?? [];
  const myUserId = me?.id ?? null;

  const [pickedGroupId, setPickedGroupId] = useState<number | null>(null);

  /**
   * 审计 #17：原来固定 `groups[0]`（listGroups 按小组 id 升序 = 建组顺序），
   * 非最小组的成员看到的是别人的组：列表因 403 变空，新建的交付物还会落到别人组里。
   * 现在按成员身份定位自己的组；教师/助教才给切换入口，默认第一组。
   */
  const myGroup = allGroups.find(
    (g) => myUserId !== null && (g.members ?? []).some((m) => m.userId === myUserId)
  );
  const pickedGroup = allGroups.find((g) => g.id === pickedGroupId);
  const group = myGroup ?? (isTeacherSide ? (pickedGroup ?? allGroups[0]) : undefined);

  const { data: artifactsData, error, isLoading, mutate } = useSWR<{ artifacts: any[] }>(
    group ? `/api/groups/${group.id}/artifacts` : null,
    fetcher
  );

  const [openId, setOpenId] = useState<number | null>(null);
  const { data: detail, error: detailError, mutate: mutateDetail } = useSWR(
    openId ? `/api/artifacts/${openId}` : null,
    fetcher
  );

  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<Notice | null>(null);
  const [newTitle, setNewTitle] = useState('');
  // 新建失败要留在弹窗里显示：弹窗盖住了页面内的提示条
  const [createError, setCreateError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  // 交付物左栏一学期会累积到几十个，10 个一页；放在条件 return 之前以固定 hook 顺序
  const artifacts = artifactsData?.artifacts ?? [];
  const artifactPager = usePagination(artifacts, 10);

  const authorStats = detail?.authorStats;
  const totalWords = authorStats?.totalWords ?? 0;

  // byAuthor 过 JSON 后是普通对象（服务端已把 Map 转成 Record），两种形态都兼容
  const authorRows = useMemo(() => {
    const raw = authorStats?.byAuthor as
      | Map<number, number>
      | Record<string, number>
      | undefined;
    if (!raw) return [] as [number, number][];
    if (raw instanceof Map) return [...raw.entries()].sort((a, b) => b[1] - a[1]);
    return Object.entries(raw)
      .map(([k, v]) => [Number(k), Number(v)] as [number, number])
      .sort((a, b) => b[1] - a[1]);
  }, [authorStats]);

  const memberName = useMemo(() => {
    const m = new Map<number, string | null>();
    for (const g of allGroups) {
      for (const e of g.members ?? []) m.set(e.userId, e.name);
    }
    return m;
  }, [allGroups]);

  // 打开编辑器时用当前版本段落初始化
  const currentSegments = useMemo(() => {
    if (segments) return segments;
    if (detail?.segments) {
      return detail.segments.map((s: any) => ({ seq: s.seq, kind: s.kind, content: s.content }));
    }
    return [];
  }, [segments, detail]);

  function updateSegment(seq: number, patch: Partial<Segment>) {
    setSegments(
      currentSegments.map((s: Segment) => (s.seq === seq ? { ...s, ...patch } : s))
    );
  }

  function addSegment() {
    const maxSeq = currentSegments.reduce((m: number, s: Segment) => Math.max(m, s.seq), -1);
    setSegments([...currentSegments, { seq: maxSeq + 1, kind: 'paragraph', content: '' }]);
  }

  function removeSegment(seq: number) {
    setSegments(currentSegments.filter((s: Segment) => s.seq !== seq));
  }

  async function save() {
    if (!openId) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/artifacts/${openId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segments: currentSegments })
      });
      const body = await res.json().catch(() => null);
      if (res.ok) {
        setMsg({ tone: 'ok', text: `已保存 v${body?.versionNo}：${body?.diffSummary}` });
        setSegments(null);
        // 详情缓存也要刷：只刷列表的话编辑器会退回上一版正文
        await Promise.all([mutate(), mutateDetail()]);
      } else {
        setMsg({ tone: 'error', text: body?.error ?? `保存失败（HTTP ${res.status}）` });
      }
    } catch {
      setMsg({ tone: 'error', text: '保存失败，请检查网络后重试。' });
    } finally {
      setSaving(false);
    }
  }

  async function createArtifact() {
    const title = newTitle.trim();
    if (!group || !title) return;
    setCreating(true);
    setCreateError('');
    try {
      const res = await fetch(`/api/groups/${group.id}/artifacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title })
      });
      const body = await res.json().catch(() => null);
      if (res.ok) {
        setNewTitle('');
        setCreateOpen(false);
        setMsg({ tone: 'ok', text: `已创建「${title}」，从左栏打开即可开始撰写。` });
        await mutate();
      } else {
        // 审计 #50：原来只有 if (res.ok)，失败连一句提示都没有
        setCreateError(body?.error ?? `创建失败（HTTP ${res.status}）`);
      }
    } catch {
      setCreateError('创建失败，请检查网络后重试。');
    } finally {
      // 成败都要复位，否则按钮会一直卡在「创建中…」
      setCreating(false);
    }
  }

  async function submitFinal() {
    if (!openId || submitting) return;
    setSubmitting(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/artifacts/${openId}/submit`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        // 审计 #24：原来不看响应，403/409 也照样报「已提交终稿，归属冻结」
        setMsg({ tone: 'error', text: body?.error ?? `提交失败（HTTP ${res.status}）` });
        return;
      }
      setMsg({ tone: 'ok', text: '已提交终稿，段落归属冻结。' });
      await Promise.all([mutate(), mutateDetail()]);
    } catch {
      setMsg({ tone: 'error', text: '提交失败，请检查网络后重试。' });
    } finally {
      setSubmitting(false);
    }
  }

  async function compile() {
    if (!group || compiling) return;
    setCompiling(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/groups/${group.id}/compile`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (res.ok) {
        setMsg({ tone: 'ok', text: '已汇编生成小组终稿。' });
        await mutate();
      } else {
        setMsg({ tone: 'error', text: body?.error ?? `汇编失败（HTTP ${res.status}）` });
      }
    } catch {
      setMsg({ tone: 'error', text: '汇编失败，请检查网络后重试。' });
    } finally {
      setCompiling(false);
    }
  }

  const crumbs = [
    { label: '课程工作台', href: '/dashboard' },
    { label: '课程', href: `/dashboard/courses/${id}` },
    { label: '交付物与溯源' }
  ];

  // 教师/助教没有「自己的组」，给出组切换；学生锁定本组，不提供跨组入口
  const groupSwitcher =
    isTeacherSide && allGroups.length > 1 ? (
      <Select
        value={group ? String(group.id) : undefined}
        onValueChange={(v) => {
          setPickedGroupId(Number(v));
          // 换组后旧的交付物与编辑器内容都不再适用
          setOpenId(null);
          setSegments(null);
          setMsg(null);
        }}
      >
        <SelectTrigger className="h-8 w-40 text-xs">
          <SelectValue placeholder="选择小组" />
        </SelectTrigger>
        <SelectContent>
          {allGroups.map((g) => (
            <SelectItem key={g.id} value={String(g.id)}>
              {g.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : null;

  // 自己的组还没确定之前先别下结论，否则会闪一下教师才有的组选择器。
  // /api/user 的 fallback 是服务端预取的 Promise，解析出来之前 me 还不是对象。
  const meLoading = !(me && typeof me.id === 'number') && !meError;
  // 角色没回来之前不能判定「能否切组」，否则学生会闪一下组选择器
  const roleLoading = !courseData && !courseError;

  if (groupsLoading || isLoading || meLoading || roleLoading) {
    return (
      <PageShell title="交付物与溯源" breadcrumbs={crumbs} width="wide">
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell title="交付物与溯源" breadcrumbs={crumbs} width="wide">
        <Callout tone="danger" title="加载交付物失败">
          {error instanceof Error ? error.message : '请刷新重试。'}
        </Callout>
      </PageShell>
    );
  }

  // 没有分组时下面会取 group.name，也免得「新建交付物」变成点不动的静默按钮
  if (!group) {
    return (
      <PageShell title="交付物与溯源" breadcrumbs={crumbs} width="wide">
        {isTeacherSide ? (
          <Callout tone="warn">本课程还没有分组，需要先完成分组才能撰写交付物。</Callout>
        ) : (
          // 学生不在任何小组：绝不回落到别组的交付物（审计 #17）
          <Callout tone="warn">你还没有被分到小组，请联系教师。</Callout>
        )}
      </PageShell>
    );
  }

  return (
    <PageShell
      title="交付物与溯源"
      breadcrumbs={crumbs}
      description="分段撰写，保存时服务端按 diff 记录每段归属；提交终稿后归属冻结。"
      width="wide"
      actions={
        <>
          {groupSwitcher}
          <Button variant="outline" size="sm" disabled={compiling} onClick={compile}>
            {compiling ? '汇编中…' : '汇编终稿'}
          </Button>
          <NewArtifactButton
            open={createOpen}
            onOpenChange={(v) => {
              setCreateOpen(v);
              if (!v) setCreateError('');
            }}
            onCreate={createArtifact}
            title={newTitle}
            setTitle={(v) => {
              setNewTitle(v);
              setCreateError('');
            }}
            creating={creating}
            error={createError}
          />
        </>
      }
    >
      {/* 提示条放在页级：新建/汇编时编辑器可能还没打开，塞进编辑器里就等于没提示 */}
      {msg && (
        <p
          role={msg.tone === 'ok' ? undefined : 'alert'}
          className={`mb-3 text-sm ${
            // 深色模式下 rose-700 / green-700 对比度只有 3~4:1（AA 小字要 4.5:1），必须给暗色变体
            msg.tone === 'ok' ? 'text-success' : 'text-danger'
          }`}
        >
          {msg.text}
        </p>
      )}
      <div className="grid items-start gap-4 lg:grid-cols-[260px_1fr]">
        {/* 交付物列表 */}
        <Panel
          title="交付物"
          hint={`正在查看：${group.name}${artifacts.length > 0 ? ` · 共 ${artifacts.length} 个` : ''}`}
          bodyClassName="p-0"
        >
          {artifacts.length === 0 ? (
            <EmptyState
              className="mx-4 my-4"
              icon={FileText}
              title="还没有交付物"
              hint="用右上角「新建交付物」开始撰写。"
            />
          ) : (
            <ul className="divide-y">
              {artifactPager.pageItems.map((a: any) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenId(a.id);
                      setSegments(null);
                      setMsg(null);
                    }}
                    className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/50 ${
                      openId === a.id ? 'bg-muted/60 font-medium' : ''
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{a.title}</span>
                    {a.isFinalDeliverable && <Badge variant="default">终稿</Badge>}
                    <Badge variant="outline">{ARTIFACT_STATUS_LABEL[a.status] ?? a.status}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Pager {...artifactPager.pagerProps} unit="个" className="flex-col items-stretch gap-1 px-3 pb-3" />
        </Panel>

        {/* 编辑器 */}
        <Panel
          title={openId ? `编辑器 · 第 ${currentSegments.length} 段` : '编辑器'}
          hint={openId ? '段落归属自动记录，无需自报' : undefined}
          actions={
            openId ? (
              <>
                <Button size="sm" variant="ghost" onClick={addSegment}>
                  <FilePlus2 className="mr-1 h-4 w-4" />
                  添加段
                </Button>
                <Button size="sm" disabled={saving} onClick={save}>
                  <Save className="mr-1 h-4 w-4" />
                  {saving ? '保存中…' : '保存版本'}
                </Button>
                <Button size="sm" variant="outline" disabled={submitting} onClick={submitFinal}>
                  <Send className="mr-1 h-4 w-4" />
                  {submitting ? '提交中…' : '提交终稿'}
                </Button>
              </>
            ) : null
          }
        >
          {!openId ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              从左栏选一个交付物开始编辑，或先新建一个。
            </p>
          ) : (
            <div className="space-y-3">
              {totalWords > 0 && (
                <div className="rounded bg-muted/50 p-2 text-xs text-muted-foreground">
                  当前版本共 {totalWords} 字；各成员主责占比：
                  {authorRows.map(([uid, n]) => (
                    <span key={uid} className="ml-2">
                      {memberName.get(uid) ?? `成员 #${uid}`}{' '}
                      <span className="tabular-nums">{((n / totalWords) * 100).toFixed(0)}%</span>
                    </span>
                  ))}
                </div>
              )}
              {detailError && (
                <p role="alert" className="text-sm text-danger">
                  段落加载失败，请刷新后重试；在此之前不要保存，以免覆盖已有版本。
                </p>
              )}
              {!detailError && currentSegments.length === 0 && (
                <EmptyState compact icon={AlignLeft} title="这个交付物还没有段落，点「添加段」开始写。" />
              )}
              {currentSegments.map((s: Segment) => (
                <div key={s.seq} className="rounded border p-2">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">#{s.seq}</span>
                    <Select value={s.kind} onValueChange={(v) => updateSegment(s.seq, { kind: v })}>
                      <SelectTrigger className="h-7 w-24 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(KIND_LABEL).map(([k, label]) => (
                          <SelectItem key={k} value={k}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto h-7 text-destructive"
                      onClick={() => removeSegment(s.seq)}
                    >
                      删除
                    </Button>
                  </div>
                  <Textarea
                    rows={3}
                    value={s.content}
                    onChange={(e) => updateSegment(s.seq, { content: e.target.value })}
                  />
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </PageShell>
  );
}

function NewArtifactButton({
  open,
  onOpenChange,
  onCreate,
  title,
  setTitle,
  creating,
  error
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreate: () => void;
  title: string;
  setTitle: (v: string) => void;
  creating: boolean;
  error: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <FilePlus2 className="mr-1 h-4 w-4" />
          新建交付物
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>新建交付物</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <input
            className="w-full rounded border px-3 py-2 text-sm"
            placeholder="标题，如：调研报告 / 数据分析脚本"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end">
            <Button size="sm" disabled={!title.trim() || creating} onClick={onCreate}>
              {creating ? '创建中…' : '创建'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
