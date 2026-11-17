import { Suspense } from 'react';
import { Login } from '../login';
import { getDemoAccounts } from '../demo-accounts';

/**
 * 服务端读取演示模式开关再传 props；注册页本身不渲染演示区块（mode='signup'），
 * 但同样不把口令带到客户端。
 */
// 与 sign-in 同理：关掉静态预渲染，让 DEMO_MODE 在运行时生效而不是烘焙进构建产物。
export const dynamic = 'force-dynamic';

export default function SignUpPage() {
  const demo = getDemoAccounts();
  return (
    <Suspense>
      <Login mode="signup" demo={demo} />
    </Suspense>
  );
}