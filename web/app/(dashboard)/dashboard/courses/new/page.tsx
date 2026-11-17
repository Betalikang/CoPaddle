'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Callout, PageShell, Panel } from '@/components/page-shell';

/** 后续步骤统一校验：非 2xx 抛错，文案优先用服务端 error（避免把 404 HTML 当成 JSON 解析）。 */
async function ensureOk(res: Response, fallback: string) {
  if (res.ok) return;
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  throw new Error((body && body.error) || fallback);
}

/** 建课向导（规格书 P-03）：①基本信息 ②分组策略 ③邀请学生 ④完成。 */
export default function NewCoursePage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  /** 建课一旦成功就记住 course.id：后续步骤失败也不允许再建第二门同名课 */
  const [createdCourseId, setCreatedCourseId] = useState<number | null>(null);
  /** 双击守卫：setSubmitting 是异步渲染，快速双击时靠 ref 挡住第二次提交 */
  const inFlight = useRef(false);

  // ① 基本信息
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [term, setTerm] = useState('2026-2027-1');
  const [description, setDescription] = useState('');

  // ② 分组策略（默认值对齐规格书 S4.2）
  const [groupCount, setGroupCount] = useState(8);
  const [minSize, setMinSize] = useState(3);
  const [maxSize, setMaxSize] = useState(6);
  const [wSkill, setWSkill] = useState(1.2);
  const [wWeakTie, setWWeakTie] = useState(0.8);
  const [wBalance, setWBalance] = useState(1.0);
  const [wHistory, setWHistory] = useState(1.0);
  const [wArtifact, setWArtifact] = useState(0.5);
  const [wProcess, setWProcess] = useState(0.3);
  const [wPeer, setWPeer] = useState(0.2);

  // ③ 邀请学生（每行一个邮箱，完成时作为名单导入）
  const [emails, setEmails] = useState('');

  const evidenceSum = wArtifact + wProcess + wPeer;
  const evidenceOk = Math.abs(evidenceSum - 1) <= 0.011;
  const sizeOk = minSize <= maxSize;

  const step1Valid = name.trim().length > 0;

  async function submit() {
    // in-flight / 已建课：两条都要挡，否则慢网下双击会建出两门同名课程
    if (inFlight.current || createdCourseId !== null) return;
    inFlight.current = true;
    setSubmitting(true);
    setError('');
    let courseId: number | null = null;
    try {
      // 1) 建课
      const createRes = await fetch('/api/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), code: code.trim() || undefined, term, description: description.trim() || undefined })
      });
      const createBody = (await createRes.json().catch(() => null)) as
        | { course?: { id?: number }; error?: string }
        | null;
      const newCourseId = createBody?.course?.id;
      if (!createRes.ok || typeof newCourseId !== 'number') {
        throw new Error((createBody && createBody.error) || '建课失败');
      }
      courseId = newCourseId;
      // 立刻落地 course.id：后面 settings / 导入 / 切换上下文任一步失败，
      // 按钮都会变成「前往课程设置」，点它只会跳转，绝不会再建一门课
      setCreatedCourseId(courseId);

      // 2) 分组策略
      const settingsRes = await fetch(`/api/courses/${courseId}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupCount,
          minGroupSize: minSize,
          maxGroupSize: maxSize,
          wSkillCover: wSkill,
          wWeakTie,
          wBalance,
          wHistoryAvoid: wHistory,
          wArtifact,
          wProcess,
          wPeer
        })
      });
      await ensureOk(settingsRes, '分组策略保存失败');

      // 3) 名单导入（可选）
      const lines = emails
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length > 0) {
        const csv = ['email', ...lines].join('\n');
        const importRes = await fetch(`/api/courses/${courseId}/enrollments/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csv })
        });
        await ensureOk(importRes, '名单导入失败');
      }

      // 4) 进入课程
      const switchRes = await fetch('/api/me/switch-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId })
      });
      await ensureOk(switchRes, '切换课程失败');
      router.push(`/dashboard/courses/${courseId}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : '提交失败，请重试';
      // 课程已经建出来了：明确告知已落地，并把按钮换成跳转，避免用户再点一次建重复课
      setError(
        courseId === null
          ? reason
          : `课程已创建（#${courseId}），但${reason}。可点「前往课程设置」继续补完，无需重新创建。`
      );
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <PageShell
      breadcrumbs={[{ label: '课程工作台', href: '/dashboard' }, { label: '新建课程' }]}
      title="新建课程"
      description="填基本信息、定分组策略、导入名单，创建后直接进入课程。"
    >
      <div className="space-y-4">
        {error && <Callout tone="danger">{error}</Callout>}

        {step === 1 && (
          <Panel title="基本信息" hint="第 1 / 4 步 · 课程名称必填">
            <div className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="name">课程名称 *</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="如：数据分析基础" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="code">课程代码</Label>
                  <Input id="code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="如：MED203" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="term">学期</Label>
                  <Input id="term" value={term} onChange={(e) => setTerm(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="desc">课程简介</Label>
                <Textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
              </div>
              <div className="flex justify-end">
                <Button disabled={!step1Valid} onClick={() => setStep(2)}>
                  下一步 <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </div>
          </Panel>
        )}

        {step === 2 && (
          <Panel title="分组策略" hint="第 2 / 4 步 · 参数直接进入分组求解的目标函数">
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="gc">建议组数</Label>
                  <Input id="gc" type="number" min={1} max={50} value={groupCount} onChange={(e) => setGroupCount(Number(e.target.value))} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="mn">每组最少人数</Label>
                  <Input id="mn" type="number" min={1} max={8} value={minSize} onChange={(e) => setMinSize(Number(e.target.value))} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="mx">每组最多人数</Label>
                  <Input id="mx" type="number" min={1} max={8} value={maxSize} onChange={(e) => setMaxSize(Number(e.target.value))} />
                </div>
              </div>
              {!sizeOk && <p className="text-sm text-destructive">最少人数不能大于最多人数</p>}

              <div className="space-y-4">
                <p className="text-sm font-medium">目标函数权重（0–2，拖动实时预览）</p>
                <WeightSlider label="技能覆盖度" value={wSkill} onChange={setWSkill} max={2} />
                <WeightSlider label="弱连接引入度" value={wWeakTie} onChange={setWWeakTie} max={2} />
                <WeightSlider label="组间均衡度" value={wBalance} onChange={setWBalance} max={2} />
                <WeightSlider label="历史搭档规避" value={wHistory} onChange={setWHistory} max={2} />
              </div>

              <div className="space-y-4">
                <p className="text-sm font-medium">
                  三类证据权重（合计须为 1.0，当前 {evidenceSum.toFixed(2)}）
                </p>
                <WeightSlider label="产出物证据" value={wArtifact} onChange={setWArtifact} max={1} />
                <WeightSlider label="过程证据" value={wProcess} onChange={setWProcess} max={1} />
                <WeightSlider label="同伴证据" value={wPeer} onChange={setWPeer} max={1} />
                {!evidenceOk && (
                  <p className="text-sm text-destructive">三类证据权重合计必须为 1.00</p>
                )}
              </div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(1)}>
                  <ArrowLeft className="mr-1 h-4 w-4" /> 上一步
                </Button>
                <Button disabled={!sizeOk || !evidenceOk} onClick={() => setStep(3)}>
                  下一步 <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </div>
          </Panel>
        )}

        {step === 3 && (
          <Panel title="邀请学生" hint="第 3 / 4 步 · 可跳过，之后在名单页再导入">
            <div className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="emails">学生邮箱，每行一个</Label>
                <Textarea
                  id="emails"
                  rows={8}
                  value={emails}
                  onChange={(e) => setEmails(e.target.value)}
                  placeholder={'zhangsan@example.com\nlisi@example.com'}
                />
                <p className="text-xs text-muted-foreground">
                  提交后自动加入名单；学生首次登录需通过密码重置设置密码。
                </p>
              </div>
              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(2)}>
                  <ArrowLeft className="mr-1 h-4 w-4" /> 上一步
                </Button>
                <Button onClick={() => setStep(4)}>
                  下一步 <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </div>
          </Panel>
        )}

        {step === 4 && (
          <Panel
            title="确认并创建"
            hint={
              createdCourseId === null
                ? '第 4 / 4 步 · 创建后进入课程'
                : `第 4 / 4 步 · 课程已创建（#${createdCourseId}），后续设置可再补完`
            }
          >
            <div className="space-y-3 text-sm">
              <ul className="space-y-1 text-muted-foreground">
                <li>课程：{name}（{term}）</li>
                <li>分组：{groupCount} 组，每组 {minSize}–{maxSize} 人</li>
                <li>目标权重：技能 {wSkill.toFixed(2)} / 弱连接 {wWeakTie.toFixed(2)} / 均衡 {wBalance.toFixed(2)} / 历史 {wHistory.toFixed(2)}</li>
                <li>证据权重：产出物 {wArtifact.toFixed(2)} / 过程 {wProcess.toFixed(2)} / 同伴 {wPeer.toFixed(2)}</li>
                <li>待邀请学生：{emails.split(/\r?\n/).filter((l) => l.trim()).length} 人</li>
              </ul>
              <div className="flex justify-between pt-2">
                <Button variant="outline" disabled={submitting} onClick={() => setStep(3)}>
                  <ArrowLeft className="mr-1 h-4 w-4" /> 上一步
                </Button>
                {/* 课程已存在时这个按钮只做跳转，不会再发一次 POST /api/courses */}
                <Button
                  disabled={submitting}
                  onClick={() => {
                    if (createdCourseId !== null) {
                      router.push(`/dashboard/courses/${createdCourseId}/settings`);
                      return;
                    }
                    void submit();
                  }}
                >
                  <Check className="mr-1 h-4 w-4" />
                  {createdCourseId !== null ? '前往课程设置' : submitting ? '创建中…' : '创建课程'}
                </Button>
              </div>
            </div>
          </Panel>
        )}
      </div>
    </PageShell>
  );
}

/** 权重滑杆行：标签与当前值一行，滑杆在下。 */
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
      <Slider min={0} max={max} step={0.05} value={[value]} onValueChange={(values) => onChange(values[0] ?? 0)} />
    </div>
  );
}
