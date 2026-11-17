import { getActivityLogs } from '@/lib/db/queries';
import { History } from 'lucide-react';
import { PageShell, Panel } from '@/components/page-shell';
import { EmptyState } from '@/components/empty-state';
import { ActivityList } from './activity-list';

export default async function ActivityPage() {
  const logs = await getActivityLogs();

  return (
    <PageShell
      breadcrumbs={[{ label: '课程工作台', href: '/dashboard' }, { label: '活动记录' }]}
      title="活动记录"
      description="登录、账号与团队操作的留痕，按时间倒序。"
    >
      <Panel
        title="最近活动"
        hint={logs.length > 0 ? `共 ${logs.length} 条` : undefined}
        bodyClassName="p-0"
      >
        {logs.length > 0 ? (
          // 列表与分页在客户端组件里（本页是 async 服务端组件，不能直接用 hook）
          <ActivityList logs={logs} />
        ) : (
          <EmptyState
            icon={History}
            title="还没有活动记录"
            hint="登录、改密、更新账号等操作会出现在这里。"
          />
        )}
      </Panel>
    </PageShell>
  );
}
