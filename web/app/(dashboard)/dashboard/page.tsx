'use client';

import useSWR from 'swr';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import { BookOpen, Plus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

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

function CourseItem({ course }: { course: CourseCard }) {
  const router = useRouter();
  const [switching, setSwitching] = useState(false);

  async function open() {
    setSwitching(true);
    try {
      // 进入课程前先切上下文：角色随课程切换（规格书 B-01）
      await fetch('/api/me/switch-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId: course.id })
      });
      router.push(`/dashboard/courses/${course.id}`);
    } finally {
      setSwitching(false);
    }
  }

  return (
    <Card
      className="cursor-pointer transition-shadow hover:shadow-md"
      onClick={() => !switching && open()}
    >
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base font-medium">
          {course.name}
          {course.code ? `（${course.code}）` : ''}
        </CardTitle>
        <Badge variant={course.status === 'active' ? 'default' : 'secondary'}>
          {STATUS_LABEL[course.status] ?? course.status}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <Users className="h-4 w-4" />
            {course.memberCount} 人
          </span>
          <span>{course.term}</span>
          <Badge variant="outline">我的角色：{ROLE_LABEL[course.myRole] ?? course.myRole}</Badge>
        </div>
        <div className="text-xs">
          {switching ? '正在进入…' : '点击进入课程工作台'}
        </div>
      </CardContent>
    </Card>
  );
}

export default function CoursesHomePage() {
  const { data, error, isLoading } = useSWR<{ courses: CourseCard[] }>(
    '/api/me/courses',
    fetcher
  );

  const courses = data?.courses ?? [];

  return (
    <section className="flex-1 p-4 lg:p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg lg:text-2xl font-medium">课程工作台</h1>
        <Button asChild>
          <Link href="/dashboard/courses/new">
            <Plus className="mr-1 h-4 w-4" />
            新建课程
          </Link>
        </Button>
      </div>

      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive">课程列表加载失败，请刷新重试。</p>
      )}

      {!isLoading && !error && courses.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <BookOpen className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              还没有课程。建一门课，导入名单，就能开始分组与协作调度。
            </p>
            <Button asChild variant="outline">
              <Link href="/dashboard/courses/new">去建课</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {courses.map((c) => (
          <CourseItem key={c.id} course={c} />
        ))}
      </div>
    </section>
  );
}
