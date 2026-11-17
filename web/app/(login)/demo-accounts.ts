/**
 * 登录页「演示账号」一键填充的数据。
 *
 * ===== 安全边界（P0 门槛）=====
 * 这份数据**只在明确开启演示模式的构建里存在**：
 *   DEMO_MODE=true
 * 未开启时（默认，含所有正式部署）getDemoAccounts() 返回 null，登录页不渲染
 * 演示账号区块，口令字符串也不会随客户端包发出去。以前这里是模块顶层的
 * `const DEMO_PASSWORD = '123456'` + 恒真渲染，等于把教师账号口令印在公网
 * 登录页上；注释里「藏进 env 没有安全收益」的判断是错的——env 的价值不在
 * 保密，而在于让「正式构建有没有这段东西」变成一个显式开关。
 *
 * 为什么是服务端读 env 再传 props，而不是 NEXT_PUBLIC_*：
 *   NEXT_PUBLIC_ 是编译期内联，字符串照样进客户端 bundle；由 server component
 *   读非公开 env 后传 props，关闭时客户端根本收不到这段数据。
 *
 * 为什么填邮箱而不是学号/工号：
 *   仓库里有 `seed-demo.ts` 和 `seed-digital-image.ts` 两套种子，它们给教师写的
 *   工号并不一致（后者写 20210001，前者写 T001），线上库实际是 T001。只有
 *   `teacher@ / captain@ / member@copaddle.local` 这三个邮箱在两套种子里都固定存在，
 *   所以填邮箱才不会出现「本地能点、线上点不动」。登录框本身支持邮箱，这不违背设计。
 */

type DemoAccount = {
  /** 按钮上的角色名 */
  label: string;
  /** 填进「学号或邮箱」框的邮箱 */
  account: string;
  /** 花名，用于填充后的回执文案 */
  name: string;
  /** 这个角色登进来主要能看到什么 */
  scope: string;
};

export type DemoLogin = {
  accounts: DemoAccount[];
  /** 演示口令；与种子脚本共用同一个 env，避免两边漂移 */
  password: string;
};

const ACCOUNTS: DemoAccount[] = [
  {
    label: '教师',
    account: 'teacher@copaddle.local',
    name: '王教授',
    scope: '全课程视图'
  },
  {
    label: '队长',
    account: 'captain@copaddle.local',
    name: '李烁',
    scope: '本组任务与契约'
  },
  {
    label: '队员',
    account: 'member@copaddle.local',
    name: '张心露',
    scope: '我的部分与互评'
  }
];

/** 是否开启演示模式。只有显式设为 "true" 才算开启，拼错的取值一律按关闭处理。 */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === 'true';
}

/**
 * 演示登录信息。未开启演示模式、或没配 DEMO_PASSWORD 时返回 null。
 * 没有口令就不给「一键填入」——否则按钮点下去填一个空密码，比不给按钮更糟。
 */
export function getDemoAccounts(): DemoLogin | null {
  if (!isDemoMode()) return null;
  const password = process.env.DEMO_PASSWORD;
  if (!password) return null;
  return { accounts: ACCOUNTS, password };
}

export type { DemoAccount };