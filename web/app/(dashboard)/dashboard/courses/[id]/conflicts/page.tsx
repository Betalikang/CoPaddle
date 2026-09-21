'use client';

import useSWR from 'swr';
import { use, useState } from 'react';
import { ScanSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

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
  const { data: groupsData } = useSWR<{ groups: { id: number; name: string }[] }>(
    `/api/courses/${id}/groups`,
    fetcher
  );
  const group = groupsData?.groups?.[0];

  const { data, isLoading, mutate } = useSWR<{ conflicts: Conflict[] }>(
    group ? `/api/groups/${group.id}/conflicts` : null,
    fetcher
  );

  const [detecting, setDetecting] = useState(false);
  const [handling, setHandling] = useState<number | null>(null);
  const [note, setNote] = useState('');

  const conflicts = data?.conflicts ?? [];
  const open = conflicts.filter((c) => c.status === 'open' || c.status === 'analyzing');

  async function detect() {
    if (!group) return;
    setDetecting(true);
    try {
      await fetch(`/api/groups/${group.id}/conflicts/detect`, { method: 'POST' });
      await mutate();
    } finally {
      setDetecting(false);
    }
  }

  async function resolve(conflictId: number, action: 'merge' | 'realign' | 'reassign' | 'dismiss') {
    setHandling(conflictId);
    try {
      await fetch(`/api/conflicts/${conflictId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note: note || undefined })
      });
      setNote('');
      await mutate();
    } finally {
      setHandling(null);
    }
  }

  if (isLoading) {
    return (
      <section className="flex-1">
        <Skeleton className="h-8 w-48" />
      </section>
    );
  }

  return (
    <section className="flex-1">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg lg:text-2xl font-medium">冲突中心</h1>
        {group && (
          <Button variant="outline" disabled={detecting} onClick={detect}>
            <ScanSearch className="mr-1 h-4 w-4" />
            {detecting ? '检测中…' : '立即检测'}
          </Button>
        )}
      </div>

      {!group && <p className="text-sm text-muted-foreground">本课程还没有分组。</p>}

      {open.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            没有待处理冲突。任务延期或阻塞时系统会自动生成依赖冲突。
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {conflicts.map((c) => (
          <Card key={c.id} className={c.status === 'open' ? 'border-amber-300' : 'opacity-60'}>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">{c.title}</CardTitle>
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
            </CardHeader>
            {c.summary && <CardContent className="pb-2 text-sm text-muted-foreground">{c.summary}</CardContent>}
            {(c.status === 'open' || c.status === 'analyzing') && (
              <CardContent className="flex flex-wrap items-end gap-2">
                <Textarea
                  rows={1}
                  className="max-w-xs"
                  placeholder="处理备注（可选）"
                  value={handling === c.id ? note : ''}
                  onChange={(e) => setNote(e.target.value)}
                />
                <Button size="sm" disabled={handling === c.id} onClick={() => resolve(c.id, 'realign')}>
                  退回对齐契约
                </Button>
                <Button size="sm" variant="outline" disabled={handling === c.id} onClick={() => resolve(c.id, 'reassign')}>
                  重指派
                </Button>
                <Button size="sm" variant="ghost" disabled={handling === c.id} onClick={() => resolve(c.id, 'dismiss')}>
                  忽略
                </Button>
              </CardContent>
            )}
          </Card>
        ))}
      </div>
    </section>
  );
}
