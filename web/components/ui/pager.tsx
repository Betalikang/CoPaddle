'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from 'cn';

/**
 * 列表分页原语：全站只保留这一份「第 a–b 条 · 共 n 条 + 上一页 / 页码 / 下一页」的实现。
 *
 * 用法：
 *   const p = usePagination(rows, 20);
 *   ...渲染 p.pageItems...
 *   <Pager {...p.pagerProps} unit="条" />
 *
 * 页码是 1 起的；items 变短（筛选、删除、重新拉数据）时 safePage 会自动收回到最后一页，
 * 不会停在空页上。一页装得下时 <Pager> 自己返回 null，调用方不必写条件。
 */
export function usePagination<T>(items: T[], pageSize: number) {
  const [page, setPage] = useState(1);
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(page, 1), pageCount);
  const start = (safePage - 1) * pageSize;
  const pageItems = useMemo(() => items.slice(start, start + pageSize), [items, start, pageSize]);
  return {
    page: safePage,
    pageCount,
    pageItems,
    start,
    pageSize,
    total,
    setPage,
    /** 直接摊给 <Pager {...pagerProps} unit="条" /> */
    pagerProps: { page: safePage, pageCount, total, start, pageSize, onChange: setPage }
  };
}

export function Pager({
  page,
  pageCount,
  total,
  start,
  pageSize,
  onChange,
  unit = '条',
  className
}: {
  page: number;
  pageCount: number;
  total: number;
  start: number;
  pageSize: number;
  onChange: (page: number) => void;
  unit?: string;
  className?: string;
}) {
  // 一页装得下就不显示分页条
  if (total <= pageSize) return null;
  const end = Math.min(start + pageSize, total);

  return (
    <div
      className={cn(
        'mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground',
        className
      )}
    >
      <span className="tabular-nums">
        第 {start + 1}–{end} {unit} · 共 {total} {unit}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          上一页
        </Button>
        <span className="tabular-nums">
          {page} / {pageCount}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-7"
          disabled={page >= pageCount}
          onClick={() => onChange(page + 1)}
        >
          下一页
        </Button>
      </div>
    </div>
  );
}
