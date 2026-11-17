import { Suspense } from 'react';
import { Login } from '../login';
import { getDemoAccounts } from '../demo-accounts';

/**
 * 服务端读取演示模式开关再传 props：
 * 关闭时（正式部署）客户端拿到的 demo 是 null，登录页不渲染演示账号区块，
 * 口令也不会被打进客户端 bundle。
 */
// 必须动态渲染：这个页面没有别的动态 API，Next 会在构建期把它预渲染成静态 HTML，
// 于是 demo 被按「构建那一刻的 DEMO_MODE」烤进产物 —— 之后在运行时把 DEMO_MODE
// 改成 true 也不生效，反过来更糟（构建时开了演示，正式跑也关不掉）。
export const dynamic = 'force-dynamic';

export default function SignInPage() {
  const demo = getDemoAccounts();
  return (
    <Suspense>
      <Login mode="signin" demo={demo} />
    </Suspense>
  );
}