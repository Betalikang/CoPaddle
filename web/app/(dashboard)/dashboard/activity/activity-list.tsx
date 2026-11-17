'use client';

import {
  Settings,
  LogOut,
  UserPlus,
  Lock,
  UserCog,
  UserMinus,
  Mail,
  CheckCircle,
  type LucideIcon,
} from 'lucide-react';
import { Pager, usePagination } from '@/components/ui/pager';

/**
 * 活动流水的一行。
 *
 * `action` 保留数据库枚举的字符串形态：这里刻意不 import `@/lib/db/schema`，
 * 那个模块会把 drizzle 一起带进客户端包，而枚举值与展示的映射只在本文件需要。
 */
export type ActivityRow = {
  id: number;
  action: string;
  ipAddress: string | null;
  timestamp: Date | string;
};

const PAGE_SIZE = 20;

const iconMap: Record<string, LucideIcon> = {
  SIGN_UP: UserPlus,
  SIGN_IN: UserCog,
  SIGN_OUT: LogOut,
  UPDATE_PASSWORD: Lock,
  DELETE_ACCOUNT: UserMinus,
  UPDATE_ACCOUNT: Settings,
  CREATE_TEAM: UserPlus,
  REMOVE_TEAM_MEMBER: UserMinus,
  INVITE_TEAM_MEMBER: Mail,
  ACCEPT_INVITATION: CheckCircle,
};

function getRelativeTime(date: Date) {
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return '刚刚';
  if (diffInSeconds < 3600)
    return `${Math.floor(diffInSeconds / 60)} 分钟前`;
  if (diffInSeconds < 86400)
    return `${Math.floor(diffInSeconds / 3600)} 小时前`;
  if (diffInSeconds < 604800)
    return `${Math.floor(diffInSeconds / 86400)} 天前`;
  return date.toLocaleDateString();
}

function formatAction(action: string): string {
  switch (action) {
    case 'SIGN_UP':
      return '你注册了账号';
    case 'SIGN_IN':
      return '你登录了账号';
    case 'SIGN_OUT':
      return '你退出了账号';
    case 'UPDATE_PASSWORD':
      return '你修改了密码';
    case 'DELETE_ACCOUNT':
      return '你注销了账号';
    case 'UPDATE_ACCOUNT':
      return '你更新了账号信息';
    case 'CREATE_TEAM':
      return '你创建了团队';
    case 'REMOVE_TEAM_MEMBER':
      return '你移除了团队成员';
    case 'INVITE_TEAM_MEMBER':
      return '你邀请了团队成员';
    case 'ACCEPT_INVITATION':
      return '你接受了邀请';
    default:
      return '未知操作';
  }
}

/**
 * 「最近活动」列表（客户端）：账号审计流水会永久累积，一页 20 条。
 * 由 `activity/page.tsx`（服务端组件）传入全量 logs，Panel 的 hint 仍显示全量条数。
 */
export function ActivityList({ logs }: { logs: ActivityRow[] }) {
  const logPager = usePagination(logs, PAGE_SIZE);

  return (
    <>
      <ul className="divide-y">
        {logPager.pageItems.map((log) => {
          const Icon = iconMap[log.action] || Settings;
          const formattedAction = formatAction(log.action);

          return (
            <li key={log.id} className="flex items-center gap-3 px-4 py-3">
              <div className="rounded-full bg-muted p-2">
                <Icon className="size-4 text-muted-foreground" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {formattedAction}
                  {log.ipAddress && (
                    <span className="text-muted-foreground"> · IP {log.ipAddress}</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {getRelativeTime(new Date(log.timestamp))}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      <Pager {...logPager.pagerProps} unit="条" className="px-4 pb-4" />
    </>
  );
}
