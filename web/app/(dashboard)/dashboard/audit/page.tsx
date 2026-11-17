'use client';

import useSWR from 'swr';
import { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, History, ScrollText, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Pager, usePagination } from '@/components/ui/pager';
import { PageShell, Panel } from '@/components/page-shell';
import { EmptyState } from '@/components/empty-state';
import { QueryError } from '@/components/query-state';
import { swrFetcher } from '@/lib/api/client';

const PAGE_SIZE = 20;

/** 审计与 AI 日志（规格书 P-25）：五类必审操作流水 + AI 调用成本。 */
export default function AuditPage() {
  const [tab, setTab] = useState<'audit' | 'ai'>('audit');
  const [kw, setKw] = useState('');
  // 两个 tab 各用一条 SWR：留活着的那个才能在错误态给出「重试」
  // swrFetcher 是泛型函数，这里必须显式给出响应形状，否则 data 会退化成 {}
  const {
    data: auditData,
    isLoading: auditLoading,
    error: auditError,
    mutate: mutateAudit
  } = useSWR<{ logs: any[] }>(tab === 'audit' ? '/api/audit-logs' : null, swrFetcher);
  const { data: aiData, isLoading: aiLoading, error: aiError, mutate: mutateAi } = useSWR<{
    logs: any[];
    totals: { calls: number; prompt: number; completion: number };
  }>(tab === 'ai' ? '/api/ai-call-logs' : null, swrFetcher);

  const logs = auditData?.logs ?? [];
  const aiLogs = aiData?.logs ?? [];
  const totals = aiData?.totals ?? { calls: 0, prompt: 0, completion: 0 };

  // 检索 + 分页（流水随使用增长，一页放不下）
  const filteredLogs = useMemo(() => {
    const k = kw.trim().toLowerCase();
    if (!k) return logs;
    return logs.filter((l: any) =>
      [l.action, l.actor?.name, l.targetType, String(l.targetId ?? '')]
        .join(' ')
        .toLowerCase()
        .includes(k)
    );
  }, [logs, kw]);

  const filteredAiLogs = useMemo(() => {
    const k = kw.trim().toLowerCase();
    if (!k) return aiLogs;
    return aiLogs.filter((l: any) =>
      [l.endpoint, l.model, l.status].join(' ').toLowerCase().includes(k)
    );
  }, [aiLogs, kw]);

  // 两个 tab 共用一个页状态：只对当前 tab 的列表分页，切 tab 时页码自动夹回合法范围
  const listPager = usePagination(tab === 'audit' ? filteredLogs : filteredAiLogs, PAGE_SIZE);
  const pagedLogs = tab === 'audit' ? listPager.pageItems : [];
  const pagedAiLogs = tab === 'ai' ? listPager.pageItems : [];

  // 检索或切 tab 时回到第一页
  useEffect(() => {
    listPager.setPage(1);
  }, [kw, tab, listPager.setPage]);

  const searchBox = (
    <div className="relative">
      <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
      <Input
        className="w-52 pl-8"
        placeholder="搜索（操作 / 姓名 / 端点）"
        aria-label="搜索审计与 AI 日志（操作 / 姓名 / 端点）"
        value={kw}
        onChange={(e) => setKw(e.target.value)}
      />
    </div>
  );

  return (
    <PageShell
      breadcrumbs={[{ label: '课程工作台', href: '/dashboard' }, { label: '审计与 AI 日志' }]}
      title="审计与 AI 日志"
      description="调分、改归属、删任务、解散小组、锁定终审都会留痕（含前后值）；AI 调用的 token 成本也在这一页核对。"
      width="wide"
      actions={
        <div className="flex gap-1">
          <Button size="sm" variant={tab === 'audit' ? 'default' : 'outline'} onClick={() => setTab('audit')}>
            <History className="mr-1 h-4 w-4" />
            审计流水
          </Button>
          <Button size="sm" variant={tab === 'ai' ? 'default' : 'outline'} onClick={() => setTab('ai')}>
            <FileSpreadsheet className="mr-1 h-4 w-4" />
            AI 调用
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {tab === 'audit' && (
          <>
            {/* 读失败时整块换成 QueryError：否则空态会显示「暂无审计记录」，把无权限说成没数据 */}
            {auditError ? (
              <QueryError
                error={auditError}
                onRetry={() => void mutateAudit()}
                title="审计流水加载失败"
              />
            ) : (
              <Panel
                title="审计流水"
                hint={filteredLogs.length > 0 ? `共 ${filteredLogs.length} 条` : undefined}
                actions={searchBox}
                bodyClassName="p-0"
              >
                {auditLoading ? (
                  <div className="space-y-2 p-4">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : pagedLogs.length === 0 ? (
                  <EmptyState
                    icon={ScrollText}
                    title={logs.length === 0 ? '暂无审计记录' : '没有匹配的记录'}
                    hint={
                      logs.length === 0
                        ? '调分、解散小组、锁定终审等操作会留痕（含前后值）。'
                        : undefined
                    }
                  />
                ) : (
                  <ul className="divide-y">
                    {pagedLogs.map((l: any) => (
                      <li
                        key={l.id}
                        className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm"
                      >
                        <Badge variant="outline">{l.action}</Badge>
                        <span>
                          {l.actor?.name ?? `#${l.actorId}`}
                          {l.actorRole ? `（${l.actorRole}）` : ''}
                        </span>
                        <span className="text-muted-foreground">
                          {l.targetType} #{l.targetId ?? '—'}
                        </span>
                        {l.after && (
                          <span className="max-w-md truncate font-mono text-xs text-muted-foreground">
                            {JSON.stringify(l.after)}
                          </span>
                        )}
                        <span className="ml-auto text-xs text-muted-foreground">
                          {new Date(l.createdAt).toLocaleString('zh-CN')}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <Pager {...listPager.pagerProps} unit="条" className="px-4 pb-4" />
              </Panel>
            )}
          </>
        )}

        {tab === 'ai' && (
          <>
            {/* 同理：读失败时成本统计会是全 0、「暂无调用记录」，都要让位给明确的错误态 */}
            {aiError ? (
              <QueryError
                error={aiError}
                onRetry={() => void mutateAi()}
                title="AI 调用日志加载失败"
              />
            ) : (
              <>
                <Panel title="AI 调用成本" hint="当前日志范围内的累计值">
                  <div className="grid grid-cols-3 divide-x">
                    <Stat label="调用次数" value={totals.calls} />
                    <Stat label="输入 tokens" value={totals.prompt} />
                    <Stat label="输出 tokens" value={totals.completion} />
                  </div>
                </Panel>

                <Panel
                  title="调用记录"
                  hint={filteredAiLogs.length > 0 ? `共 ${filteredAiLogs.length} 条` : undefined}
                  actions={searchBox}
                  bodyClassName="p-0"
                >
                  {aiLoading ? (
                    <div className="space-y-2 p-4">
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                  ) : pagedAiLogs.length === 0 ? (
                    <EmptyState
                      compact
                      icon={Search}
                      title={aiLogs.length === 0 ? '暂无 AI 调用记录。' : '没有匹配的记录。'}
                    />
                  ) : (
                    <ul className="divide-y">
                      {pagedAiLogs.map((l: any) => (
                        <li
                          key={l.id}
                          className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm"
                        >
                          <Badge variant="outline">{l.endpoint}</Badge>
                          <span className="text-muted-foreground">{l.model ?? '—'}</span>
                          <span className="text-xs tabular-nums">
                            {l.latencyMs}ms · {(l.promptTokens ?? 0) + (l.completionTokens ?? 0)}{' '}
                            tokens
                          </span>
                          <Badge variant={l.status === 'ok' ? 'default' : 'destructive'}>
                            {l.status}
                          </Badge>
                          <span className="ml-auto text-xs text-muted-foreground">
                            {new Date(l.createdAt).toLocaleString('zh-CN')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Pager {...listPager.pagerProps} unit="条" className="px-4 pb-4" />
                </Panel>
              </>
            )}
          </>
        )}
      </div>
    </PageShell>
  );
}

/** 统计条里的一格：数字在上、说明在下，三格并排取代三张大数字卡。 */
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-3 text-center">
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
