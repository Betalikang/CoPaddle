'use client';

import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Panel } from '@/components/page-shell';
import { EmptyState } from '@/components/empty-state';
import { QueryError } from '@/components/query-state';
import { fmtDate, type ContractData, type Member } from './task-shared';

/**
 * 协作契约面板（含读失败提示 + 发布按钮）。
 *
 * 契约读失败不能静默：面板会整块消失，看起来像「本组没有契约」，
 * 所以 error 非空时先渲染一条紧凑的 QueryError，再按 latest 决定渲染面板。
 */
export default function TaskContract({
  contract,
  error,
  members,
  groupId,
  onRetry,
  onPublished
}: {
  /** SWR 首帧是 undefined，与页面的 `contract?.latest` 判断保持一致 */
  contract: ContractData | undefined;
  error: unknown;
  members: Member[];
  groupId: number;
  onRetry: () => void;
  onPublished: () => void;
}) {
  return (
    <>
      {Boolean(error) && (
        <QueryError
          error={error}
          onRetry={onRetry}
          title="协作契约加载失败"
          compact
        />
      )}
      {contract?.latest && (
        <Panel
          title={`协作契约 v${contract.latest.version}`}
          hint={`${new Set(contract.acceptances?.map((a) => a.userId) ?? []).size} / ${members.length} 人已签署`}
          actions={
            <>
              {contract.latest.publishedAt ? (
                <Badge variant="default">已发布</Badge>
              ) : (
                <Badge variant="secondary">草稿</Badge>
              )}
              <PublishButton
                groupId={groupId}
                published={!!contract.latest.publishedAt}
                onDone={onPublished}
              />
            </>
          }
        >
          {contract.glossary.length === 0 ? (
            <EmptyState compact icon={BookOpen} title="这份契约还没有术语条目。" />
          ) : (
            <dl className="divide-y text-sm">
              {contract.glossary.map((g) => (
                <div key={g.id} className="flex flex-wrap gap-x-2 py-1.5 first:pt-0 last:pb-0">
                  <dt className="font-medium">{g.term}</dt>
                  <dd className="text-muted-foreground">{g.definition}</dd>
                  {g.unit && <dd className="text-muted-foreground">（单位：{g.unit}）</dd>}
                </div>
              ))}
            </dl>
          )}
          {contract.latest.publishedAt && (
            <div className="mt-3 border-t pt-3 text-xs text-muted-foreground">
              {(() => {
                const signed = new Set(contract.acceptances.map((a) => a.userId));
                const pending = members.filter((m) => !signed.has(m.userId));
                const when = fmtDate(contract.latest.publishedAt);
                return `发布于 ${when} · ${
                  pending.length === 0
                    ? '全员已签署。'
                    : `待签署：${pending.map((m) => m.name ?? `#${m.userId}`).join('、')}`
                }`;
              })()}
            </div>
          )}
        </Panel>
      )}
    </>
  );
}

function PublishButton({
  groupId,
  published,
  onDone
}: {
  groupId: number;
  published?: boolean;
  onDone: () => void;
}) {
  const [publishing, setPublishing] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={publishing}
      onClick={async () => {
        setPublishing(true);
        try {
          // 已知缺陷：裸 fetch，不判 res.ok，失败也会走 onDone 重新拉数据（看起来像成功）。
          // 本次拆分只搬运不改行为；后续可换成 lib/api/client 的 apiSend 统一处理。
          await fetch(`/api/groups/${groupId}/contract`, { method: 'POST' });
          onDone();
        } finally {
          setPublishing(false);
        }
      }}
    >
      {publishing ? '发布中…' : published ? '重新发布' : '发布契约，通知成员确认'}
    </Button>
  );
}