'use client';

import useSWR from 'swr';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { use } from 'react';
import {
  AlertTriangle,
  ClipboardCheck,
  BookOpenCheck,
  FileText,
  GitMerge,
  ScanSearch,
  ClipboardList,
  FileSpreadsheet,
  GitBranch,
  ListChecks,
  Settings,
  Users
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

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
  course: { id: number; name: string; code: string | null; term: string; status: string; description: string | null };
  settings: Record<string, unknown>;
  myRole: string;
};

/**
 * 课程首页：只做功能入口导航。
 * 班级 / 名单 / 小组管理统一在「名单管理」——班级卡片内嵌小组（与名单同一套 classId）。
 */
export default function CourseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = use(params);
  const { data, error, isLoading } = useSWR<CourseDetail>(`/api/courses/${id}`, fetcher);

  if (isLoading) {
    return (
      <section className="flex-1">
        <Skeleton className="mb-4 h-8 w-48" />
        <Skeleton className="h-40" />
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className="flex-1">
        <p className="text-sm text-destructive">课程不存在或无权访问。</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push('/dashboard')}>
          返回课程工作台
        </Button>
      </section>
    );
  }

  const { course, myRole } = data;
  const isTeacherSide = myRole === 'teacher' || myRole === 'assistant';

  return (
    <section className="flex-1">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-lg lg:text-2xl font-medium">
          {course.name}
          {course.code ? `（${course.code}）` : ''}
        </h1>
        <Badge variant={course.status === 'active' ? 'default' : 'secondary'}>
          {STATUS_LABEL[course.status] ?? course.status}
        </Badge>
        <Badge variant="outline">我的角色：{ROLE_LABEL[myRole] ?? myRole}</Badge>
        <span className="text-sm text-muted-foreground">{course.term}</span>
      </div>

      {course.description && (
        <p className="mb-6 max-w-2xl text-sm text-muted-foreground">{course.description}</p>
      )}

      {isTeacherSide ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <EntryCard href={`/dashboard/courses/${id}/roster`} icon={<Users className="h-5 w-5" />} title="名单管理" desc="班级、名单、技能卡进度；小组管理在班级卡片内" ready />
          <EntryCard href={`/dashboard/courses/${id}/settings`} icon={<Settings className="h-5 w-5" />} title="分组策略与权重" desc="组数规模、四项目标权重、三类证据权重与阈值" ready />
          <EntryCard href={`/dashboard/courses/${id}/grouping`} icon={<GitBranch className="h-5 w-5" />} title="分组工作台" desc="AI 生成三方案、拖动微调实时看分、破坏硬约束标红" ready />
          <EntryCard href={`/dashboard/courses/${id}/tasks`} icon={<ListChecks className="h-5 w-5" />} title="任务与依赖" desc="AI 拆解任务 DAG、分工指派、协作契约" ready />
          <EntryCard href={`/dashboard/courses/${id}/alerts`} icon={<AlertTriangle className="h-5 w-5" />} title="健康度与预警" desc="小组三维健康度、待处理预警、一键处理" ready />
          <EntryCard href={`/dashboard/courses/${id}/conflicts`} icon={<ScanSearch className="h-5 w-5" />} title="冲突中心" desc="依赖冲突自动检测、退回对齐/重指派/忽略" ready />
          <EntryCard href={`/dashboard/courses/${id}/replans`} icon={<GitMerge className="h-5 w-5" />} title="重规划中心" desc="三方案决策包（重新分配/缩减范围/组间补位）与采纳" ready />
          <EntryCard href={`/dashboard/courses/${id}/reviews`} icon={<ClipboardCheck className="h-5 w-5" />} title="同伴互评" desc="轮次管理、完成率、中位数排名、异常检测" ready />
          <EntryCard href={`/dashboard/courses/${id}/grades`} icon={<FileSpreadsheet className="h-5 w-5" />} title="成绩导出" desc="贡献区间+终审值+互评中位数+任务完成率 CSV" ready />
          <EntryCard href={`/dashboard/courses/${id}/contributions`} icon={<ClipboardList className="h-5 w-5" />} title="贡献账本" desc="区间估计、贡献构成、证据下钻、教师终审与申诉" ready />
          <EntryCard href={`/dashboard/courses/${id}/artifacts`} icon={<FileText className="h-5 w-5" />} title="交付物与溯源" desc="平台内分段撰写、diff 归属、汇编终稿" ready />
          <EntryCard href={`/dashboard/courses/${id}/skill-card`} icon={<FileSpreadsheet className="h-5 w-5" />} title="我的技能卡" desc="填写我的能力自评（30 秒）" ready />
        </div>
      ) : myRole === 'captain' ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <EntryCard href={`/dashboard/courses/${id}/tasks`} icon={<ListChecks className="h-5 w-5" />} title="小组任务" desc="AI 拆解任务 DAG、分工指派、协作契约" ready />
          <EntryCard href={`/dashboard/courses/${id}/skill-card`} icon={<FileSpreadsheet className="h-5 w-5" />} title="我的技能卡" desc="填写我的能力自评（30 秒）" ready />
          <EntryCard href={`/dashboard/courses/${id}/contributions`} icon={<ClipboardList className="h-5 w-5" />} title="我的贡献账本" desc="我的区间、构成与证据，可申诉" ready />
          <EntryCard href={`/dashboard/courses/${id}/reviews/mine`} icon={<ClipboardCheck className="h-5 w-5" />} title="同伴互评" desc="对组内成员五维评分，结果进入贡献账本" ready />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <EntryCard href={`/dashboard/courses/${id}/skill-card`} icon={<FileSpreadsheet className="h-5 w-5" />} title="我的技能卡" desc="填写我的能力自评（30 秒），分组与分工都依赖它" ready />
          <EntryCard href={`/dashboard/my-tasks`} icon={<BookOpenCheck className="h-5 w-5" />} title="我的部分" desc="我负责什么、依赖谁、何时必须交" ready />
          <EntryCard href={`/dashboard/courses/${id}/contributions`} icon={<ClipboardList className="h-5 w-5" />} title="我的贡献账本" desc="我的区间、构成与证据，可申诉" ready />
          <EntryCard href={`/dashboard/courses/${id}/reviews/mine`} icon={<ClipboardCheck className="h-5 w-5" />} title="同伴互评" desc="对组内成员五维评分，结果进入贡献账本" ready />
        </div>
      )}
    </section>
  );
}

function EntryCard({
  href,
  icon,
  title,
  desc,
  ready = false
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
  ready?: boolean;
}) {
  if (!ready) {
    return (
      <Card className="opacity-60">
        <CardHeader className="flex flex-row items-center gap-2 pb-1">
          {icon}
          <CardTitle className="text-base">{title}</CardTitle>
          <Badge variant="secondary" className="ml-auto">规划中</Badge>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">{desc}</CardContent>
      </Card>
    );
  }
  return (
    <Link href={href}>
      <Card className="h-full cursor-pointer transition-shadow hover:shadow-md">
        <CardHeader className="flex flex-row items-center gap-2 pb-1">
          {icon}
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">{desc}</CardContent>
      </Card>
    </Link>
  );
}
