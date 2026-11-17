'use client';

import Link from 'next/link';
import { useEffect, use, useState, Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { Bell, Home, LogOut } from 'lucide-react';
import { BrandMark } from '@/components/brand-mark';
import { ThemeToggle } from '@/components/theme-toggle';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { signOut } from '@/app/(login)/actions';
import { useRouter } from 'next/navigation';
import { User } from '@/lib/db/schema';
import useSWR, { mutate } from 'swr';
import { swrFetcher } from '@/lib/api/client';

/** 未读小红点（登录后才显示）。 */
function NotificationDot() {
  const { data } = useSWR<{ unread: number }>('/api/notifications', swrFetcher);
  if (!data || data.unread === 0) return null;
  return (
    <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive" />
  );
}

function UserMenu() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  // radix 组件（useId）在 React 19 + dev HMR 下 SSR/CSR id 不一致会触发
  // hydration mismatch：挂载前只渲染同尺寸占位，挂载后再渲染真实组件
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const { data: user } = useSWR<User>('/api/user', swrFetcher);
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    mutate('/api/user');
    router.push('/');
  }

  if (!mounted) {
    return <div className="size-9" />;
  }

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" className="rounded-full">
          <Link href="/sign-in">登录</Link>
        </Button>
        <Button asChild className="rounded-full">
          <Link href="/sign-up">注册</Link>
        </Button>
      </div>
    );
  }

  return (
    <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
      <DropdownMenuTrigger>
        <Avatar className="cursor-pointer size-9">
          <AvatarImage alt={user.name || ''} />
          <AvatarFallback>
            {user.email
              .split(' ')
              .map((n) => n[0])
              .join('')}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="flex flex-col gap-1">
        <DropdownMenuItem className="cursor-pointer">
          <Link href="/dashboard" className="flex w-full items-center">
            <Home className="mr-2 h-4 w-4" />
            <span>课程工作台</span>
          </Link>
        </DropdownMenuItem>
        <form action={handleSignOut} className="w-full">
          <button type="submit" className="flex w-full">
            <DropdownMenuItem className="w-full flex-1 cursor-pointer">
              <LogOut className="mr-2 h-4 w-4" />
              <span>退出登录</span>
            </DropdownMenuItem>
          </button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Header() {
  return (
    // 页头固定 56px，但不再只是一条白带：
    // 顶部压一条 2px 桨橙细线，全站每一页都带上同一个「装订线」，滚动时也不丢。
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
      <div className="h-0.5 w-full bg-brand" aria-hidden />
      {/* 内层减去 2px：页头总高仍是 56px，侧栏的 lg:top-14 与 h-[calc(100dvh-3.5rem)] 不用改 */}
      <div className="flex h-[calc(3.5rem-2px)] items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2">
          <BrandMark className="h-7 w-7 text-brand" />
          <span className="text-lg font-semibold tracking-tight">共桨 CoPaddle</span>
          <span className="ml-1 hidden text-xs text-muted-foreground sm:inline">
            AI 小组协作调度系统
          </span>
        </Link>
        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          <Link
            href="/dashboard/notifications"
            className="relative rounded-sm p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Bell className="h-5 w-5" />
            <span className="sr-only">通知</span>
            <NotificationDot />
          </Link>
          <Suspense fallback={<div className="h-9" />}>
            <UserMenu />
          </Suspense>
        </div>
      </div>
    </header>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <section className="flex min-h-[100dvh] flex-col">
      <Header />
      {children}
    </section>
  );
}
