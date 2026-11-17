'use client';

import useSWR from 'swr';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import { BookOpen, ChevronRight, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Callout, PageShell, Panel } from '@/components/page-shell';
import { EmptyState } from '@/components/empty-state';
import { QueryError } from '@/components/query-state';
import { Pager, usePagination } from '@/components/ui/pager';
import { apiSend, describeApiError, swrFetcher } from '@/lib/api/client';

type CourseCard = {
  id: number;
  name: string;
  code: string | null;
  term: string;
  status: string;
  myRole: string;
  memberCount: number;
};

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

/**
 * 一门课一行：课程名 + 状态 + 一行元信息。
 *
 * 原来每门课一张三行卡片（标题/人数/学期/角色/「点击进入」提示），
 * 四列网格一屏就是十几张卡。现在压成列表项，一屏能看完所有课。
 */
function CourseRow({ course }: { course: CourseCard }) {
  const router = useRouter();
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState('');

  async function open() {
    setSwitching(true);
    setError('');
    try {
      // 进入课程前先切上下文：角色随课程切换（规格书 B-01）。
      // 必须核对响应：切换失败还照跳，进去后看到的会是上一门课的角色视图，
      // 页面上一切正常、只是权限和数据和课程对不上——最难查的那种 bug。
      await apiSend<{ courseId?: number }>('/api/me/switch-context', {
        body: { courseId: course.id }
      });
      router.push(`/dashboard/courses/${course.id}`);
      // 成功后不 setSwitching(false)：组件马上随路由卸载，提前复位会让按钮闪一下
    } catch (e) {
      setError(describeApiError(e));
      setSwitching(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => !switching && void open()}
        className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 disabled:opacity-60"
        disabled={switching}
        aria-busy={switching}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{course.name}</span>
            {course.code && (
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{course.code}</span>
            )}
            <Badge variant={course.status === 'active' ? 'default' : 'secondary'}>
              {STATUS_LABEL[course.status] ?? course.status}
            </Badge>
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {course.term} · {course.memberCount} 人 · 我的角色：
            {ROLE_LABEL[course.myRole] ?? course.myRole}
          </span>
        </span>
        {switching ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRight
            className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        )}
      </button>
      {error && (
        <p role="alert" className="px-4 pb-2 text-xs text-destructive">
          无法进入《{course.name}》：{error}
        </p>
      )}
    </div>
  );
}

export default function CoursesHomePage() {
  const { data, error, isLoading, mutate } = useSWR<{ courses: CourseCard[] }>(
    '/api/me/courses',
    swrFetcher
  );

  const courses = data?.courses ?? [];
  // 分页：一位老师多年下来会攒下几十门课。hook 紧贴数据推导，位于任何条件回报之前。
  const coursePager = usePagination(courses, 12);
  const isEmpty = !isLoading && !error && courses.length === 0;

  return (
    <PageShell
      title="课程工作台"
      description="选一门课进去；课程内的导航都在左侧栏。"
      actions={
        <Button asChild>
          <Link href="/dashboard/courses/new">
            <Plus className="mr-1 h-4 w-4" />
            新建课程
          </Link>
        </Button>
      }
    >
      <div className="space-y-4">
        {isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}

        {error && (
          <QueryError error={error} onRetry={() => void mutate()} title="课程列表加载失败" />
        )}

        {isEmpty && (
          <Panel title="我的课程" bodyClassName="p-0">
            <EmptyState
              icon={BookOpen}
              title="还没有课程"
              hint="建一门课，导入名单，就能开始分组与协作调度。"
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/dashboard/courses/new">去建课</Link>
                </Button>
              }
            />
          </Panel>
        )}

        {!isLoading && !error && courses.length > 0 && (
          <Panel title="我的课程" hint={`共 ${courses.length} 门`} bodyClassName="p-0">
            <ul className="divide-y">
              {coursePager.pageItems.map((c) => (
                <li key={c.id}>
                  <CourseRow course={c} />
                </li>
              ))}
            </ul>
            <Pager {...coursePager.pagerProps} unit="门" className="px-4 pb-4" />
          </Panel>
        )}
      </div>
    </PageShell>
  );
}
