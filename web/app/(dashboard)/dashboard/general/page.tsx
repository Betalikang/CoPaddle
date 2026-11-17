'use client';

import { useActionState, useState } from 'react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Lock, Trash2 } from 'lucide-react';
import { updateAccount, updatePassword, deleteAccount } from '@/app/(login)/actions';
import { User } from '@/lib/db/schema';
import { PageShell, Panel } from '@/components/page-shell';
import { QueryError, QuerySkeleton } from '@/components/query-state';
import { swrFetcher } from '@/lib/api/client';

type ActionState = {
  name?: string;
  error?: string;
  success?: string;
};

type PasswordState = {
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
  error?: string;
  success?: string;
};

type DeleteState = {
  password?: string;
  error?: string;
  success?: string;
};

function AccountForm({
  state,
  nameValue = '',
  emailValue = ''
}: {
  state: ActionState;
  nameValue?: string;
  emailValue?: string;
}) {
  return (
    <>
      <div>
        <Label htmlFor="name" className="mb-2">
          姓名
        </Label>
        <Input
          id="name"
          name="name"
          placeholder="请输入姓名"
          defaultValue={state.name || nameValue}
          required
        />
      </div>
      <div>
        <Label htmlFor="email" className="mb-2">
          邮箱
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="请输入邮箱"
          defaultValue={emailValue}
          required
        />
      </div>
    </>
  );
}

/**
 * 账号信息表单：字段 + 保存按钮一起受「数据是否读到」控制。
 *
 * 读失败时整块不给渲染（连提交按钮也没有），因为表单的值来自
 * `/api/user`，拿不到就是空串，提交等于把服务端的姓名和邮箱清空。
 */
function AccountFields({
  state,
  formAction,
  isPending
}: {
  state: ActionState;
  formAction: (formData: FormData) => void;
  isPending: boolean;
}) {
  const { data: user, error, isLoading, mutate } = useSWR<User>('/api/user', swrFetcher);

  if (error) {
    return (
      <QueryError
        error={error}
        compact
        title="账号信息没能读取，先别保存"
        hint="表单的值来自这次读取，读不到就会是空的；此时提交会把服务端的姓名和邮箱覆盖成空值。请先重试或刷新页面。"
        onRetry={() => void mutate()}
      />
    );
  }
  if (isLoading || !user) {
    return (
      <div className="space-y-2">
        <QuerySkeleton className="h-9" />
        <QuerySkeleton className="h-9" />
        <p className="text-xs text-muted-foreground">正在读取当前账号信息…</p>
      </div>
    );
  }

  return (
    <form className="space-y-4" action={formAction}>
      <AccountForm
        state={state}
        nameValue={user.name ?? ''}
        emailValue={user.email ?? ''}
      />
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.success && <p className="text-sm text-success">{state.success}</p>}
      <Button type="submit" disabled={isPending}>
        {isPending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            保存中…
          </>
        ) : (
          '保存修改'
        )}
      </Button>
    </form>
  );
}

/**
 * 账号设置 = 账号信息 + 改密 + 注销。
 *
 * 原来三张卡片各自上下堆叠、各带一个保存按钮，视觉上像三个互不相干的页面。
 * 现在一块面板按「账号信息 / 修改密码 / 注销账号」分节，危险操作固定在最后一节。
 */
