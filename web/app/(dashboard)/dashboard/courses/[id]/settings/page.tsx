'use client';

import { TeacherGate } from '@/components/course-role-gate';
import useSWR from 'swr';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Skeleton } from '@/components/ui/skeleton';
import { PageShell } from '@/components/page-shell';
import { QueryError } from '@/components/query-state';
import { swrFetcher } from '@/lib/api/client';

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

/**
 * 分组策略与权重。
 *
 * 原来一个设置表单拆成 4 张卡片 + 页面底部保存按钮（长屏要滚到底才知道有没有保存）。
 * 现在：一块面板、按「规模 / 目标权重 / 证据权重 / 阈值」分区，保存条吸底并显示未保存状态。
 */
function CourseSettingsBody({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, error, isLoading, mutate } = useSWR<{
    settings: Settings;
    myRole?: string;
  }>(`/api/courses/${id}/settings`, swrFetcher);

  const [form, setForm] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const saved = data?.settings ?? null;
  const current = form ?? saved;

  function patch(p: Partial<Settings>) {
    if (!current) return;
    setForm({ ...current, ...p });
  }

  const evidenceSum = current
    ? Number(current.wArtifact) + Number(current.wProcess) + Number(current.wPeer)
    : 0;
  const evidenceOk = Math.abs(evidenceSum - 1) <= 0.011;
  const sizeOk = current ? current.minGroupSize <= current.maxGroupSize : true;
  const dirty = form !== null && saved !== null && serialize(form) !== serialize(saved);
  const blocked = !evidenceOk || !sizeOk;

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
      <PageShell title="分组策略与权重" description="正在加载课程设置…">
        <Skeleton className="h-96" />
      </PageShell>
    );
  }

  // 读失败要说清是 403 还是 5xx，并给重试入口；原来的空 <span /> 等于白屏。
  if (error) {
    return (
      <PageShell
        title="分组策略与权重"
        description="这些参数直接进入分组求解的目标函数，改完下一次求解生效。"
      >
        <QueryError
          error={error}
          onRetry={() => void mutate()}
          title="分组策略加载失败"
          hint="可能没有这门课的管理权限。"
        />
      </PageShell>
    );
  }

  if (!current) {
    return (
      <PageShell title="分组策略与权重" description="设置加载失败，可能没有这门课的管理权限。">
        <span />
      </PageShell>
    );
  }

  return (
    <PageShell
      breadcrumbs={[
        { label: '课程工作台', href: '/dashboard' },
        { label: '课程', href: `/dashboard/courses/${id}` },
        { label: '分组策略' }
      ]}
      title="分组策略与权重"
      description="这些参数直接进入分组求解的目标函数，改完下一次求解生效。"
    >
      <div className="rounded-lg border">
        <Section title="分组规模" hint="硬约束：每组人数必须落在区间内。">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="建议组数">
              <Input
                type="number"
                min={1}
                max={50}
                value={current.groupCount}
                onChange={(e) => patch({ groupCount: Number(e.target.value) })}
              />
            </Field>
            <Field label="每组最少">
              <Input
                type="number"
                min={1}
                max={8}
                value={current.minGroupSize}
                onChange={(e) => patch({ minGroupSize: Number(e.target.value) })}
              />
            </Field>
            <Field label="每组最多">
              <Input
                type="number"
                min={1}
                max={8}
                value={current.maxGroupSize}
                onChange={(e) => patch({ maxGroupSize: Number(e.target.value) })}
              />
            </Field>
          </div>
          {!sizeOk && (
            <p className="text-xs text-destructive">最少人数不能大于最多人数。</p>
          )}
        </Section>

        <Section title="目标函数权重" hint="四项之和不必为 1，求解时按相对大小加权（取值 0–2）。">
          <SliderRow
            label="技能覆盖度"
            value={Number(current.wSkillCover)}
            onChange={(v) => patch({ wSkillCover: String(v) })}
            max={2}
          />
          <SliderRow
            label="弱连接引入度"
            value={Number(current.wWeakTie)}
            onChange={(v) => patch({ wWeakTie: String(v) })}
            max={2}
          />
          <SliderRow
            label="组间均衡度"
            value={Number(current.wBalance)}
            onChange={(v) => patch({ wBalance: String(v) })}
            max={2}
          />
          <SliderRow
            label="历史搭档规避"
            value={Number(current.wHistoryAvoid)}
            onChange={(v) => patch({ wHistoryAvoid: String(v) })}
            max={2}
          />
        </Section>

        <Section title="三类证据权重" hint="贡献归因里三段证据的占比，合计必须为 1.00。">
          <SliderRow
            label="产出物证据"
            value={Number(current.wArtifact)}
            onChange={(v) => patch({ wArtifact: String(v) })}
            max={1}
          />
          <SliderRow
            label="过程证据"
            value={Number(current.wProcess)}
            onChange={(v) => patch({ wProcess: String(v) })}
            max={1}
          />
          <SliderRow
            label="同伴证据"
            value={Number(current.wPeer)}
            onChange={(v) => patch({ wPeer: String(v) })}
            max={1}
          />
          <p
            className={
              evidenceOk ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'
            }
          >
            当前合计 {evidenceSum.toFixed(2)}
            {evidenceOk ? '' : '，必须调整为 1.00 才能保存'}
          </p>
        </Section>

        <Section title="预警阈值" hint="调度与健康度判定用到的触发条件。">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="关键路径延误（天）">
              <Input
                type="number"
                min={0}
                max={30}
                value={current.delayTriggerDays}
                onChange={(e) => patch({ delayTriggerDays: Number(e.target.value) })}
              />
            </Field>
            <Field label="成员失联（天）">
              <Input
                type="number"
                min={1}
                max={30}
                value={current.idleTriggerDays}
                onChange={(e) => patch({ idleTriggerDays: Number(e.target.value) })}
              />
            </Field>
            <Field label="搭便车提示阈值">
              <Input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={Number(current.fairShareThreshold)}
                onChange={(e) => patch({ fairShareThreshold: String(e.target.value) })}
              />
            </Field>
          </div>
        </Section>
      </div>

      <div className="sticky bottom-4 z-10 mt-4 flex flex-wrap items-center gap-3 rounded-lg border bg-background/95 px-4 py-2.5 shadow-sm backdrop-blur">
        <span
          className={
            message && message !== '已保存' ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'
          }
        >
          {message || (dirty ? '有未保存的更改' : '已与保存值一致')}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" disabled={!dirty || saving} onClick={() => setForm(null)}>
            重置
          </Button>
          <Button disabled={saving || blocked || !dirty} onClick={save}>
            {saving && <Loader2 className="mr-1 size-4 animate-spin" />}
            保存
          </Button>
        </div>
      </div>
    </PageShell>
  );
}

