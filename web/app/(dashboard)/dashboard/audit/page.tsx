'use client';

import useSWR from 'swr';
import { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, FileSpreadsheet, History, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Pager } from '@/components/ui/pager';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

const PAGE_SIZE = 20;

/** 审计与 AI 日志（规格书 P-25）：五类必审操作流水 + AI 调用成本。 */
export default function AuditPage() {
  const [tab, setTab] = useState<'audit' | 'ai'>('audit');
  const [kw, setKw] = useState('');
  const [page, setPage] = useState(1);
  const { data: auditData, isLoading: auditLoading } = useSWR(
    tab === 'audit' ? '/api/audit-logs' : null,
    fetcher
  );
  const { data: aiData, isLoading: aiLoading } = useSWR(
    tab === 'ai' ? '/api/ai-call-logs' : null,
    fetcher
  );

  const logs = auditData?.logs ?? [];
  const aiLogs = aiData?.logs ?? [];
  const totals = aiData?.totals ?? { calls: 0, prompt: 0, completion: 0 };

  // 检索 + 分页（流水随使用增长，一页放不下）
  useEffect(() => {
    setPage(1);
  }, [kw, tab]);

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

  const pageCount = Math.max(
    1,
    Math.ceil((tab === 'audit' ? filteredLogs.length : filteredAiLogs.length) / PAGE_SIZE)
  );
  const safePage = Math.min(page, pageCount);
  const pagedLogs = filteredLogs.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const pagedAiLogs = filteredAiLogs.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <section className="flex-1">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg lg:text-2xl font-medium">审计与 AI 日志</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="w-56 pl-8"
              placeholder="搜索（操作 / 姓名 / 端点）"
              value={kw}
              onChange={(e) => setKw(e.target.value)}
            />
          </div>
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
        </div>
      </div>

      {tab === 'audit' && (
        <>
          {auditLoading && <Skeleton className="h-40" />}
          {!auditLoading && filteredLogs.length === 0 && (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                {logs.length === 0
                  ? '暂无审计记录。调分、解散小组、锁定终审等操作会留痕（含前后值）。'
                  : '没有匹配的记录。'}
              </CardContent>
            </Card>
          )}
          <div className="space-y-2">
            {pagedLogs.map((l: any) => (
              <Card key={l.id}>
                <CardContent className="flex flex-wrap items-center gap-3 py-3 text-sm">
                  <Badge variant="outline">{l.action}</Badge>
                  <span>
                    {l.actor?.name ?? `#${l.actorId}`}
                    {l.actorRole ? `（${l.actorRole}）` : ''}
                  </span>
                  <span className="text-muted-foreground">
                    {l.targetType} #{l.targetId ?? '—'}
                  </span>
                  {l.after && (
                    <span className="max-w-md truncate text-xs text-muted-foreground">
                      {JSON.stringify(l.after)}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(l.createdAt).toLocaleString('zh-CN')}
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>
          <Pager page={safePage} pageCount={pageCount} onPage={setPage} />
        </>
      )}

      {tab === 'ai' && (
        <>
          {aiLoading && <Skeleton className="h-40" />}
          {!aiLoading && (
            <>
              <div className="mb-3 grid grid-cols-3 gap-3">
                <Card>
                  <CardContent className="py-3 text-center">
                    <p className="text-2xl font-semibold tabular-nums">{totals.calls}</p>
                    <p className="text-xs text-muted-foreground">调用次数</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="py-3 text-center">
                    <p className="text-2xl font-semibold tabular-nums">{totals.prompt}</p>
                    <p className="text-xs text-muted-foreground">输入 tokens</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="py-3 text-center">
                    <p className="text-2xl font-semibold tabular-nums">{totals.completion}</p>
                    <p className="text-xs text-muted-foreground">输出 tokens</p>
                  </CardContent>
                </Card>
              </div>
              {filteredAiLogs.length === 0 && (
                <Card className="border-dashed">
                  <CardContent className="py-12 text-center text-sm text-muted-foreground">
                    {aiLogs.length === 0 ? '暂无 AI 调用记录。' : '没有匹配的记录。'}
                  </CardContent>
                </Card>
              )}
              <div className="space-y-2">
                {pagedAiLogs.map((l: any) => (
                  <Card key={l.id}>
                    <CardContent className="flex flex-wrap items-center gap-3 py-2 text-sm">
                      <Badge variant="outline">{l.endpoint}</Badge>
                      <span className="text-muted-foreground">{l.model ?? '—'}</span>
                      <span className="tabular-nums text-xs">
                        {l.latencyMs}ms · {(l.promptTokens ?? 0) + (l.completionTokens ?? 0)} tokens
                      </span>
                      <Badge variant={l.status === 'ok' ? 'default' : 'destructive'}>{l.status}</Badge>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {new Date(l.createdAt).toLocaleString('zh-CN')}
                      </span>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <Pager page={safePage} pageCount={pageCount} onPage={setPage} />
            </>
          )}
        </>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        <ClipboardCheck className="mr-1 inline h-3 w-3" />
        审计范围：调分、改归属、删任务、解散小组、锁定终审（规格书 S7.3）。
      </p>
    </section>
  );
}