export default function GeneralPage() {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(
    updateAccount,
    {}
  );
  const [passwordState, passwordAction, isPasswordPending] = useActionState<
    PasswordState,
    FormData
  >(updatePassword, {});
  const [deleteState, deleteAction, isDeletePending] = useActionState<
    DeleteState,
    FormData
  >(deleteAccount, {});
  // 注销是不可恢复操作，勾选确认后才允许提交（审计 #57）
  const [deleteAck, setDeleteAck] = useState(false);

  return (
    <PageShell
      breadcrumbs={[{ label: '课程工作台', href: '/dashboard' }, { label: '账号设置' }]}
      title="账号设置"
      description="姓名与邮箱决定你在名单和贡献账本里的显示方式。"
    >
      <div className="space-y-4">
        <Panel bodyClassName="p-0">
          <Section title="账号信息" hint="姓名会出现在分组名单与贡献账本里。">
            <AccountFields
              state={state}
              formAction={formAction}
              isPending={isPending}
            />
          </Section>

          <Section title="修改密码" hint="至少 6 位，最多 100 位。">
            <form className="space-y-4" action={passwordAction}>
              <div>
                <Label htmlFor="current-password" className="mb-2">
                  当前密码
                </Label>
                <Input
                  id="current-password"
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  required
                  minLength={6}
                  maxLength={100}
                  defaultValue={passwordState.currentPassword}
                />
              </div>
              <div>
                <Label htmlFor="new-password" className="mb-2">
                  新密码
                </Label>
                <Input
                  id="new-password"
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={6}
                  maxLength={100}
                  defaultValue={passwordState.newPassword}
                />
              </div>
              <div>
                <Label htmlFor="confirm-password" className="mb-2">
                  确认新密码
                </Label>
                <Input
                  id="confirm-password"
                  name="confirmPassword"
                  type="password"
                  required
                  minLength={6}
                  maxLength={100}
                  defaultValue={passwordState.confirmPassword}
                />
              </div>
              {passwordState.error && (
                <p className="text-sm text-destructive">{passwordState.error}</p>
              )}
              {passwordState.success && (
                <p className="text-sm text-success">
                  {passwordState.success}
                </p>
              )}
              <Button type="submit" disabled={isPasswordPending}>
                {isPasswordPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    更新中…
                  </>
                ) : (
                  <>
                    <Lock className="mr-2 h-4 w-4" />
                    更新密码
                  </>
                )}
              </Button>
            </form>
          </Section>

          <Section
            title="注销账号"
            hint="账号注销后不可恢复，你的课程与协作记录也会一并清除。"
          >
            <form
              action={deleteAction}
              className="space-y-4"
              onSubmit={(e) => {
                // 按钮 disabled 挡不住回车提交，这里再拦一道（审计 #57）
                if (!deleteAck) e.preventDefault();
              }}
            >
              <div>
                <Label htmlFor="delete-password" className="mb-2">
                  确认密码
                </Label>
                <Input
                  id="delete-password"
                  name="password"
                  type="password"
                  required
                  minLength={6}
                  maxLength={100}
                  defaultValue={deleteState.password}
                />
              </div>
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5">
                {/* py-1.5：复选框本体只有 16x16，靠 label 把可点区域撑到 ~40px 高，
                    手机上一指不会点到旁边去（移动端巡检把 16x16 记为热区过小） */}
                <label className="flex cursor-pointer items-start gap-2 py-1.5 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 accent-destructive"
                    checked={deleteAck}
                    onChange={(e) => setDeleteAck(e.target.checked)}
                  />
                  <span>
                    我已了解账号注销后不可恢复，我的课程与协作记录会一并清除。
                  </span>
                </label>
              </div>
              {deleteState.error && (
                <p className="text-sm text-destructive">{deleteState.error}</p>
              )}
              {deleteState.success && (
                <p className="text-sm text-success">
                  {deleteState.success}
                </p>
              )}
              <Button
                type="submit"
                variant="destructive"
                disabled={isDeletePending || !deleteAck}
              >
                {isDeletePending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    注销中…
                  </>
                ) : (
                  <>
                    <Trash2 className="mr-2 h-4 w-4" />
                    注销账号
                  </>
                )}
              </Button>
            </form>
          </Section>
        </Panel>
      </div>
    </PageShell>
  );
}

/** 面板内分节：左侧标题与说明，右侧表单，节与节之间用分隔线。 */
function Section({
  title,
  hint,
  children
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-4 border-b px-4 py-5 last:border-b-0 sm:grid-cols-[180px_1fr] sm:gap-6 sm:px-6">
      <div>
        <h2 className="text-sm font-medium">{title}</h2>
        {hint && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
