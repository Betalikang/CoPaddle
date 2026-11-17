import Link from 'next/link';
import { BrandMark } from '@/components/brand-mark';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="flex justify-center">
          <BrandMark className="size-12 text-brand" />
        </div>
        <h1 className="mt-6 text-xl font-semibold tracking-tight">页面不存在</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          你访问的页面可能已被移除、改名，或你没有访问权限。
        </p>
        <Button asChild variant="outline" className="mt-6">
          <Link href="/dashboard">回到课程工作台</Link>
        </Button>
      </div>
    </div>
  );
}
