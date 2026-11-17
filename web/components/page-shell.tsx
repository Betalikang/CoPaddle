import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * 页面骨架：全站唯一的标题 / 面包屑 / 宽度 / 间距来源。
 *
 * 之前每个页面各自写 `<section className="flex-1">` + 自己的 h1 字号，
 * 导致同层级页面标题从 text-lg 到 text-2xl 不等、最大宽度也各不相同。
 * 新增页面请一律套 PageShell，不要再手写页头。
 */

export type Crumb = { label: string; href?: string };

export function PageShell({
  title,
  description,
  breadcrumbs,
  actions,
  children,
  width = 'default',
  className
}: {
  title: ReactNode;
  /** 一句话说明「这页能做什么」，不要写功能清单 */
  description?: ReactNode;
  breadcrumbs?: Crumb[];
  /** 页头右侧操作区（主按钮最多一个） */
  actions?: ReactNode;
  children: ReactNode;
  /** default = 阅读宽度（表单/账本）；wide = 数据密度宽度（看板/拖拽台） */
  width?: 'default' | 'wide';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'mx-auto w-full',
        width === 'wide' ? 'max-w-[1400px]' : 'max-w-5xl',
        className
      )}
    >
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav
          aria-label="面包屑"
          className="mb-3 flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
        >
          {breadcrumbs.map((crumb, index) => (
            <span key={`${crumb.label}-${index}`} className="flex items-center gap-1">
              {index > 0 && <ChevronRight className="size-3 opacity-50" aria-hidden />}
              {crumb.href ? (
                <Link
                  href={crumb.href}
                  // py-1 让面包屑链接在触屏上有 24px 高的点击区（实测原高 16px，
                  // 375px 下手指点「课程工作台」经常点空）；行高不变，视觉仍是小字
                  className="inline-flex items-center py-1 underline-offset-2 hover:text-foreground hover:underline"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span className="text-foreground/70">{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}

      <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
        <div className="min-w-0">
          {/* 页标题用 text-title 字阶（clamp 1.5→2rem）而不是固定 text-xl：
              上一版所有层级挤在 20px 附近，一页里标题、小节标题、正文看起来差不多大。
              tracking 收紧 + line-height 由 globals 的 h1 规则统一。 */}
          <h1 className="text-title font-semibold text-balance">{title}</h1>
          {description && (
            <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {/* actions 不再 shrink-0：375px 下三个按钮（含组选择器）合计约 374px，
          超过 375 - 32 的可用宽度，原来会把整个文档撑宽 16px（实测 /artifacts 页 391px）。
          现在允许它在窄屏内部换行并右对齐，宽屏仍是一行。 */}
        {actions && (
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{actions}</div>
        )}
      </header>

      <div className="mt-6">{children}</div>
    </div>
  );
}

/**
 * 内容面板：页内每个独立话题一块，取代原来层层嵌套的 Card/CardHeader/CardContent。
 * 一页最多 4~5 块；能合并成一组字段的，不要再切块。
 */
export function Panel({
  id,
  title,
  hint,
  actions,
  children,
  className,
  bodyClassName
}: {
  id?: string;
  title?: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section id={id} className={cn('rounded-lg border bg-card', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-medium">{title}</h2>}
            {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

/*
  提示条配色统一走语义色令牌（见 globals.css）。
  以前 warn 用 amber-900 文字、danger 用 --destructive，深浅两套变体各写一遍，
  且和页面里散落的 green-600 / rose-700 完全对不上。
*/
const CALLOUT_TONE = {
  success: 'border-success/40 bg-success/10 text-success',
  warn: 'border-warning/40 bg-warning/10 text-warning',
  danger: 'border-danger/40 bg-danger/10 text-danger',
  info: 'border-border bg-muted/40 text-muted-foreground'
} as const;

/** 页内提示条：替代原来的整块 Alert Card。 */
export function Callout({
  tone = 'warn',
  title,
  children
}: {
  tone?: keyof typeof CALLOUT_TONE;
  title?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={cn('rounded-lg border px-4 py-3 text-sm', CALLOUT_TONE[tone])}>
      {title && <p className="mb-1 font-medium">{title}</p>}
      {children}
    </div>
  );
}
