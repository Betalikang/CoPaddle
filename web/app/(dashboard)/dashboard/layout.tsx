'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Users, Settings, Shield, Activity, Bell, History, Menu } from 'lucide-react';

export default function DashboardLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const navItems = [
    { href: '/dashboard', icon: Users, label: '课程工作台' },
    { href: '/dashboard/general', icon: Settings, label: '账号设置' },
    { href: '/dashboard/activity', icon: Activity, label: '活动记录' },
    { href: '/dashboard/security', icon: Shield, label: '安全设置' },
    { href: '/dashboard/notifications', icon: Bell, label: '通知中心' },
    { href: '/dashboard/audit', icon: History, label: '审计与 AI 日志' }
  ];

  const nav = (
    <nav className="p-4">
      {navItems.map((item) => (
        <Link key={item.href} href={item.href} passHref>
          <Button
            variant={pathname === item.href ? 'secondary' : 'ghost'}
            className={`shadow-none my-1 w-full justify-start ${
              pathname === item.href ? 'bg-gray-100' : ''
            }`}
            onClick={() => setIsSidebarOpen(false)}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Button>
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="w-full">
      {/* Mobile header */}
      <div className="lg:hidden flex items-center justify-between bg-white border-b border-gray-200 p-4">
        <span className="font-medium">设置</span>
        <Button
          className="-mr-3"
          variant="ghost"
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
        >
          <Menu className="h-6 w-6" />
          <span className="sr-only">切换侧边栏</span>
        </Button>
      </div>

      <div className="lg:flex lg:items-start">
        {/* 桌面端：sticky 侧栏，贴左常驻 */}
        <aside className="hidden lg:block w-64 shrink-0 bg-gray-50 border-r border-gray-200 lg:sticky lg:top-[57px] lg:h-[calc(100dvh-57px)]">
          <div className="h-full overflow-y-auto">{nav}</div>
        </aside>

        {/* 移动端：抽屉式侧栏 */}
        {isSidebarOpen && (
          <aside className="fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-gray-200 lg:hidden">
            <div className="h-full overflow-y-auto">{nav}</div>
          </aside>
        )}

        {/* 主内容：贴顶排布，页面级滚动 */}
        <main className="flex-1 min-w-0 p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
