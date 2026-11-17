'use client';

import useSWR from 'swr';
import { use, useState } from 'react';
import { Lock, MessageSquarePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Pager, usePagination } from '@/components/ui/pager';
import { Callout, PageShell, Panel } from '@/components/page-shell';
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
// 取数与写操作统一走 lib/api/client：非 2xx 抛 ApiError，页面才会走「加载失败」，而不是把错误
// JSON 当成空账本渲染。原先这里自带一份 fetcher + readBody，与其它页面重复，
// 也拿不到 401/403/404/5xx/网络/超时的分类文案。
import { QueryError } from '@/components/query-state';
import { apiSend, describeApiError, swrFetcher } from '@/lib/api/client';

/** 页内一行状态提示：成功用 emerald、失败用 destructive，与全站状态色一致。 */
function NoticeLine({ notice }: { notice: { ok: boolean; text: string } | null }) {
  if (!notice) return null;
  return (
    <p
      role="status"
      className={`text-sm ${notice.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}
    >
      {notice.text}
    </p>
  );
}

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
  }>(`/api/courses/${id}/groups`, swrFetcher);
  const { data: courseData } = useSWR<{
    course: { name: string };
    myRole: string;
  }>(`/api/courses/${id}`, swrFetcher);
  const { data: meData } = useSWR<{ user: { id: number } }>('/api/auth/me', swrFetcher);

  const myRole = courseData?.myRole ?? 'member';
  const isTeacher = myRole === 'teacher';
  const isTeacherSide = myRole === 'teacher' || myRole === 'assistant';

  const [pickedGroupId, setPickedGroupId] = useState<number | null>(null);
  const [evidenceSnapId, setEvidenceSnapId] = useState<number | null>(null);
  const [reviewing, setReviewing] = useState<Entry | null>(null);
  const [appealing, setAppealing] = useState<Entry | null>(null);
  /** 页级动作（计算 / 锁定）的回执：失败要看得见，不能静默吞掉 */
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const allGroups = groupsData?.groups ?? [];
  // 教师/助教可切换查看任一组；队长/队员固定本组（与任务页同口径）
  const group = isTeacherSide
    ? (allGroups.find((g) => g.id === pickedGroupId) ?? allGroups[0])
    : (allGroups.find((g) => g.members.some((m) => m.userId === meData?.user?.id)) ?? allGroups[0]);

  const { data: ledgerData, error, isLoading, mutate } = useSWR<{
    snapshotAt: string | null;
    memberCount: number;
    entries: Entry[];
  }>(group ? `/api/groups/${group.id}/contributions` : null, swrFetcher);

  const entries = ledgerData?.entries ?? [];
  const memberMap = new Map((group?.members ?? []).map((m) => [m.userId, m]));

  // 队员只看自己的区间（规格书 S5：他人区间默认不可见）
  const myId = meData?.user?.id;
  const visibleEntries = isTeacher || myRole === 'assistant' || myRole === 'captain'
    ? entries
    : entries.filter((e) => e.userId === myId);

  async function lockAll() {
    if (!group) return;
    if (!window.confirm('锁定后不可再调整区间，确定锁定终审结果？')) return;
    setNotice(null);
    try {
      const body = await apiSend<{ locked?: number }>(
        `/api/groups/${group.id}/contributions/lock`,
        { method: 'POST' }
      );
      const locked = typeof body?.locked === 'number' ? body.locked : null;
      await mutate().catch(() => null);
      setNotice({ ok: true, text: locked === null ? '已锁定本组终审结果' : `已锁定 ${locked} 条终审结果` });
    } catch (err) {
      setNotice({ ok: false, text: describeApiError(err) });
    }
  }

  async function compute() {
    if (!group) return;
    setNotice(null);
    try {
      await apiSend(`/api/groups/${group.id}/contributions`, { method: 'POST' });
      await mutate().catch(() => null);
      setNotice({ ok: true, text: '已重新计算贡献区间' });
    } catch (err) {
      setNotice({ ok: false, text: describeApiError(err) });
    }
  }

  const crumbs = [
    { label: '课程工作台', href: '/dashboard' },
    { label: '课程', href: `/dashboard/courses/${id}` },
    { label: '贡献账本' }
  ];

  const groupSwitcher =
    isTeacherSide && allGroups.length > 1 ? (
      <Select
        value={group ? String(group.id) : undefined}
        onValueChange={(v) => setPickedGroupId(Number(v))}
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

  if (groupsLoading || isLoading) {
    return (
      <PageShell title="贡献账本" breadcrumbs={crumbs}>
        <Skeleton className="h-64 w-full" />
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell title="贡献账本" breadcrumbs={crumbs}>
        <QueryError error={error} onRetry={() => void mutate()} title="贡献账本加载失败" />
      </PageShell>
    );
  }

  if (!group || !ledgerData?.snapshotAt) {
    return (
      <PageShell
        title="贡献账本"
        breadcrumbs={crumbs}
        description="系统只输出区间与证据，最终评分与锁定权在教师。"
        actions={groupSwitcher}
      >
        <Panel>
          <div className="space-y-3">
            <NoticeLine notice={notice} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {group
                  ? '这个小组还没有贡献快照。成员撰写交付物并汇编后，点右侧按钮生成。'
                  : '本课程还没有分组。'}
              </p>
              {group && (
                <Button size="sm" onClick={compute}>
                  计算贡献
                </Button>
              )}
            </div>
          </div>
        </Panel>
      </PageShell>
    );
  }

  return (
    <PageShell
      title={`贡献账本 · ${group.name}`}
      breadcrumbs={crumbs}
      description={
        isTeacherSide
          ? '系统只输出区间与证据，最终评分与锁定权在你。'
          : '你所在的小组：只显示你自己的区间，证据可逐条下钻。'
      }
      actions={groupSwitcher}
    >
      <Panel
        title={`成员区间（${visibleEntries.length} 人）`}
        hint={`快照于 ${new Date(ledgerData.snapshotAt).toLocaleString('zh-CN')} · 全页不出现单一分数`}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={compute}>
              重新计算
            </Button>
            {isTeacher && (
              <Button size="sm" variant="outline" onClick={lockAll}>
                <Lock className="mr-1 h-4 w-4" />
                批量锁定终审
              </Button>
            )}
          </>
        }
        bodyClassName="p-0"
      >
        {/* 计算 / 锁定的回执贴在列表上方，失败时不会被列表盖住 */}
        {notice && (
          <div className="border-b px-4 py-2.5">
            <NoticeLine notice={notice} />
          </div>
        )}
        {visibleEntries.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            这次快照没有可显示给你的成员区间。
          </p>
        ) : (
          <ul className="divide-y">
            {visibleEntries.map((e) => {
              const m = memberMap.get(e.userId);
              const compEntries = Object.entries(e.comp).sort((a, b) => b[1] - a[1]);
              return (
                <li key={e.userId} className="space-y-3 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">
                      {m?.name ?? `#${e.userId}`}
                      {m?.studentNo ? ` · ${m.studentNo}` : ''}
                    </span>
                    <Badge variant="outline">
                      置信度 {CONFIDENCE_LABEL[e.confidence] ?? e.confidence}
                    </Badge>
                    {e.review?.isLocked && <Badge>已锁定</Badge>}
                    {e.review && !e.review.isLocked && <Badge variant="secondary">教师已调</Badge>}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
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
                        <p className="mt-1 text-xs text-muted-foreground">
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
                  </div>

                  {e.warning && (
                    <p className="rounded bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-950/25 dark:text-amber-200">
                      {e.warning}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEvidenceSnapId(e.snapshotId)}>
                      查看证据
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
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

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
            // 终审已成功落库：刷新失败不应被当成保存失败
            await mutate().catch(() => null);
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
    </PageShell>
  );
}

function EvidenceDrawer({ snapshotId, onClose }: { snapshotId: number; onClose: () => void }) {
  const { data, isLoading } = useSWR<{ items: any[] }>(
    `/api/contributions/${snapshotId}/evidence`,
    swrFetcher
  );
  const items = data?.items ?? [];
  // 一学期下来单个成员可累积上百条证据，抽屉内分页；标题里的总数仍是全量
  const evidencePage = usePagination<any>(items, 20);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>证据下钻（{items.length} 条）</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          每条结论都可下钻到段落原文 / 任务事件 / 互评原文（规格书 P-19）。
        </p>
        {isLoading && <Skeleton className="h-40" />}
        {!isLoading && items.length === 0 && (
          <p className="text-sm text-muted-foreground">该成员暂无证据条目。</p>
        )}
        <ul className="space-y-2">
          {evidencePage.pageItems.map((i: any) => (
            <li key={i.id} className="rounded border p-2 text-sm">
              <div className="flex items-center gap-2">
                <Badge variant="outline">
                  {i.source === 'artifact' ? '产出物' : i.source === 'peer' ? '同伴' : '过程'}
                </Badge>
                <span className="text-muted-foreground">{i.note}</span>
                <span className="ml-auto tabular-nums text-muted-foreground">{i.value} 字/次</span>
              </div>
              {i.segment && (
                <div className="mt-1 rounded bg-muted p-2 text-xs text-muted-foreground">
                  <p className="mb-1 font-medium text-foreground">
                    段落 #{i.segment.seq} · 作者 #{i.segment.authorId} · {i.segment.wordCount} 字
                  </p>
                  <p className="whitespace-pre-wrap">{i.segment.content}</p>
                </div>
              )}
              {i.task && (
                <p className="mt-1 text-xs text-muted-foreground">
                  任务 {i.task.code} {i.task.title}（{i.task.status}）
                </p>
              )}
              {i.peerReview && (
                <div className="mt-1 rounded bg-muted p-2 text-xs text-muted-foreground">
                  <p className="mb-1 font-medium text-foreground">
                    互评原文 · 评价人 #{i.peerReview.reviewerId}
                  </p>
                  <p>
                    维度分：
                    {Object.entries(i.peerReview.scores ?? {})
                      .map(([k, v]) => `${k} ${v}`)
                      .join('、') || '（无）'}
                  </p>
                  {i.peerReview.comment && <p className="mt-1 whitespace-pre-wrap">{i.peerReview.comment}</p>}
                </div>
              )}
            </li>
          ))}
        </ul>
        <Pager {...evidencePage.pagerProps} unit="条" />
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
  const [error, setError] = useState('');

  async function save() {
    if (saving) return;
    const lowNum = Number(low);
    const highNum = Number(high);
    // 先做本地校验：区间倒挂或越界就地提示，不发请求，也不关弹窗
    if (!Number.isFinite(lowNum) || !Number.isFinite(highNum)) {
      setError('请输入 0–100 之间的数字');
      return;
    }
    if (lowNum < 0 || highNum > 100) {
      setError('下限和上限都必须在 0–100 之间');
      return;
    }
    if (lowNum > highNum) {
      setError('下限不能大于上限');
      return;
    }
    setSaving(true);
    setError('');
    try {
      // 服务端拒绝时保持弹窗打开并显示原因，避免「假成功」（表格还停在旧值）
      await apiSend(`/api/contributions/${entry.snapshotId}/review`, {
        method: 'POST',
        body: {
          adjustedLow: lowNum,
          adjustedHigh: highNum,
          finalNote: note || undefined
        }
      });
      await onDone();
    } catch (err) {
      setError(describeApiError(err));
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
              <Input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={low}
                onChange={(e) => {
                  setLow(e.target.value);
                  setError('');
                }}
              />
            </div>
            <div className="space-y-1">
              <Label>上限 %</Label>
              <Input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={high}
                onChange={(e) => {
                  setHigh(e.target.value);
                  setError('');
                }}
              />
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
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
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit() {
    if (saving) return;
    setSaving(true);
    try {
      await apiSend(`/api/contributions/${entry.snapshotId}/appeal`, {
        method: 'POST',
        body: { reason, evidenceText: evidenceText || undefined }
      });
      setMsg({ ok: true, text: '申诉已提交，教师处理后你会收到通知。' });
    } catch (err) {
      // 失败时把服务端原因直接显示出来，并保持输入内容，让用户能改后重提
      setMsg({ ok: false, text: describeApiError(err) });
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
          <NoticeLine notice={msg} />
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
