'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { use } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronRight,
  CircleDashed,
  Loader2
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageShell, Panel, Callout } from '@/components/page-shell';
import { QueryError } from '@/components/query-state';
import { swrFetcher } from '@/lib/api/client';
import type { CourseReadiness } from '@/lib/services/readiness';
import { courseNavGroups } from '@/lib/course-nav';

const ROLE_LABEL: Record<string, string> = {
  teacher: '教师',
  assistant: '助教',
  captain: '队长',
  member: '队员'
};

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  active: '进行中',
  archived: '已归档'
};

type CourseDetail = {
  course?: {
    id: number;
    name: string;
    code: string | null;
    term: string;
    status: string;
    description: string | null;
  };
  settings?: Record<string, unknown>;
  myRole?: string;
};

/**
 * 课程首页 = 概览，不再是入口目录。
 *
 * 导航全部在左侧栏里，所以这页只回答三个问题：
 * 这门课现在什么状态、分组参数是怎么设的、我接下来该点哪里。
 */
export default function CourseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, isLoading, mutate } = useSWR<CourseDetail>(
    `/api/courses/${id}`,
    swrFetcher
  );

  if (isLoading) {
    return (
      <PageShell title="课程" description="正在加载课程信息…">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-4 h-40" />
      </PageShell>
    );
  }

  // 读失败（403/404/5xx）走统一错误态：说清原因 + 可重试，不再伪装成「课程不存在」
  if (error) {
    return (
      <PageShell
        breadcrumbs={[{ label: '课程工作台', href: '/dashboard' }]}
        title="课程"
        description="读取课程信息时出错。"
      >
        <QueryError error={error} onRetry={() => void mutate()} title="课程信息加载失败" />
      </PageShell>
    );
  }

  if (!data?.course) {
    return (
      <PageShell
        breadcrumbs={[{ label: '课程工作台', href: '/dashboard' }]}
        title="课程不存在"
        description="这门课程可能已被归档，或你不在名单里。"
      >
        <span />
      </PageShell>
    );
  }

  const course = data.course;
  const myRole = data.myRole ?? 'member';
  const settings = data.settings ?? {};
  const isTeacherSide = myRole === 'teacher' || myRole === 'assistant';

  // 从同一份导航配置里取「下一步」，避免再抄一遍路径与文案
  const flat = courseNavGroups(id, myRole).flatMap((group) => group.items);
  const nextHrefs =
    myRole === 'teacher' || myRole === 'assistant'
      ? ['/roster', '/grouping', '/alerts']
      : ['/skill-card', '/my-tasks', '/contributions'];
  const nextSteps = nextHrefs
    .map((suffix) => flat.find((item) => item.href.endsWith(suffix)))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <PageShell
      breadcrumbs={[{ label: '课程工作台', href: '/dashboard' }, { label: course.name }]}
      title={course.name}
      description={course.description ?? '左侧栏按「准备 → 分组 → 执行 → 协作 → 复盘」排列，点哪段都可以直接进去。'}
      actions={
        <Badge variant={course.status === 'active' ? 'default' : 'secondary'}>
          {STATUS_LABEL[course.status] ?? course.status}
        </Badge>
      }
    >
      <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {course.code && <span>课程代码 {course.code}</span>}
        <span>{course.term}</span>
        <span>我的角色：{ROLE_LABEL[myRole] ?? myRole}</span>
      </div>

      {course.status === 'archived' && (
        <div className="mb-4">
          <Callout tone="warn" title="这门课程已归档，现在是只读的">
            名单、分组、任务、成绩都还能查看和导出，但改设置、重新分组、改任务状态、发布互评等写操作会被服务端拒绝。
            需要继续上课就先把课程改回「进行中」。
          </Callout>
        </div>
      )}

      {isTeacherSide && <ReadinessPanel courseId={id} basePath={`/dashboard/courses/${id}`} />}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="下一步" bodyClassName="p-0">
          <ul className="divide-y">
            {nextSteps.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                >
                  <item.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{item.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.desc}
                    </span>
                  </span>
                  <ChevronRight
                    className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="分组参数" bodyClassName="p-0">
          <dl className="divide-y text-sm">
            <SummaryRow label="建议组数" value={fmt(settings.groupCount)} />
            <SummaryRow
              label="每组人数"
              value={
                settings.minGroupSize !== undefined && settings.maxGroupSize !== undefined
                  ? `${fmt(settings.minGroupSize)}–${fmt(settings.maxGroupSize)} 人`
                  : '—'
              }
            />
            <SummaryRow
              label="目标权重"
              value={`技能 ${fmt(settings.wSkillCover)} · 弱连接 ${fmt(settings.wWeakTie)} · 均衡 ${fmt(
                settings.wBalance
              )} · 历史 ${fmt(settings.wHistoryAvoid)}`}
            />
            <SummaryRow
              label="证据权重"
              value={`产出 ${fmt(settings.wArtifact)} · 过程 ${fmt(settings.wProcess)} · 同伴 ${fmt(
                settings.wPeer
              )}`}
            />
          </dl>
        </Panel>
      </div>
    </PageShell>
  );
}

