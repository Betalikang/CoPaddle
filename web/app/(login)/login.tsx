'use client';

import Link from 'next/link';
import { useActionState, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { BrandMark } from '@/components/brand-mark';
import { signIn, signUp } from './actions';
import { ActionState } from '@/lib/auth/middleware';
import type { DemoAccount, DemoLogin } from './demo-accounts';

/**
 * 登录页。
 *
 * ===== 为什么是两栏 =====
 * 上一版是一张居中白卡：全站入口第一眼没有任何信息量，只是「一个表单」。
 * 登录页其实是评委看到的第一屏，它应该回答「这是干什么的」。
 *
 * 所以左栏是墨色陈述面——放三件产品真正在意的事（求解、可核对、申诉入口），
 * 右栏才是表单。墨底与纸底在同一个页面里对比，比全白更让人记住。
 *
 * 窄屏（<lg）左栏折叠成顶部一条窄带：只保留品牌与一句话，
 * 不把陈述面塞进手机上方的首屏，否则表单被推到看不见的地方。
 */

/** 左栏的三条陈述。写具体机制，不写「高效」「赋能」。 */
const CLAIMS = [
  { k: '求解，不是随机', v: '技能互补、弱连接引入、组间均衡、历史规避四个目标同时优化；硬约束不满足的方案直接不产出。' },
  { k: '账本，不是分数', v: '贡献以区间呈现并附交付物证据；系统只给依据，分数归教师。' },
  { k: '有异议，有入口', v: '归因可申诉，扣分可复核；每一次调整都留下记录。' }
];

export function Login({ mode = 'signin', demo }: { mode?: 'signin' | 'signup'; demo?: DemoLogin | null }) {
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect');
  const priceId = searchParams.get('priceId');
  const inviteId = searchParams.get('inviteId');
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    mode === 'signin' ? signIn : signUp,
    { error: '' }
  );

  // 演示账号区块只在 DEMO_MODE=true 时才有数据；null 表示正式环境，整块不渲染。
  // 口令来自服务端 env，不参与客户端 bundle。
  const demoAccounts = demo?.accounts ?? [];
  const demoPassword = demo?.password ?? '';

  // 受控输入：演示账号一键填充要能写回这两个框
  const [account, setAccount] = useState(state.account ?? '');
  const [password, setPassword] = useState(state.password ?? '');
  // 上一次点的是哪张卡，用于高亮与回执
  const [picked, setPicked] = useState<string | null>(null);
  const accountRef = useRef<HTMLInputElement>(null);

  function fillDemo(demoAccount: DemoAccount) {
    setAccount(demoAccount.account);
    setPassword(demoPassword);
    setPicked(demoAccount.account);
    // 填完把焦点留在账号框附近，方便直接回车提交
    requestAnimationFrame(() => accountRef.current?.focus());
  }

  return (
    <div className="grid min-h-[100dvh] bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
      {/* ---------- 左：墨色陈述面 ---------- */}
      {/*
        这一栏刻意用**固定深色**（不走 --foreground / --background）：
        若跟随主题，深色模式下它会翻转成一块浅色面板，而深色主题的 --brand 是提亮到
        60% 的橙（为暗底调的），压在浅底上只有约 2:1 —— 那三行小标题会直接读不清。
        固定成「墨底 + 浅字 + 亮橙」，两种主题下都对，也不用写 dark: 变体。
      */}
      <aside className="relative flex flex-col justify-between gap-8 bg-[hsl(205_42%_9%)] px-6 py-8 text-[hsl(200_30%_96%)] sm:px-10 sm:py-12 lg:px-14 lg:py-14">
        <div className="flex items-center gap-2.5">
          <BrandMark className="size-9 text-[hsl(26_96%_66%)]" />
          <span className="text-lg font-semibold tracking-tight">共桨 CoPaddle</span>
        </div>

        <div className="lg:max-w-md">
          <p className="text-xs font-medium tracking-[0.18em] text-white/50 uppercase">
            小组协作调度系统
          </p>
          <h1 className="mt-4 text-[1.75rem] leading-[1.25] font-bold text-balance sm:text-[2.1rem] lg:text-[2.5rem]">
            让每个同学
            <br />
            知道自己为什么在这一组。
          </h1>
          <p className="mt-4 hidden max-w-sm text-sm leading-relaxed text-white/70 sm:block">
            分组由约束求解器算出，任务由 AI 拆成可核对的 DAG，协作过程按三维健康度报警，
            最后落成一份能逐条追溯的贡献账本。
          </p>

          <dl className="mt-8 hidden space-y-4 border-t border-white/15 pt-6 md:block">
            {CLAIMS.map((claim) => (
              <div key={claim.k} className="grid gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4">
                <dt className="text-sm font-semibold text-[hsl(26_96%_66%)]">{claim.k}</dt>
                <dd className="text-xs leading-relaxed text-white/65">{claim.v}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* white/55 而不是 /45：实测 /45 压在墨底上正好 4.50:1，恰好卡在 AA 线上，
            字体一细就会掉下去。这一行是 12px 小字，留点余量。 */}
        <p className="hidden text-xs text-white/55 lg:block">
          共桨 CoPaddle · 面向课程小组协作的过程治理平台
        </p>
      </aside>

      {/* ---------- 右：表单 ---------- */}
      <main className="flex items-center justify-center px-4 py-10 sm:px-6 lg:px-10">
        <div className="w-full max-w-sm">
          <h2 className="text-xl font-semibold tracking-tight">
            {mode === 'signin' ? '登录' : '注册账号'}
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {mode === 'signin'
              ? '教师用工号、学生用学号登录，也可以直接输邮箱。'
              : '注册后由教师把账号加入课程。'}
          </p>

          <form className="mt-6 space-y-4" action={formAction}>
            <input type="hidden" name="redirect" value={redirect || ''} />
            <input type="hidden" name="priceId" value={priceId || ''} />
            <input type="hidden" name="inviteId" value={inviteId || ''} />

            {mode === 'signin' ? (
              <div className="space-y-1.5">
                <Label htmlFor="account">学号或邮箱</Label>
                <Input
                  id="account"
                  name="account"
                  ref={accountRef}
                  type="text"
                  autoComplete="username"
                  value={account}
                  onChange={(e) => {
                    setAccount(e.target.value);
                    setPicked(null);
                  }}
                  required
                  minLength={3}
                  maxLength={255}
                  placeholder="例如 20210001"
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="email">邮箱</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  defaultValue={state.email}
                  required
                  maxLength={50}
                  placeholder="you@school.edu.cn"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                maxLength={100}
                placeholder="至少 6 位"
              />
            </div>

            {state?.error && (
              <p role="alert" className="text-sm text-destructive">
                {state.error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  处理中…
                </>
              ) : mode === 'signin' ? (
                '登录'
              ) : (
                '注册'
              )}
            </Button>
          </form>

          {mode === 'signin' && demoAccounts.length > 0 && (
            <div className="mt-6 border-l-2 border-brand bg-brand-soft/40 py-2.5 pl-3.5">
              <p className="text-xs font-medium text-foreground">
                演示账号：点一下填好，再点「登录」
              </p>
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {demoAccounts.map((demoAccount) => {
                  const active = picked === demoAccount.account;
                  return (
                    <button
                      key={demoAccount.account}
                      type="button"
                      onClick={() => fillDemo(demoAccount)}
                      aria-label={`填充${demoAccount.label}演示账号（${demoAccount.name}）`}
                      aria-pressed={active}
                      className={`rounded-sm border px-2 py-1.5 text-xs font-medium transition-colors ${
                        active
                          ? 'border-brand bg-card text-brand'
                          : 'border-border bg-card text-muted-foreground hover:border-foreground/40 hover:text-foreground'
                      }`}
                    >
                      {demoAccount.label}
                    </button>
                  );
                })}
              </div>
              {picked ? (
                <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
                  {(() => {
                    const hit = demoAccounts.find((d) => d.account === picked);
                    return hit ? `已填入${hit.label} ${hit.name}（${hit.account}）· ${hit.scope}` : '';
                  })()}
                </p>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  密码统一为 {demoPassword}；也可以直接输学号或工号登录。
                </p>
              )}
            </div>
          )}

          <p className="mt-5 text-sm text-muted-foreground">
            {mode === 'signin' ? '还没有账号？' : '已有账号？'}
            <Link
              href={`${mode === 'signin' ? '/sign-up' : '/sign-in'}${
                redirect ? `?redirect=${redirect}` : ''
              }${priceId ? `&priceId=${priceId}` : ''}`}
              // py-1：375px 下「注册」链接原高 19px，手指点不中；行内块加纵向内距
              // 撑到 27px，文字位置与旁边那句「还没有账号？」保持一致。
              className="ml-1 inline-block py-1 font-medium text-foreground underline-offset-4 hover:underline"
            >
              {mode === 'signin' ? '注册' : '去登录'}
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}