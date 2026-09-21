'use client';

import useSWR from 'swr';
import { use, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Skeleton } from '@/components/ui/skeleton';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

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
  const { data, isLoading } = useSWR<MyCard>(`/api/courses/${id}/skill-cards/me`, fetcher);

  const [skills, setSkills] = useState<Record<string, number>>({});
  const [availabilityText, setAvailabilityText] = useState('');
  const [selfNote, setSelfNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [initialized, setInitialized] = useState(false);

  // 首次拿到数据时回填
  if (data && !initialized) {
    setSkills(data.card?.skills ?? {});
    const avail = data.card?.availability ?? {};
    setAvailabilityText(
      Object.entries(avail)
        .map(([day, slots]) => `${day} ${slots.join(' ')}`)
        .join('\n')
    );
    setSelfNote(data.card?.selfNote ?? '');
    setInitialized(true);
  }

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
    setMessage('');
    try {
      const res = await fetch(`/api/courses/${id}/skill-cards/me`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skills,
          availability: parseAvailability(availabilityText),
          selfNote: selfNote.trim() || undefined
        })
      });
      if (!res.ok) throw new Error((await res.json()).error ?? '提交失败');
      setMessage('已保存。分组与分工都会参考这份技能卡。');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '提交失败');
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <section className="flex-1 p-4 lg:p-8">
        <Skeleton className="h-96" />
      </section>
    );
  }

  return (
    <section className="flex-1 p-4 lg:p-8">
      <h1 className="mb-2 text-lg lg:text-2xl font-medium">我的技能卡</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        七维能力自评（0 = 没接触过，5 = 能独立带人做）。这份卡用于分组互补与任务分工。
      </p>

      <div className="max-w-2xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>能力自评</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>可用时间</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              rows={4}
              value={availabilityText}
              onChange={(e) => setAvailabilityText(e.target.value)}
              placeholder={'mon 08:00-12:00\nwed 14:00-18:00'}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              每行一段：星期几（mon–sun）+ 时间段，可写多段。
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>自述</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              rows={3}
              value={selfNote}
              onChange={(e) => setSelfNote(e.target.value)}
              placeholder="想做的角色、想避开的合作对象（回避需教师审核后生效）等"
            />
          </CardContent>
        </Card>

        <div className="flex items-center gap-4">
          <Button disabled={saving} onClick={submit}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            保存技能卡
          </Button>
          {message && <span className="text-sm text-muted-foreground">{message}</span>}
        </div>
      </div>
    </section>
  );
}
