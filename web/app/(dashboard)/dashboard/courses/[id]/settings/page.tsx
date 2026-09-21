'use client';

import useSWR from 'swr';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Skeleton } from '@/components/ui/skeleton';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type Settings = {
  groupCount: number;
  minGroupSize: number;
  maxGroupSize: number;
  wSkillCover: string;
  wWeakTie: string;
  wBalance: string;
  wHistoryAvoid: string;
  wArtifact: string;
  wProcess: string;
  wPeer: string;
  fairShareThreshold: string;
  delayTriggerDays: number;
  idleTriggerDays: number;
};

/** 课程设置（规格书 P-24 的 S1 子集）：分组规模、四维权重、证据权重、预警阈值。 */
export default function CourseSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, error, isLoading } = useSWR<{ settings: Settings }>(
    `/api/courses/${id}/settings`,
    fetcher
  );

  const [form, setForm] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const current = form ?? (data?.settings ?? null);

  function patch(p: Partial<Settings>) {
    if (!current) return;
    setForm({ ...current, ...p });
  }

  const evidenceSum = current
    ? Number(current.wArtifact) + Number(current.wProcess) + Number(current.wPeer)
    : 0;
  const evidenceOk = Math.abs(evidenceSum - 1) <= 0.011;
  const sizeOk = current ? current.minGroupSize <= current.maxGroupSize : true;

  async function save() {
    if (!current) return;
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch(`/api/courses/${id}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupCount: current.groupCount,
          minGroupSize: current.minGroupSize,
          maxGroupSize: current.maxGroupSize,
          wSkillCover: Number(current.wSkillCover),
          wWeakTie: Number(current.wWeakTie),
          wBalance: Number(current.wBalance),
          wHistoryAvoid: Number(current.wHistoryAvoid),
          wArtifact: Number(current.wArtifact),
          wProcess: Number(current.wProcess),
          wPeer: Number(current.wPeer),
          fairShareThreshold: Number(current.fairShareThreshold),
          delayTriggerDays: current.delayTriggerDays,
          idleTriggerDays: current.idleTriggerDays
        })
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? '保存失败');
      }
      setMessage('已保存');
      setForm(null);
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <section className="flex-1">
        <Skeleton className="h-96" />
      </section>
    );
  }

  if (error || !current) {
    return (
      <section className="flex-1">
        <p className="text-sm text-destructive">设置加载失败。</p>
      </section>
    );
  }

  return (
    <section className="flex-1">
      <h1 className="mb-6 text-lg lg:text-2xl font-medium">分组策略与权重</h1>

      <div className="max-w-2xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>分组规模</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>建议组数</Label>
              <Input type="number" min={1} max={50} value={current.groupCount} onChange={(e) => patch({ groupCount: Number(e.target.value) })} />
            </div>
            <div className="space-y-1">
              <Label>每组最少</Label>
              <Input type="number" min={1} max={8} value={current.minGroupSize} onChange={(e) => patch({ minGroupSize: Number(e.target.value) })} />
            </div>
            <div className="space-y-1">
              <Label>每组最多</Label>
              <Input type="number" min={1} max={8} value={current.maxGroupSize} onChange={(e) => patch({ maxGroupSize: Number(e.target.value) })} />
            </div>
            {!sizeOk && <p className="text-sm text-destructive sm:col-span-3">最少人数不能大于最多人数</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>目标函数权重（0–2）</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <WeightSlider label="技能覆盖度" value={Number(current.wSkillCover)} onChange={(v) => patch({ wSkillCover: String(v) })} max={2} />
            <WeightSlider label="弱连接引入度" value={Number(current.wWeakTie)} onChange={(v) => patch({ wWeakTie: String(v) })} max={2} />
            <WeightSlider label="组间均衡度" value={Number(current.wBalance)} onChange={(v) => patch({ wBalance: String(v) })} max={2} />
            <WeightSlider label="历史搭档规避" value={Number(current.wHistoryAvoid)} onChange={(v) => patch({ wHistoryAvoid: String(v) })} max={2} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>三类证据权重（合计 1.0，当前 {evidenceSum.toFixed(2)}）</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <WeightSlider label="产出物证据" value={Number(current.wArtifact)} onChange={(v) => patch({ wArtifact: String(v) })} max={1} />
            <WeightSlider label="过程证据" value={Number(current.wProcess)} onChange={(v) => patch({ wProcess: String(v) })} max={1} />
            <WeightSlider label="同伴证据" value={Number(current.wPeer)} onChange={(v) => patch({ wPeer: String(v) })} max={1} />
            {!evidenceOk && <p className="text-sm text-destructive">合计必须为 1.00</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>预警阈值</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>关键路径延误触发（天）</Label>
              <Input type="number" min={0} max={30} value={current.delayTriggerDays} onChange={(e) => patch({ delayTriggerDays: Number(e.target.value) })} />
            </div>
            <div className="space-y-1">
              <Label>成员失联触发（天）</Label>
              <Input type="number" min={1} max={30} value={current.idleTriggerDays} onChange={(e) => patch({ idleTriggerDays: Number(e.target.value) })} />
            </div>
            <div className="space-y-1">
              <Label>搭便车提示阈值（应分担占比）</Label>
              <Input type="number" min={0} max={1} step={0.01} value={Number(current.fairShareThreshold)} onChange={(e) => patch({ fairShareThreshold: String(e.target.value) })} />
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-4">
          <Button disabled={saving || !evidenceOk || !sizeOk} onClick={save}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            保存设置
          </Button>
          {message && <span className="text-sm text-muted-foreground">{message}</span>}
        </div>
      </div>
    </section>
  );
}

function WeightSlider({
  label,
  value,
  onChange,
  max
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  max: number;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <Label>{label}</Label>
        <span className="tabular-nums text-muted-foreground">{value.toFixed(2)}</span>
      </div>
      <Slider min={0} max={max} step={0.05} value={[value]} onValueChange={([v]) => onChange(v)} />
    </div>
  );
}
