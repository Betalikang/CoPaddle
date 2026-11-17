import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * 统一空状态。
 *
 * 原先每个页面各自写 `<p className="py-6 text-center text-sm text-muted-foreground">还没有…</p>`，
 * 全站 20 多处，缩进、字号、有没有图标、有没有边框全都靠抄，
 * 于是同一句「还没有数据」在不同页里长得不一样。
 *
 * 约定：
 * - title 写「现在没有」，hint 写「怎么才会有」，action 放下一步按钮；
 * - 页面主区域用默认尺寸；表格、折叠块、抽屉里用 compact；
 * - 不希望出现虚线框时传 className="border-0 bg-transparent"。
 */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  compact = false,
  className
}: {
  icon?: LucideIcon;
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 text-center',
        compact ? 'py-4' : 'py-10',
        className
      )}
    >
      {Icon && <Icon className="mb-1 size-5 text-muted-foreground/60" aria-hidden />}
      <p className="text-sm text-muted-foreground">{title}</p>
      {hint && <p className="max-w-md text-xs text-muted-foreground/80">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
