/**
 * 班级卡片外壳：名单管理与课程页共用，保证班级设计一致。
 * 小组管理放在 ClassShell 内部（children），形成「班级 > 小组」层级。
 *
 * 这里刻意不用 Card 组件：ClassShell 通常嵌在 Panel 正文里，
 * Card 自带的圆角+边框会与 Panel 形成双层框，读起来像两个同级区块。
 */
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';

export type ClassSummary = {
  id: number;
  name: string;
  memberCount: number;
  groupCount: number;
};

export function ClassShell({
  classInfo,
  href,
  actions,
  children,
  hint
}: {
  classInfo: ClassSummary;
  /** 「查看名单」等入口；与名单管理互相跳转 */
  href?: string;
  actions?: ReactNode;
  /** 小组管理等子区块，嵌在班级内 */
  children?: ReactNode;
  hint?: string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <div className="flex flex-row flex-wrap items-center gap-2 px-4 py-3">
        <UsersIcon />
        <h3 className="text-sm font-medium">{classInfo.name}</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{classInfo.memberCount} 人</Badge>
          <Badge variant="outline">{classInfo.groupCount} 组</Badge>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {href && (
            <Link
              href={href}
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              名单管理
            </Link>
          )}
          {actions}
        </div>
      </div>
      {(hint || children) && (
        <div className="space-y-3 border-t px-4 py-3">
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          {children}
        </div>
      )}
    </div>
  );
}

/** 班级内可折叠的「小组管理」子区块 */
export function GroupPanelInClass({
  open,
  onToggle,
  activeCount,
  dissolvedCount,
  children
}: {
  open: boolean;
  onToggle: () => void;
  activeCount: number;
  dissolvedCount: number;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border bg-muted/30">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="text-sm font-medium">小组管理</span>
        <Badge variant="secondary" className="font-normal">
          {activeCount} 组进行中
          {dissolvedCount > 0 ? ` · ${dissolvedCount} 已解散` : ''}
        </Badge>
        <span className="ml-auto text-xs text-muted-foreground">
          {open ? '收起' : '展开'}
        </span>
      </button>
      {open && <div className="border-t px-3 py-3">{children}</div>}
    </div>
  );
}

function UsersIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0 text-muted-foreground"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
