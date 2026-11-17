'use client';

import useSWR from 'swr';
import { use, useState } from 'react';
import { ScanSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Callout, PageShell, Panel } from '@/components/page-shell';
import { Pager, usePagination } from '@/components/ui/pager';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

/**
 * SWR 取数统一走 lib/api/client 的 swrFetcher：非 2xx 一律抛 ApiError，
 * 页面才会走「加载失败」，而不是把错误 JSON 当成空列表渲染。
 * （原来这里自带一份 fetcher，与其它页面重复；统一后 401/403/404/5xx 的分类文案也一致。）
 */
import { QueryError } from '@/components/query-state';
import { apiSend, describeApiError, swrFetcher } from '@/lib/api/client';

type Conflict = {
  id: number;
  type: string;
  severity: string;
  status: string;
  detectedBy: string;
  title: string;
  summary: string | null;
  detectedAt: string;
};

const TYPE_LABEL: Record<string, string> = {
  dependency: '依赖冲突',
  contract: '契约冲突',
  content: '内容冲突'
};

const SEVERITY_LABEL: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低'
};

/** 冲突中心（规格书 P-17 的 S5 子集）：依赖冲突检测列表 + 人工处理。 */
export default function ConflictsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: groupsData } = useSWR<{
    groups: { id: number; name: string; members?: { userId: number; name: string | null }[] }[];
  }>(`/api/courses/${id}/groups`, swrFetcher);
  /**
   * 优先取「我所在的小组」：原来固定取 groups[0]，成员/队长打开页面会看到别组的冲突
   * （非本组会被 guardGroup 拒成 403，页面直接报「加载失败」）。
   * 教师/助教没有组，仍然回退到第一个组。
   */
  // 当前用户取 /api/user：layout.tsx 已把服务端结果放进 SWR fallback；响应就是用户对象本身（未登录为 401 + null）
  const { data: me } = useSWR<{ id: number } | null>('/api/user', swrFetcher);
  const myUserId = me?.id ?? null;
  const allGroups = groupsData?.groups ?? [];
  const myGroup =
    myUserId === null
      ? undefined
      : allGroups.find((g) => (g.members ?? []).some((m) => m.userId === myUserId));
  const group = myGroup ?? allGroups[0];

  const { data, error, isLoading, mutate } = useSWR<{ conflicts: Conflict[] }>(
    group ? `/api/groups/${group.id}/conflicts` : null,
    swrFetcher
  );

  const [detecting, setDetecting] = useState(false);
  /** 「立即检测」的结果回执：成功显示新增条数，失败显示服务端错误 */
  const [detectMsg, setDetectMsg] = useState<{ ok: boolean; text: string } | null>(null);
  /**
   * 备注输入：把「哪一条在编辑」和「输入值」合成一份状态。
   * 原来输入框受控于 note、而 note 只在提交瞬间有效，导致每次按键都被重置成空串，
   * 但提交时又带上了隐藏的 note —— 用户看不见自己打字，服务端却收到了内容。
   */
  const [editing, setEditing] = useState<{ id: number; note: string } | null>(null);
  /** 正在提交的冲突 id：只用于禁用按钮，与输入值无关 */
  const [handling, setHandling] = useState<number | null>(null);
  /** 「重指派」必须先选新主责人：按冲突 id 记录所选成员，未选时按钮给出明确提示 */
  const [reassignTo, setReassignTo] = useState<Record<number, string>>({});
  const [actionError, setActionError] = useState<{ id: number; text: string } | null>(null);

  const conflicts = data?.conflicts ?? [];
  const open = conflicts.filter((c) => c.status === 'open' || c.status === 'analyzing');

  // 冲突条目一学期会累积到几十条，10 条一页；放在条件 return 之前以固定 hook 顺序
  const conflictPager = usePagination(conflicts, 10);

  async function detect() {
    if (!group || detecting) return;
    setDetecting(true);
    setDetectMsg(null);
    try {
      // 真实入口就是列表同路径的 POST（/conflicts/detect 不存在，会返回 404 HTML）
      const body = await apiSend<{ created?: number }>(`/api/groups/${group.id}/conflicts`, {
        method: 'POST'
      });
      const created = typeof body?.created === 'number' ? body.created : 0;
      // 刷新失败不覆盖本次结果：页面自身的 error 分支会提示加载失败
      await mutate().catch(() => null);
      setDetectMsg({ ok: true, text: `检测完成，新增 ${created} 条` });
    } catch (err) {
      setDetectMsg({ ok: false, text: describeApiError(err) });
    } finally {
      setDetecting(false);
    }
  }

  async function resolve(conflictId: number, action: 'merge' | 'realign' | 'reassign' | 'dismiss') {
    setHandling(conflictId);
    setActionError(null);
    // 备注只取该条目输入框里的值，与提交用的是同一份状态
    const note = editing && editing.id === conflictId ? editing.note.trim() : '';
    // 重指派必须带上新主责人：服务端会拒绝没有目标人的请求（不能再假装成功）
    let payload: Record<string, unknown> | undefined;
    if (action === 'reassign') {
      const target = Number(reassignTo[conflictId] ?? '');
      if (!Number.isInteger(target) || target <= 0) {
        setActionError({ id: conflictId, text: '请先在下拉框里选择新的主责人' });
        setHandling(null);
        return;
      }
      payload = { to_user_id: target };
    }
    try {
      await apiSend(`/api/conflicts/${conflictId}/resolve`, {
        method: 'POST',
        body: { action, note: note || undefined, payload }
      });
      // 处理成功才清空输入，失败时保留用户刚写的备注
      setEditing(null);
      await mutate().catch(() => null);
    } catch (err) {
      setActionError({ id: conflictId, text: describeApiError(err) });
    } finally {
      setHandling(null);
    }
  }

  const crumbs = [
    { label: '课程工作台', href: '/dashboard' },
    { label: '课程', href: `/dashboard/courses/${id}` },
    { label: '冲突中心' }
  ];

  if (isLoading) {
    return (
      <PageShell title="冲突中心" breadcrumbs={crumbs}>
        <Skeleton className="h-64 w-full" />
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell title="冲突中心" breadcrumbs={crumbs}>
        <QueryError error={error} onRetry={() => void mutate()} title="冲突列表加载失败" />
      </PageShell>
    );
  }

  if (!group) {
    return (
      <PageShell title="冲突中心" breadcrumbs={crumbs}>
        <Panel>
          <p className="text-sm text-muted-foreground">本课程还没有分组，暂时无法检测冲突。</p>
        </Panel>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="冲突中心"
      breadcrumbs={crumbs}
      description="任务延期或阻塞时系统自动生成依赖冲突，三种处理方式：退回对齐契约、重指派、忽略。"
      actions={
        <Button variant="outline" size="sm" disabled={detecting} onClick={detect}>
          <ScanSearch className="mr-1 h-4 w-4" />
          {detecting ? '检测中…' : '立即检测'}
        </Button>
      }
    >
      <div className="space-y-3">
        {detectMsg && (
          <p
            role="status"
            className={`text-sm ${detectMsg.ok ? 'text-success' : 'text-destructive'}`}
          >
            {detectMsg.text}
          </p>
        )}

        <Panel
          title={`冲突（${conflicts.length}）`}
          hint={open.length > 0 ? `${open.length} 条待处理` : '没有待处理项'}
          bodyClassName="p-0"
        >
          {conflicts.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              没有待处理冲突。任务延期或阻塞时系统会自动生成依赖冲突。
            </p>
          ) : (
            <ul className="divide-y">
              {conflictPager.pageItems.map((c) => (
                <li
                  key={c.id}
                  className={`space-y-2 px-4 py-3 ${
                    c.status === 'open' ? 'border-l-2 border-l-amber-400' : 'opacity-60'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{c.title}</span>
                    <Badge variant="outline">{TYPE_LABEL[c.type] ?? c.type}</Badge>
                    <Badge variant={c.severity === 'high' ? 'destructive' : 'secondary'}>
                      {SEVERITY_LABEL[c.severity] ?? c.severity}
                    </Badge>
                    <Badge variant={c.status === 'open' ? 'default' : 'secondary'}>
                      {c.status === 'open' ? '待处理' : c.status === 'resolved' ? '已解决' : c.status === 'dismissed' ? '已忽略' : c.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {c.detectedBy === 'auto' ? '系统检测' : '手动检测'} · {new Date(c.detectedAt).toLocaleString('zh-CN')}
                    </span>
                  </div>

                  {c.summary && <p className="text-sm text-muted-foreground">{c.summary}</p>}

                  {(c.status === 'open' || c.status === 'analyzing') && (
                    <div className="flex flex-wrap items-end gap-2">
                      {/* 备注框占满按钮组以外的宽度，至少四行高；min-w 保证窄屏时按钮组换行而不是把输入框挤没 */}
                      <Textarea
                        rows={3}
                        className="min-h-24 min-w-[14rem] flex-1 resize-y"
                        placeholder="处理备注（可选）"
                        value={editing && editing.id === c.id ? editing.note : ''}
                        onChange={(e) => setEditing({ id: c.id, note: e.target.value })}
                      />
                      {/* 处理动作统一靠右：左备注、右三个动作，换行时按钮组不被拆开 */}
                      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                        <Button size="sm" disabled={handling === c.id} onClick={() => resolve(c.id, 'realign')}>
                          退回对齐契约
                        </Button>
                        {/* 重指派需要指定接手的成员：没有选择时按钮点了只会得到明确报错。
                            Radix Select 不允许空字符串 value，占位项用 'none' 表示「未选择」，
                            回写状态时再归一成空串，resolve() 的 Number('') → 0 校验才能拦住。 */}
                        <Select
                          value={reassignTo[c.id] ? String(reassignTo[c.id]) : 'none'}
                          onValueChange={(v) =>
                            setReassignTo((prev) => ({ ...prev, [c.id]: v === 'none' ? '' : v }))
                          }
                          disabled={handling === c.id}
                        >
                          <SelectTrigger aria-label="新的主责人" className="h-8 w-36 text-xs">
                            <SelectValue placeholder="新主责人…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">新主责人…</SelectItem>
                            {(group.members ?? []).map((m) => (
                              <SelectItem key={m.userId} value={String(m.userId)}>
                                {m.name ?? `#${m.userId}`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button size="sm" variant="outline" disabled={handling === c.id} onClick={() => resolve(c.id, 'reassign')}>
                          重指派
                        </Button>
                        <Button size="sm" variant="ghost" disabled={handling === c.id} onClick={() => resolve(c.id, 'dismiss')}>
                          忽略
                        </Button>
                      </div>
                    </div>
                  )}

                  {actionError && actionError.id === c.id && (
                    <p role="alert" className="text-sm text-destructive">
                      {actionError.text}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Pager {...conflictPager.pagerProps} unit="条" className="px-4 pb-4" />
        </Panel>
      </div>
    </PageShell>
  );
}
