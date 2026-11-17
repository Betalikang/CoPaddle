'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Callout, PageShell, Panel } from '@/components/page-shell';
import { QueryError } from '@/components/query-state';
import { isApiError, swrFetcher } from '@/lib/api/client';

/**
 * 页面级角色闸门（规格书 S2 的体验层补丁）。
 *
 * 真正的权限判定在 API 层（每个接口都过 assertCourseRole / guardGroup），
 * 这里只解决一个问题：学生手输 URL 打开教师专属页时，不该看到一堆可编辑表单
 * 和「0 班 0 人」这种由 403 兜底出来的空数据，而应该看到一句明确的说明。
 *
 * 侧边栏已按角色隐藏入口（web/lib/course-nav.ts），所以这里只处理直链访问。
 *
 * 关键区分（P0-1）：只有 403/401 才说明「你没有权限」。
 * 网络断、5xx、超时都不能说成没权限——那会让用户以为自己被降权，
 * 而实际只是没连上，重试就好。所以 error 要按 kind 分流。
 */

export const TEACHER_SIDE = ['teacher', 'assistant'];
export const STUDENT_SIDE = ['teacher', 'assistant', 'captain', 'member'];

/** 当前用户在该课程的角色（取自 GET /api/courses/[id] 的 myRole）。 */
export function useCourseRole(courseId: string | number) {
  const { data, isLoading, error, mutate } = useSWR<{ myRole?: string }>(
    `/api/courses/${courseId}`,
    swrFetcher
  );
  // 只有明确的授权错误才是「没权限」；其余归类为可重试的加载失败
  const authorizationError =
    isApiError(error) && (error.kind === 'forbidden' || error.kind === 'unauthorized');
  return {
    role: data?.myRole ?? '',
    loading: isLoading && !error,
    /** 授权失败：确定性地没权限 */
    denied: authorizationError,
    /** 其他错误：网络/服务异常，不是权限问题 */
    error: authorizationError ? null : error,
    retry: () => void mutate()
  };
}

function GateFrame({ courseId, title, description }: { courseId: string; title: string; description?: string }) {
  return (
    <PageShell
      title={title}
      description={description}
      breadcrumbs={[
        { label: '课程', href: `/dashboard/courses/${courseId}` },
        { label: title }
      ]}
    >
      <Panel>
        <Skeleton className="h-24 w-full" />
      </Panel>
    </PageShell>
  );
}

function DeniedFrame({ courseId, title }: { courseId: string; title: string }) {
  return (
    <PageShell
      title={title}
      breadcrumbs={[
        { label: '课程', href: `/dashboard/courses/${courseId}` },
        { label: title }
      ]}
    >
      <Panel>
        <div className="flex flex-col items-start gap-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldAlert className="size-4 text-warning" aria-hidden />
            仅教师与助教可访问
          </div>
          <Callout tone="warn" title="你没有这个页面的权限">
            该页面的数据与操作面向教师（如全班分组、预警、成绩导出）。
            你是本课程的学生成员，可以通过左侧「我的任务」「小组工作台」查看自己的内容；
            需要教师协助时请联系任课教师。
          </Callout>
          <Button asChild variant="outline" size="sm">
            <Link href={`/dashboard/courses/${courseId}`}>返回课程概览</Link>
          </Button>
        </div>
      </Panel>
    </PageShell>
  );
}

/** 角色读不出来（网络/5xx）：给重试，不冒充权限问题。 */
function GateErrorFrame({
  courseId,
  title,
  error,
  onRetry
}: {
  courseId: string;
  title: string;
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <PageShell
      title={title}
      breadcrumbs={[
        { label: '课程', href: `/dashboard/courses/${courseId}` },
        { label: title }
      ]}
    >
      <QueryError
        error={error}
        onRetry={onRetry}
        title="无法确认你在本课程的角色"
        hint="这不是权限问题：课程信息没取到，重试一次通常就好。"
      />
    </PageShell>
  );
}

/**
 * 角色闸门：命中 allowed 才渲染 children，否则渲染拒绝说明。
 * 校验完成前渲染骨架，避免「先闪一下表单再消失」。
 */
export function CourseRoleGate({
  courseId,
  title,
  allowed,
  children
}: {
  courseId: string | number;
  /** 拒绝态展示的页面标题，与真实页保持一致 */
  title: string;
  allowed: string[];
  children: ReactNode;
}) {
  const { role, loading, denied, error, retry } = useCourseRole(courseId);

  if (loading) return <GateFrame courseId={String(courseId)} title={title} />;
  if (error) {
    return (
      <GateErrorFrame
        courseId={String(courseId)}
        title={title}
        error={error}
        onRetry={retry}
      />
    );
  }
  if (denied) return <DeniedFrame courseId={String(courseId)} title={title} />;
  // 角色字段缺失（老接口/异常数据）：按无权限处理更安全，但要说明是数据问题
  if (!role) return <DeniedFrame courseId={String(courseId)} title={title} />;
  if (!allowed.includes(role)) return <DeniedFrame courseId={String(courseId)} title={title} />;
  return <>{children}</>;
}

/** 教师侧闸门（设置 / 分组 / 花名册 / 预警 / 互评 / 成绩）。 */
export function TeacherGate({
  courseId,
  title,
  children
}: {
  courseId: string | number;
  title: string;
  children: ReactNode;
}) {
  return (
    <CourseRoleGate courseId={courseId} title={title} allowed={TEACHER_SIDE}>
      {children}
    </CourseRoleGate>
  );
}
