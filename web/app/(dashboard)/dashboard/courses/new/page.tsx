'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';

/** 建课向导（规格书 P-03）：①基本信息 ②分组策略 ③邀请学生 ④完成。 */
export default function NewCoursePage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

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
    setSubmitting(true);
    setError('');
    try {
      // 1) 建课
      const createRes = await fetch('/api/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), code: code.trim() || undefined, term, description: description.trim() || undefined })
      });
      if (!createRes.ok) throw new Error((await createRes.json()).error ?? '建课失败');
      const { course } = await createRes.json();

      // 2) 分组策略
      const settingsRes = await fetch(`/api/courses/${course.id}/settings`, {
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
      if (!settingsRes.ok) throw new Error((await settingsRes.json()).error ?? '分组策略保存失败');

      // 3) 名单导入（可选）
      const lines = emails
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length > 0) {
        const csv = ['email', ...lines].join('\n');
        const importRes = await fetch(`/api/courses/${course.id}/enrollments/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csv })
        });
        if (!importRes.ok) throw new Error((await importRes.json()).error ?? '名单导入失败');
      }

      // 4) 进入课程
      await fetch('/api/me/switch-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId: course.id })
      });
      router.push(`/dashboard/courses/${course.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败，请重试');
      setSubmitting(false);
    }
  }

  return (
    <section className="flex-1">
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/dashboard')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-lg lg:text-2xl font-medium">新建课程</h1>
        <span className="text-sm text-muted-foreground">第 {step} / 4 步</span>
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>基本信息</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>分组策略</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
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
                <div className="space-y-1">
                  <div className="flex justify-between text-sm"><Label>技能覆盖度</Label><span>{wSkill.toFixed(2)}</span></div>
                  <Slider min={0} max={2} step={0.05} value={[wSkill]} onValueChange={([v]) => setWSkill(v)} />
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm"><Label>弱连接引入度</Label><span>{wWeakTie.toFixed(2)}</span></div>
                  <Slider min={0} max={2} step={0.05} value={[wWeakTie]} onValueChange={([v]) => setWWeakTie(v)} />
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm"><Label>组间均衡度</Label><span>{wBalance.toFixed(2)}</span></div>
                  <Slider min={0} max={2} step={0.05} value={[wBalance]} onValueChange={([v]) => setWBalance(v)} />
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm"><Label>历史搭档规避</Label><span>{wHistory.toFixed(2)}</span></div>
                  <Slider min={0} max={2} step={0.05} value={[wHistory]} onValueChange={([v]) => setWHistory(v)} />
                </div>
            </div>

            <div className="space-y-4">
              <p className="text-sm font-medium">
                三类证据权重（合计须为 1.0，当前 {evidenceSum.toFixed(2)}）
              </p>
              <div className="space-y-1">
                <div className="flex justify-between text-sm"><Label>产出物证据</Label><span>{wArtifact.toFixed(2)}</span></div>
                <Slider min={0} max={1} step={0.05} value={[wArtifact]} onValueChange={([v]) => setWArtifact(v)} />
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-sm"><Label>过程证据</Label><span>{wProcess.toFixed(2)}</span></div>
                <Slider min={0} max={1} step={0.05} value={[wProcess]} onValueChange={([v]) => setWProcess(v)} />
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-sm"><Label>同伴证据</Label><span>{wPeer.toFixed(2)}</span></div>
                <Slider min={0} max={1} step={0.05} value={[wPeer]} onValueChange={([v]) => setWPeer(v)} />
              </div>
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
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>邀请学生（可跳过）</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
                提交后自动加入名单；学生首次登录需通过密码重置设置密码（完整邮件邀请流后续版本提供）。
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
          </CardContent>
        </Card>
      )}

      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle>确认并创建</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ul className="space-y-1 text-muted-foreground">
              <li>课程：{name}（{term}）</li>
              <li>分组：{groupCount} 组，每组 {minSize}–{maxSize} 人</li>
              <li>目标权重：技能 {wSkill.toFixed(2)} / 弱连接 {wWeakTie.toFixed(2)} / 均衡 {wBalance.toFixed(2)} / 历史 {wHistory.toFixed(2)}</li>
              <li>证据权重：产出物 {wArtifact.toFixed(2)} / 过程 {wProcess.toFixed(2)} / 同伴 {wPeer.toFixed(2)}</li>
              <li>待邀请学生：{emails.split(/\r?\n/).filter((l) => l.trim()).length} 人</li>
            </ul>
            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(3)}>
                <ArrowLeft className="mr-1 h-4 w-4" /> 上一步
              </Button>
              <Button disabled={submitting} onClick={submit}>
                <Check className="mr-1 h-4 w-4" />
                {submitting ? '创建中…' : '创建课程'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
