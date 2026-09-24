import { redirect } from 'next/navigation';

/** 安全设置已并入账号设置，旧地址跳转。 */
export default function SecurityRedirect() {
  redirect('/dashboard/general');
}