/**
 * 教师端「准备情况」面板。
 *
 * 把「名单 40 人 / 技能卡 38 人 / 分组走到哪一步」摊开，并直接给出下一步按钮。
 * 之前课程首页只有三个静态入口链接，教师不知道自己卡在哪：名单导了但技能卡没填，
 * 或者填完了点生成却因为规模约束无解，页面上都只有一个「生成分组方案」按钮。
 *
 * 这里刻意不复用 PageShell 的「下一步」列表：那个列表是固定导航，不含状态。
 */
function ReadinessPanel({ courseId, basePath }: { courseId: string; basePath: string }) {
  const { data, error, isLoading, mutate } = useSWR<CourseReadiness>(
    `/api/courses/${courseId}/readiness`,
    swrFetcher
  );

  if (isLoading) {
    return (
      <Panel title="准备情况">
        <Skeleton className="h-24" />
      </Panel>
    );
  }

  if (error) {
    return (
      <Panel title="准备情况">
        <QueryError
          error={error}
          onRetry={() => void mutate()}
          title="准备情况加载失败"
          hint="这不影响其它页面：名单、分组、任务都可以正常进入。"
          compact
        />
      </Panel>
    );
  }

  if (!data) return null;

  const { students, settings, grouping, feasibility, stage } = data;
  const blocking = feasibility.issues.filter((i) => i.code !== 'GAP_TOO_LARGE');
  const warnings = feasibility.issues.filter((i) => i.code === 'GAP_TOO_LARGE');
  const skillCardReady = students.total > 0 && students.skillCardMissing === 0;

  return (
    <Panel
      title="准备情况"
      hint={stage.title}
      actions={
        <StageAction stage={stage} basePath={basePath} planCount={grouping.planCount} />
      }
    >
      <div className="space-y-3">
        <ol className="grid gap-2 sm:grid-cols-3">
          <ReadinessStep
            done={students.total > 0}
            label="导入名单"
            value={students.total > 0 ? `${students.total} 名学生` : '还没有学生'}
            href={`${basePath}/roster`}
          />
          <ReadinessStep
            done={skillCardReady}
            warn={students.total > 0 && students.skillCardMissing > 0}
            label="技能卡"
            value={
              students.total === 0
                ? '—'
                : `${students.skillCardFilled}/${students.total} 人已填`
            }
            href={`${basePath}/roster`}
          />
          <ReadinessStep
            done={grouping.activeGroupCount > 0 || grouping.planCount > 0}
            label="分组方案"
            value={
              grouping.activeGroupCount > 0
                ? `已选定 ${grouping.activeGroupCount} 组`
                : grouping.planCount > 0
                  ? `${grouping.planCount} 套待选`
                  : '还没生成'
            }
            href={`${basePath}/grouping`}
          />
        </ol>

        {/*
          规模约束先天不可行时，教师点「生成分组方案」只会得到一句「无可行解」。
          这里提前把差多少人说清，并给出能直接填的数值。
        */}
        {blocking.length > 0 && (
          <Callout tone="warn" title="按当前设置分不出组，先改参数">
            <ul className="space-y-1.5">
              {blocking.map((issue) => (
                <li key={issue.code}>
                  <span className="block">{issue.message}</span>
                  <span className="block text-xs text-muted-foreground">{issue.suggestion}</span>
                </li>
              ))}
            </ul>
            <Link
              href={`${basePath}/settings`}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium underline underline-offset-4"
            >
              去改分组策略
              <ArrowRight className="size-3" aria-hidden />
            </Link>
          </Callout>
        )}

        {warnings.length > 0 && (
          <Callout tone="info" title="规模设置的提醒">
            <ul className="space-y-1">
              {warnings.map((issue) => (
                <li key={issue.code}>{issue.message}</li>
              ))}
            </ul>
          </Callout>
        )}

        {students.total > 0 && students.skillCardMissing > 0 && (
          <p className="text-xs text-muted-foreground">
            还有 {students.skillCardMissing} 人没填技能卡，分组会按「无自评」处理（技能维度偏弱）。
            这不阻断生成，可以先分再补。
          </p>
        )}

        {feasibility.mayFallBackToGreedy && (
          <p className="text-xs text-muted-foreground">
            {students.total} 人超过了精确求解上限，可能退化为快速模式（结果不保证最优）。
          </p>
        )}

        {stage.stage === 'infeasible' && grouping.latestRun?.createdAt && (
          <p className="text-xs text-muted-foreground">
            上次求解时间 {formatWhen(grouping.latestRun.createdAt)}
            {grouping.latestRun.errorDetail ? `：${grouping.latestRun.errorDetail}` : ''}
          </p>
        )}

        {grouping.activeGroupCount === 0 && grouping.planCount > 0 && (
          <p className="text-xs text-muted-foreground">
            方案还没选定：选定后才会生成正式小组，成员才能在「我的部分」看到自己的任务。
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          当前设置：{settings.groupCount} 组 · 每组 {settings.minGroupSize}–{settings.maxGroupSize} 人
          {settings.allowCrossClass ? ' · 允许跨班' : ' · 不跨班'}
        </p>
      </div>
    </Panel>
  );
}

/** 阶段对应的主按钮：让「下一步该点哪里」变成一次点击，而不是自己去侧栏找。 */
function StageAction({
  stage,
  basePath,
  planCount
}: {
  stage: CourseReadiness['stage'];
  basePath: string;
  planCount: number;
}) {
  const cls =
    'inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted/60';

  if (stage.stage === 'roster-empty') {
    return (
      <Link href={`${basePath}/roster`} className={cls}>
        去导入名单
        <ArrowRight className="size-3" aria-hidden />
      </Link>
    );
  }
  if (stage.stage === 'running') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        求解中
      </span>
    );
  }
  if (stage.stage === 'plans-ready') {
    return (
      <Link href={`${basePath}/grouping`} className={cls}>
        去选定方案（{planCount} 套）
        <ArrowRight className="size-3" aria-hidden />
      </Link>
    );
  }
  if (stage.stage === 'selected') {
    return (
      <Link href={`${basePath}/tasks`} className={cls}>
        去拆解任务
        <ArrowRight className="size-3" aria-hidden />
      </Link>
    );
  }
  return (
    <Link href={`${basePath}/grouping`} className={cls}>
      {stage.stage === 'not-generated' ? '去生成分组' : '去重新求解'}
      <ArrowRight className="size-3" aria-hidden />
    </Link>
  );
}

function ReadinessStep({
  done,
  warn,
  label,
  value,
  href
}: {
  done: boolean;
  warn?: boolean;
  label: string;
  value: string;
  href: string;
}) {
  const Icon = done ? Check : warn ? AlertTriangle : CircleDashed;
  const tone = done ? 'text-success' : warn ? 'text-warning' : 'text-muted-foreground';
  return (
    <li>
      <Link
        href={href}
        className="flex items-start gap-2 rounded-md border px-3 py-2 transition-colors hover:bg-muted/40"
      >
        <Icon className={`mt-0.5 size-4 shrink-0 ${tone}`} aria-hidden />
        <span className="min-w-0">
          <span className="block text-xs font-medium">{label}</span>
          <span className="block truncate text-xs text-muted-foreground">{value}</span>
        </span>
      </Link>
    </li>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="text-right text-xs tabular-nums">{value}</dd>
    </div>
  );
}

function fmt(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? (Number.isInteger(n) ? String(n) : n.toFixed(2)) : String(value);
}
