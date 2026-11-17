'use client';

import useSWR from 'swr';
import { use, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PageShell, Panel } from '@/components/page-shell';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Skeleton } from '@/components/ui/skeleton';
import { QueryError } from '@/components/query-state';
import { swrFetcher, apiSend, describeApiError } from '@/lib/api/client';

const SKILL_DIMS = [
  { key: '编程', hint: '写代码 / 搭环境' },
  { key: '写作', hint: '文档与表达' },
  { key: '设计', hint: '视觉与排版' },
  { key: '表达', hint: '汇报与演讲' },
  { key: '数据分析', hint: '统计与建模' },
  { key: '调研', hint: '查资料 / 访谈' },
  { key: '领导力', hint: '组织与推进' }
];

type MyCard = {
  card: {
    skills: Record<string, number>;
    availability: Record<string, string[]>;
    selfNote: string | null;
  } | null;
};

/** 技能卡填写（规格书 M-01）：30 秒可填完的设计。S1 版：七维滑条 + 可用时间 + 自述。 */
export default function SkillCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, isLoading, mutate } = useSWR<MyCard>(
    `/api/courses/${id}/skill-cards/me`,
    swrFetcher
  );

  const [skills, setSkills] = useState<Record<string, number>>({});
  const [availabilityText, setAvailabilityText] = useState('');
  const [selfNote, setSelfNote] = useState('');
  const [saving, setSaving] = useState(false);
  // 成败用显式状态而不是"文案以『已保存』开头"来推断：服务端改一个字颜色就错了，
  // 而且失败时用户看到的是灰字，容易当成保存成功直接离开。
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [initialized, setInitialized] = useState(false);

  // 首次拿到数据时回填：必须在 effect 里做，渲染期 setState 属于副作用（审计 #54）
  useEffect(() => {
    if (!data || initialized) return;
    setSkills(data.card?.skills ?? {});
    const avail = data.card?.availability ?? {};
    setAvailabilityText(
      Object.entries(avail)
        .map(([day, slots]) => `${day} ${slots.join(' ')}`)
        .join('\n')
    );
    setSelfNote(data.card?.selfNote ?? '');
    setInitialized(true);
  }, [data, initialized]);

  function parseAvailability(text: string): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [day, ...slots] = trimmed.split(/\s+/);
      if (day) out[day] = slots;
    }
    return out;
  }

  async function submit() {
    setSaving(true);
    setMessage(null);
    try {
      await apiSend(`/api/courses/${id}/skill-cards/me`, {
        method: 'POST',
        body: {
          skills,
          availability: parseAvailability(availabilityText),
          selfNote: selfNote.trim() || undefined
        }
      });
      setMessage({ ok: true, text: '已保存。分组与分工都会参考这份技能卡。' });
    } catch (err) {
      // 失败原因（403 / 校验不通过 / 服务端 5xx / 断网）由 describeApiError 统一给出，
      // 此前用裸 fetch + (await res.json()).error，响应不是 JSON 时会在解析处抛，
      // 用户看到的是一句技术性的解析错误。
      setMessage({ ok: false, text: `保存失败：${describeApiError(err)}` });
    } finally {
      setSaving(false);
    }
  }

  const crumbs = [
    { label: '课程工作台', href: '/dashboard' },
    { label: '课程', href: `/dashboard/courses/${id}` },
    { label: '我的技能卡' }
  ];

  if (isLoading) {
    return (
      <PageShell title="我的技能卡" breadcrumbs={crumbs}>
        <Skeleton className="h-96 w-full" />
      </PageShell>
    );
  }

  // 读失败不再退化成「全新技能卡」（全 0 滑条 + 空自述）：那会让人以为从没填过，
  // 一存就把服务端已有数据覆盖成空白。先如实报错并让用户重试。
  if (error) {
    return (
      <PageShell title="我的技能卡" breadcrumbs={crumbs}>
        <QueryError error={error} onRetry={() => void mutate()} title="技能卡加载失败" />
      </PageShell>
    );
  }

  return (
    <PageShell
      title="我的技能卡"
      breadcrumbs={crumbs}
      description="七维能力自评 + 可用时间 + 自述。分组互补与任务分工都会参考这份卡。"
    >
      <Panel bodyClassName="p-0" className="overflow-hidden">
        <div className="border-b px-4 py-4">
          <h2 className="text-sm font-medium">能力自评</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">0 = 没接触过，5 = 能独立带人做</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 sm:gap-x-8">
            {SKILL_DIMS.map((dim) => {
              const v = skills[dim.key] ?? 0;
              return (
                <div key={dim.key} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <Label>{dim.key}</Label>
                    <span className="tabular-nums text-muted-foreground">
                      {v} · {dim.hint}
                    </span>
                  </div>
                  <Slider
                    min={0}
                    max={5}
                    step={1}
                    value={[v]}
                    onValueChange={([nv]) => setSkills((s) => ({ ...s, [dim.key]: nv }))}
                  />
                </div>
              );
            })}
          </div>
        </div>

        <div className="border-b px-4 py-4">
          <h2 className="text-sm font-medium">可用时间</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            每行一段：星期几（mon–sun）+ 时间段，可写多段。
          </p>
          <Textarea
            className="mt-3"
            rows={4}
            value={availabilityText}
            onChange={(e) => setAvailabilityText(e.target.value)}
            placeholder={'mon 08:00-12:00\nwed 14:00-18:00'}
          />
        </div>

        <div className="px-4 py-4">
          <h2 className="text-sm font-medium">自述</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            想做的角色、想避开的合作对象（回避需教师审核后生效）。
          </p>
          <Textarea
            className="mt-3"
            rows={3}
            value={selfNote}
            onChange={(e) => setSelfNote(e.target.value)}
            placeholder="如：想做后端与数据；希望不要和上学期同组的人再合作。"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t bg-muted/20 px-4 py-3">
          <Button disabled={saving} onClick={submit}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            保存技能卡
          </Button>
          {message && (
            <span
              role="status"
              className={message.ok ? 'text-sm text-success' : 'text-sm text-destructive'}
            >
              {message.text}
            </span>
          )}
        </div>
      </Panel>
    </PageShell>
  );
}
