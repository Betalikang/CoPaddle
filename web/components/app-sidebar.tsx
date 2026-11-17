'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, Bell, ChevronRight, History, LayoutDashboard, Settings, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { courseNavGroups } from '@/lib/course-nav';

/**
 * 全站唯一的侧边栏。
 *
 * 上一版是「顶部横向 tab + 课程首页 12 张卡」，等于同一套导航在两个地方各写一遍，
 * 而且进入任意子页后侧栏仍然只有 5 个全局入口，课程内去哪都得先回首页。
 * 现在全部收进侧栏：上面是课程树（按流程 5 组），下面是全局入口。
 */

const HOME = { href: '/dashboard', label: '课程工作台', icon: LayoutDashboard };

const GLOBAL_ITEMS = [
  { href: '/dashboard/activity', label: '活动记录', icon: Activity },
  { href: '/dashboard/notifications', label: '通知中心', icon: Bell },
  { href: '/dashboard/audit', label: '审计与 AI 日志', icon: History },
  { href: '/dashboard/general', label: '账号设置', icon: Settings }
];

const ROLE_LABEL: Record<string, string> = {
  teacher: '教师',
  assistant: '助教',
  captain: '队长',
  member: '队员'
};

export function AppSidebar({
  courseId,
  courseName,
  role
}: {
  courseId?: string;
  courseName?: string;
  role?: string;
}) {
  const pathname = usePathname();
  const groups = courseId && role ? courseNavGroups(courseId, role) : [];
  const active = resolveActive(
    pathname,
    [HOME, ...GLOBAL_ITEMS, ...groups.flatMap((g) => g.items)].map((item) => item.href)
  );

  return (
    <div className="flex h-full flex-col">
      <nav aria-label="全站导航" className="flex-1 overflow-y-auto px-2 py-3">
        <SidebarLink {...HOME} active={active === HOME.href} />

        {courseId && (
          <div className="mt-4">
            <Link
              href={`/dashboard/courses/${courseId}`}
              className="group flex items-center gap-1 rounded-sm px-2.5 pb-1"
            >
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
                {courseName ?? '当前课程'}
              </span>
              <ChevronRight
                className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                aria-hidden
              />
            </Link>
            {role && (
              <p className="px-2.5 pb-1 text-xs text-muted-foreground">
                我的角色：{ROLE_LABEL[role] ?? role}
              </p>
            )}

            {!role && (
              <div className="mt-2 space-y-1.5 px-2.5">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-5 rounded-sm bg-muted/60" />
                ))}
              </div>
            )}

            {groups.map((group) => (
              <div key={group.key} className="mt-3">
                {/* text-xs（12px）而不是 text-[11px]：11px 在 375px 手机上
                    低于可读下限，且与「我的角色」行不一致。
                    分组标题用等宽数字感的字距 + 一抹极淡的上边线，
                    让「流程五段」在视觉上真的成段，而不是一串平铺链接。 */}
                <p className="mb-1 border-t border-border/70 px-2.5 pt-2 text-xs font-semibold tracking-[0.08em] text-muted-foreground/85 uppercase">
                  {group.label}
                </p>
                <div className="space-y-px">
                  {group.items.map((item) => (
                    <SidebarLink
                      key={item.href}
                      href={item.href}
                      label={item.label}
                      icon={item.icon}
                      active={active === item.href}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </nav>

      <div className="border-t px-2 py-3">
        {GLOBAL_ITEMS.map((item) => (
          <SidebarLink
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            active={active === item.href}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * 命中最长的那个前缀。
 *
 * 只写 `pathname.startsWith(href)` 会让 /reviews 与 /reviews/mine 同时高亮，
 * 所以这里在所有候选里挑匹配最长的一条，再拿它跟每个条目比对。
 */
function resolveActive(pathname: string, hrefs: string[]): string | undefined {
  const matched = hrefs.filter(
    (href) => pathname === href || pathname.startsWith(`${href}/`)
  );
  return matched.sort((a, b) => b.length - a.length)[0];
}

function SidebarLink({
  href,
  label,
  icon: Icon,
  active
}: {
  href: string;
  label: string;
  icon: typeof Users;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        // 选中态不用「整块灰底」：那会让侧栏看起来像一排按钮。
        // 改成左侧一道 2px 桨橙竖线 + 极淡底纹，位置感更清楚，橙色也只出现在这一处。
        'relative flex items-center gap-2 rounded-sm px-2.5 py-1.5 text-sm transition-colors',
        active
          ? 'bg-foreground/[0.055] font-semibold text-foreground'
          : 'text-muted-foreground hover:bg-foreground/[0.035] hover:text-foreground'
      )}
    >
      {active && (
        <span
          className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-brand"
          aria-hidden
        />
      )}
      <Icon className={cn('size-4 shrink-0', active ? 'opacity-100' : 'opacity-65')} aria-hidden />
      <span className="truncate">{label}</span>
    </Link>
  );
}
