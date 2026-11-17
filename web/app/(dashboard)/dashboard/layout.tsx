'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import useSWR from 'swr';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { AppSidebar } from '@/components/app-sidebar';
import { useMounted } from '@/lib/use-mounted';
import { swrFetcher } from '@/lib/api/client';

type CourseBrief = { course?: { name?: string }; myRole?: string };

/** 桌面常驻侧栏的断点；移动抽屉进入该宽度时必须自动收起。 */
const DESKTOP_QUERY = '(min-width: 1024px)';

/**
 * 工作台外壳：左侧一条常驻侧栏，课程内导航也在里面。
 *
 * 课程 id 从路径里取（/dashboard/courses/<id>/...），课程名与我的角色取自
 * GET /api/courses/<id>（该接口同时返回 course / settings / myRole）。
 * 侧栏宽度固定 240px，桌面端 sticky，移动端抽屉。
 *
 * 移动抽屉走 Radix Dialog（components/ui/sheet.tsx）而不是手写遮罩：
 * 焦点移入面板、Esc 关闭、背景不可 Tab/不可点、关闭后焦点回到触发按钮，
 * 这些行为全部由 modal Dialog 提供，无需自己维护。
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const courseId = /^\/dashboard\/courses\/(\d+)/.exec(pathname)?.[1];
  const { data } = useSWR<CourseBrief>(courseId ? `/api/courses/${courseId}` : null, swrFetcher);

  // 路由变化后抽屉必须收起来，否则跳转完抽屉还盖在内容上
  useEffect(() => {
    setIsSidebarOpen(false);
  }, [pathname]);

  // 抽屉只在 lg 以下有意义：窗口拉宽到桌面断点时不收，会有一层挡住常驻侧栏的浮层
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(DESKTOP_QUERY);
    const syncWithViewport = () => {
      if (mq.matches) setIsSidebarOpen(false);
    };
    syncWithViewport();
    mq.addEventListener('change', syncWithViewport);
    return () => mq.removeEventListener('change', syncWithViewport);
  }, []);

  // 服务端拿不到角色与课程名，必须等到挂载后再用，否则首帧与客户端渲染不一致
  const mounted = useMounted();
  const courseName = mounted ? data?.course?.name : undefined;
  const role = mounted ? data?.myRole : undefined;

  const sidebar = <AppSidebar courseId={courseId} courseName={courseName} role={role} />;

  return (
    <div className="w-full">
      <Sheet open={isSidebarOpen} onOpenChange={setIsSidebarOpen}>
        {/* 移动端顶栏 */}
        <div className="flex items-center justify-between border-b bg-background p-3 lg:hidden">
          <span className="text-sm font-medium">{courseName ?? '共桨 CoPaddle'}</span>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="打开导航菜单">
              <Menu className="size-5" aria-hidden />
            </Button>
          </SheetTrigger>
        </div>

        {/* 移动端抽屉：SheetContent 是 Radix modal Dialog，自带焦点陷阱与 Esc 关闭 */}
        <SheetContent side="left" className="lg:hidden" aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>导航</SheetTitle>
          </SheetHeader>
          <div
            className="min-h-0 flex-1 overflow-y-auto"
            onClick={(event) => {
              // 点抽屉里的导航链接就收抽屉；用事件委托，避免逐个链接包一层
              if ((event.target as HTMLElement).closest('a')) setIsSidebarOpen(false);
            }}
          >
            {sidebar}
          </div>
        </SheetContent>
      </Sheet>

      <div className="lg:flex lg:items-start">
        {/* 桌面端侧栏 */}
        <aside className="hidden w-60 shrink-0 border-r bg-background lg:sticky lg:top-14 lg:block lg:h-[calc(100dvh-3.5rem)] lg:overflow-y-auto">
          {sidebar}
        </aside>

        <main className="min-w-0 flex-1 p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}