/**
 * 共桨品牌标志：以原圆环为骨，内嵌两道水波。
 * 全线条、无填充；颜色由 className 的 text-* / currentColor 控制。
 */
export function BrandMark({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* 圆环：延续原标志识别 */}
      <circle cx="16" cy="16" r="12.25" />
      {/* 水波两道：桨行水上 */}
      <path d="M8.4 15.6c2.1-1.35 4.1-1.35 6.2 0s4.1 1.35 6.2 0" />
      <path d="M8.4 20.4c2.1-1.35 4.1-1.35 6.2 0s4.1 1.35 6.2 0" />
    </svg>
  );
}
