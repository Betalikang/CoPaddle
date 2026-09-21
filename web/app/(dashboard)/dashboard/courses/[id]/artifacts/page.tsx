'use client';

import useSWR from 'swr';
import { use, useMemo, useState } from 'react';
import { FilePlus2, Save, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
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

const fetcher = (url: string) => fetch(url).then((res) => res.json());

const KIND_LABEL: Record<string, string> = {
  heading: '标题',
  paragraph: '段落',
  figure: '图表',
  table: '表格',
  code: '代码',
  formula: '公式'
};

type Segment = { seq: number; kind: string; content: string };

/** 交付物编辑器（规格书 M-05）：分段在线撰写，保存时服务端 diff 记录归属。 */
export default function ArtifactsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: groupsData } = useSWR<{
    groups: { id: number; name: string }[];
  }>(`/api/courses/${id}/groups`, fetcher);
  const group = groupsData?.groups?.[0];

  const { data: artifactsData, isLoading, mutate } = useSWR<{ artifacts: any[] }>(
    group ? `/api/groups/${group.id}/artifacts` : null,
    fetcher
  );

  const [openId, setOpenId] = useState<number | null>(null);
  const { data: detail } = useSWR(openId ? `/api/artifacts/${openId}` : null, fetcher);

  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [newTitle, setNewTitle] = useState('');

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
    setMsg('');
    try {
      const res = await fetch(`/api/artifacts/${openId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segments: currentSegments })
      });
      const body = await res.json();
      if (res.ok) {
        setMsg(`已保存 v${body.versionNo}：${body.diffSummary}`);
        setSegments(null);
        await mutate();
      } else {
        setMsg(body.error ?? '保存失败');
      }
    } finally {
      setSaving(false);
    }
  }

  async function createArtifact() {
    if (!group || !newTitle.trim()) return;
    const res = await fetch(`/api/groups/${group.id}/artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle.trim() })
    });
    if (res.ok) {
      setNewTitle('');
      await mutate();
    }
  }

  async function submitFinal() {
    if (!openId) return;
    await fetch(`/api/artifacts/${openId}/submit`, { method: 'POST' });
    setMsg('已提交终稿，段落归属冻结。');
    await mutate();
  }

  async function compile() {
    if (!group) return;
    const res = await fetch(`/api/groups/${group.id}/compile`, { method: 'POST' });
    if (res.ok) {
      setMsg('已汇编生成小组终稿。');
      await mutate();
    }
  }

  if (isLoading) {
    return (
      <section className="flex-1">
        <Skeleton className="h-8 w-48" />
      </section>
    );
  }

  const artifacts = artifactsData?.artifacts ?? [];
  const authorStats = detail?.authorStats;
  const totalWords = authorStats?.totalWords ?? 0;

  return (
    <section className="flex-1">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg lg:text-2xl font-medium">交付物与溯源</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={compile}>汇编终稿</Button>
          <NewArtifactButton onCreate={createArtifact} title={newTitle} setTitle={setNewTitle} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* 交付物列表 */}
        <div className="space-y-2">
          {artifacts.length === 0 && (
            <p className="text-sm text-muted-foreground">还没有交付物。新建一个开始撰写。</p>
          )}
          {artifacts.map((a: any) => (
            <Card
              key={a.id}
              className={`cursor-pointer transition-shadow hover:shadow-md ${openId === a.id ? 'border-primary' : ''}`}
              onClick={() => {
                setOpenId(a.id);
                setSegments(null);
                setMsg('');
              }}
            >
              <CardHeader className="py-3 pb-1">
                <CardTitle className="flex items-center gap-2 text-sm">
                  {a.title}
                  {a.isFinalDeliverable && <Badge variant="default">终稿</Badge>}
                  <Badge variant="outline">{a.status}</Badge>
                </CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>

        {/* 编辑器 */}
        <div className="lg:col-span-2">
          {!openId && (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                选择一个交付物开始编辑，或新建。段落归属会自动记录，无需自报。
              </CardContent>
            </Card>
          )}
          {openId && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base">编辑器（第 {currentSegments.length} 段）</CardTitle>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={addSegment}>
                    <FilePlus2 className="mr-1 h-4 w-4" />
                    添加段
                  </Button>
                  <Button size="sm" disabled={saving} onClick={save}>
                    <Save className="mr-1 h-4 w-4" />
                    {saving ? '保存中…' : '保存版本'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={submitFinal}>
                    <Send className="mr-1 h-4 w-4" />
                    提交终稿
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {totalWords > 0 && (
                  <div className="rounded bg-muted p-2 text-xs text-muted-foreground">
                    当前版本共 {totalWords} 字；各成员主责占比：
                    {[...(authorStats?.byAuthor as Map<number, number> | undefined)?.entries() ?? []].map(
                      ([uid, n]: [number, number]) => (
                        <span key={uid} className="ml-2">
                          #{uid} {((n / totalWords) * 100).toFixed(0)}%
                        </span>
                      )
                    )}
                  </div>
                )}
                {msg && <p className="text-sm text-green-700">{msg}</p>}
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
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </section>
  );
}

function NewArtifactButton({
  onCreate,
  title,
  setTitle
}: {
  onCreate: () => void;
  title: string;
  setTitle: (v: string) => void;
}) {
  return (
    <Dialog>
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
          <div className="flex justify-end">
            <Button size="sm" disabled={!title.trim()} onClick={onCreate}>创建</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