/** 已保存值与表单值的归一化比较（数字统一三位小数，避免 0.5 vs "0.5" 误判）。 */
function serialize(value: Settings): string {
  const keys: (keyof Settings)[] = [
    'groupCount',
    'minGroupSize',
    'maxGroupSize',
    'delayTriggerDays',
    'idleTriggerDays'
  ];
  const numeric = keys.map((key) => Number(value[key]).toFixed(3)).join('|');
  const weights = [
    value.wSkillCover,
    value.wWeakTie,
    value.wBalance,
    value.wHistoryAvoid,
    value.wArtifact,
    value.wProcess,
    value.wPeer,
    value.fairShareThreshold
  ]
    .map((item) => Number(item).toFixed(3))
    .join('|');
  return `${numeric}#${weights}`;
}

function Section({
  title,
  hint,
  children
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-4 border-b px-4 py-5 last:border-b-0 sm:grid-cols-[180px_1fr] sm:gap-6 sm:px-6">
      <div>
        <h2 className="text-sm font-medium">{title}</h2>
        {hint && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function SliderRow({
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
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <Label className="text-sm font-normal">{label}</Label>
        <span className="text-xs tabular-nums text-muted-foreground">{value.toFixed(2)}</span>
      </div>
      <Slider
        min={0}
        max={max}
        step={0.05}
        value={[value]}
        onValueChange={(values: number[]) => onChange(values[0] ?? 0)}
      />
    </div>
  );
}

/** 页面级角色闸门：非教师/助教直链访问时给出明确说明，而不是渲染一堆 403。 */
export default function CourseSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <TeacherGate courseId={id} title="分组策略与权重">
      <CourseSettingsBody params={params} />
    </TeacherGate>
  );
}
