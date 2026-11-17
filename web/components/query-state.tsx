'use client';

import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, Lock, LogIn, RotateCw, SearchX, WifiOff } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Callout, Panel } from '@/components/page-shell';
import { describeApiError, isApiError, redirectToSignIn, type ApiErrorKind } from '@/lib/api/client';

/**
 * 读请求的四种稳定状态：加载 / 无数据 / 无权限 / 出错可重试。
 *
 * 为什么要有它：以前每个页面自己写 error 分支，措辞与行为都不同——有的显示
 * 「加载失败」，有的把 403 的空数组渲染成「还没有数据」，有的干脆什么都不显示。
 * 这里把「现在的状态是什么、下一步能做什么」定死，页面只负责传 isError/isLoading。
 */

const KIND_ICON: Record<ApiErrorKind, LucideIcon> = {
  unauthorized: LogIn,
  forbidden: Lock,
  'not-found': SearchX,
  http: AlertTriangle,
  network: WifiOff,
  timeout: WifiOff,
  'invalid-response': AlertTriangle
};

const KIND_TITLE: Record<ApiErrorKind, string> = {
  unauthorized: '登录已过期',
  forbidden: '没有这个页面的权限',
  'not-found': '内容不存在',
  http: '加载失败',
  network: '网络连接失败',
  timeout: '请求超时',
  'invalid-response': '服务响应异常'
};

/** 401 的下一步是登录，其余可重试的都是「重试」。 */
function kindAction(kind: ApiErrorKind): 'signin' | 'retry' | 'none' {
  if (kind === 'unauthorized') return 'signin';
  if (kind === 'forbidden' || kind === 'not-found') return 'none';
  return 'retry';
}

export function QueryError({
  error,
  onRetry,
  /** 覆盖默认标题，比如「课程列表加载失败」 */
  title,
  hint,
  compact = false
}: {
  error: unknown;
  onRetry?: () => void;
  title?: ReactNode;
  hint?: ReactNode;
  compact?: boolean;
}) {
  const kind: ApiErrorKind = isApiError(error) ? error.kind : 'http';
  const Icon = KIND_ICON[kind];
  const action = kindAction(kind);
  const canRetry = action === 'retry' && Boolean(onRetry);

  const body = (
    <div className="flex flex-col items-start gap-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon className="size-4" aria-hidden />
        {title ?? KIND_TITLE[kind]}
      </div>
      <p className="text-sm text-muted-foreground" role="alert">
        {describeApiError(error)}
      </p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {action === 'signin' && (
        <Button size="sm" variant="outline" onClick={() => redirectToSignIn()}>
          <LogIn className="size-4" aria-hidden />
          去登录
        </Button>
      )}
      {canRetry && (
        <Button size="sm" variant="outline" onClick={() => onRetry?.()}>
          <RotateCw className="size-4" aria-hidden />
          重试
        </Button>
      )}
    </div>
  );

  if (compact) {
    return (
      <Callout tone={kind === 'forbidden' || kind === 'unauthorized' ? 'warn' : 'danger'}>
        {body}
      </Callout>
    );
  }
  return <Panel>{body}</Panel>;
}

/** 无权访问：明确说「你没权限」而不是渲染空数据。 */
export function NoAccessState({
  title = '你没有这个页面的权限',
  hint,
  action
}: {
  title?: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Panel>
      <div className="flex flex-col items-start gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Lock className="size-4 text-warning" aria-hidden />
          {title}
        </div>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
        {action}
      </div>
    </Panel>
  );
}

/** 载入骨架：页面主区域一块，避免各页 h-40 / h-64 乱写。 */
export function QuerySkeleton({ className = 'h-40' }: { className?: string }) {
  return <Skeleton className={`${className} w-full`} />;
}

/**
 * 统一的「列表加载中 / 出错 / 空空 / 有数据」四态包装。
 *
 * 用它就不用每个页面重复写 `{isLoading && …} {error && …} {empty && …}`，
 * 也就不会漏掉某一态导致白屏。
 *
 * 优先级是 error > isLoading > isEmpty > children：
 * 出过错之后即使正在重新请求，也继续显示错误（带重试）而不是退回骨架，
 * 否则用户点「重试」会看到界面抖回骨架、失败后又变回同一条错误，像是没反应。
 */
export function QueryState({
  isLoading,
  error,
  isEmpty,
  onRetry,
  errorTitle,
  errorHint,
  skeletonClassName,
  empty,
  children
}: {
  isLoading: boolean;
  error: unknown;
  isEmpty: boolean;
  onRetry?: () => void;
  errorTitle?: ReactNode;
  errorHint?: ReactNode;
  skeletonClassName?: string;
  /** 空状态节点，仅在 isEmpty 为真时渲染 */
  empty?: ReactNode;
  /** 有数据时渲染的内容 */
  children?: ReactNode;
}) {
  if (error) {
    return <QueryError error={error} onRetry={onRetry} title={errorTitle} hint={errorHint} />;
  }
  if (isLoading) return <QuerySkeleton className={skeletonClassName} />;
  if (isEmpty) return <>{empty ?? null}</>;
  return <>{children}</>;
}

/** 空状态的默认图标，页面没特别指定时用。 */
export const EmptyIcon = Inbox;