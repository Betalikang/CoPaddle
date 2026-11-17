import { PageShell, Panel } from '@/components/page-shell';
import { Skeleton } from '@/components/ui/skeleton';

/** 骨架也要用同一套页头，否则切换瞬间标题字号会跳一次。 */
export default function ActivityLoading() {
  return (
    <PageShell
      breadcrumbs={[{ label: '课程工作台', href: '/dashboard' }, { label: '活动记录' }]}
      title="活动记录"
      description="正在加载活动流水…"
    >
      <Panel title="最近活动" bodyClassName="p-0">
        <div className="divide-y">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="size-8 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </PageShell>
  );
}
