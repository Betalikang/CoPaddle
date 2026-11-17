/**
 * 演示口令的单一来源（脚本侧）。
 *
 * 背景：`seed-demo.ts`、`seed-digital-image.ts`、`reset-demo-password.ts` 各自
 * 硬编码了一份 `'123456'`。三份常量意味着三处漂移点 —— 改了其中一个脚本的密码，
 * 另两个脚本造的账号就跟不上，演示现场出现「这个号能进、那个号不能进」。
 *
 * 规则：
 *   1. 有 DEMO_PASSWORD 就用它（推荐；.env 里配一次，三个脚本共用）；
 *   2. 没有则退回 123456，并打印警告 —— 这是本地/答辩演示的便利路径；
 *   3. NODE_ENV=production 且没配 DEMO_PASSWORD 时直接拒绝执行：
 *      生产库不该出现口令为 123456 的账号，这个默认值不能悄悄生效。
 *
 * 注意：这些是**服务端脚本常量**，不会进入客户端 bundle；登录页那一侧的隔离
 * 见 app/(login)/demo-accounts.ts。
 */
const LOCAL_FALLBACK = '123456';

export function resolveDemoPassword(): string {
  const fromEnv = process.env.DEMO_PASSWORD;
  if (fromEnv && fromEnv.length > 0) return fromEnv;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '拒绝在 NODE_ENV=production 下使用内置演示口令。\n' +
        '请在环境里设置 DEMO_PASSWORD 后重试；生产环境不应存在口令为默认值的账号。'
    );
  }

  console.warn(
    '[demo] 未设置 DEMO_PASSWORD，回退到本地演示口令。' +
      '该口令写在本仓库文档与答辩材料里，绝不可用于任何对外可访问的环境。'
  );
  return LOCAL_FALLBACK;
}