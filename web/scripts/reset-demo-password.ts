/**
 * 统一重置演示账号凭证（三端同号同密码）。
 *
 * 做的事：
 *   1. 所有 @copaddle.local 账号的密码重置为 DEMO_PASSWORD（未设置时回退本地演示口令），并置 status=active；
 *   2. 教师账号（teacher@copaddle.local）的工号设为 20210001，可用工号登录。
 *
 * 登录框接受「学号 / 工号」或「邮箱」，二选一。学生直接用本人学号登录。
 * 运行：cd web && pnpm exec tsx scripts/reset-demo-password.ts [新密码]
 */
import { hash } from 'bcryptjs';
import { eq, like } from 'drizzle-orm';
import { db, client } from '../lib/db/drizzle';
import { users } from '../lib/db/schema';
import { resolveDemoPassword } from './demo-credentials';

const PASSWORD = process.argv[2] ?? resolveDemoPassword();
const TEACHER_EMAIL = 'teacher@copaddle.local';
const TEACHER_NO = '20210001';

async function main() {
  const passwordHash = await hash(PASSWORD, 10);

  const resetted = await db
    .update(users)
    .set({ passwordHash, status: 'active' })
    .where(like(users.email, '%@copaddle.local'))
    .returning({ id: users.id, name: users.name, email: users.email, studentNo: users.studentNo });

  const teacher = await db
    .update(users)
    .set({ studentNo: TEACHER_NO })
    .where(eq(users.email, TEACHER_EMAIL))
    .returning({ id: users.id, name: users.name, email: users.email, studentNo: users.studentNo });

  console.log(`密码已重置为 ${PASSWORD}：${resetted.length} 个账号`);
  if (teacher[0]) {
    console.log(`教师工号：${teacher[0].studentNo}（${teacher[0].name} / ${teacher[0].email}）`);
  } else {
    console.log(`未找到教师账号 ${TEACHER_EMAIL}，工号未设置`);
  }

  await client.end();
}

main();
