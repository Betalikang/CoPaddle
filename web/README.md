# 共桨 web（Next.js 应用）

Fork 自 [nextjs/saas-starter](https://github.com/nextjs/saas-starter)（MIT），
作为共桨 CoPaddle 的 Web 应用基座：三角色界面、看板、拖拽、图表、Route Handlers。

> 本项目为学习用途，不商用、不对外上线。

## 已做的基座改造

- **移除 Stripe 全链路**（`/pricing`、`/api/stripe/*`、`lib/payments/*`、订阅卡片、
  登录/注册的 checkout 分支、`stripe` 依赖）——共桨不使用支付。`teams` 表中的
  `stripe_*` 列保留（已迁移，无害），S1 期建共桨数据模型时可整体替换。
- `tsx` 固化为 devDependency（原 `npx tsx` 每次现拉）。
- 元数据改为共桨产品名。

## 本地运行

```bash
pnpm install
cp .env.example .env      # 注意：基座要求 .env（不是 .env.local）
# 填写 POSTGRES_URL / AUTH_SECRET（ALGO_SERVICE_URL 与 ALGO_SHARED_SECRET 为 S2 期预留）
pnpm db:migrate           # 建表（迁移由 Drizzle Kit 统一管理）
pnpm db:seed              # 演示数据（账号见 docs/数字图像-演示数据补全计划.md；口令由 DEMO_PASSWORD 决定）
pnpm dev                  # http://localhost:3000
```

`pnpm db:setup`（基座自带）不可用：它强制要求 Stripe CLI 并交互式提问，还会写一份
端口 54322 的 compose 文件并整份覆盖 `.env`。该脚本现已改为打印正确指引后 `exit 1`。

## 质量门槛

```bash
pnpm typecheck       # tsc --noEmit（项目无 eslint 配置，这是唯一静态门槛）
pnpm test            # 离线套件：tests/api（请求契约）+ tests/lib（纯函数）+ tests/ui（happy-dom 组件测试）
pnpm test:ui         # 只跑组件测试
pnpm test:services   # 需要隔离库（POSTGRES_URL），会插删数据，串行执行
pnpm verify          # typecheck → test → build，提交前跑这个
```

CI（`.github/workflows/ci.yml`）的顺序与计划一致：类型检查 → 离线单测 → 隔离库服务测试
→ 生产构建（并 grep 断言客户端产物不含演示账号域名）→ 三角色冒烟
（`scripts/smoke-roles.ts`，需要起 web + 库）。

## 性能与无障碍验收

需要先跑生产构建并 `next start`，且数据库指向隔离库（会造 192 名学生 / 24 组 / 216 个任务）：

```bash
npx tsx scripts/perf-fixture.ts     # 输出 courseId 与 teacher/captain 两枚 cookie
node scripts/perf-measure.mjs <courseId> <teacherCookie> <captainCookie>   # LCP/CLS/请求数/JS 字节
node scripts/a11y-check.mjs  <courseId> <teacherCookie> <captainCookie>    # 22 条路由 375px + 抽屉/播报 17 项，全 PASS 时退出码 0
```

视觉改版另有三个脚本（同样需要生产构建在跑）：

```bash
node scripts/design-check.mjs    <teacherCookie> <courseId>   # 19 项设计意图断言：字阶/橙色稀缺度/动效/两栏/雷达图跟随主题
node scripts/contrast-audit.mjs  <teacherCookie> <courseId>   # 8 页 × 浅深两主题，WCAG AA，0 处不合格时退出码 0
node scripts/screenshots.mjs     <teacherCookie> <courseId>   # 7 页 × 1280/375 截图到 .tmp-shots，顺带断言无横向溢出
```

需要一枚能进课程的 cookie 时，用 `npx tsx scripts/dev-token.ts <userId> --cookie` 签，
它会自己读 `web/.env` 里的 `AUTH_SECRET`（**必须与服务端同值**）。
注意 payload 必须是 `{ user: { id }, expires }`——传 `{ id }` 也能签、也能过验签，
但 `getSession()` 读 `payload.user.id` 会拿到 undefined，整站在线态直接 401。

实测结果与口径见 `docs/性能基线-实测.md`，视觉改版的设计依据见 `docs/视觉改版说明.md`。
脚本通过 `scripts/lib/playwright.mjs` 解析
Playwright——项目没把它装进依赖，本机需要 `PERF_PLAYWRIGHT_PATH` 指向
`node_modules/playwright/index.js`（Windows 中文用户名下裸模块解析拿不到 `chromium`）。

五支脚本的目标站点与浏览器统一由 `scripts/lib/playwright.mjs` 决定：

- `resolveBaseUrl()`：`COPADDLE_BASE_URL` → `SHOT_BASE_URL` → `PERF_BASE_URL` → `http://localhost:3000`。
  以前三支脚本读前者、两支读后者，同轮验收要导两次变量，少导一次就静默打本机。
- `resolveChromePath()`：只读 `CHROME_PATH`，缺了直接报错。不再写死某个人的本机路径。

对线上站点复验时：

```powershell
$env:COPADDLE_BASE_URL='http://47.97.96.242'
node scripts/design-check.mjs <teacherCookie> 4
```

两个脚本跑前都会先 `GET /api/user` 确认 cookie 真能登录，登录失败直接退出码 2：cookie 无效时每页
都会回落登录页，指标会好得离谱却一页真实数据都没测到。`perf-fixture.ts` 与服务端必须使用同一个
`AUTH_SECRET`，脚本会自动去掉 fixture 打印的 `session=` 前缀。

## 技术栈

- **Framework**: Next.js 15.6（App Router，Turbopack dev）
- **Database**: PostgreSQL 16（本地 Docker，端口 5433）
- **ORM**: Drizzle ORM + Drizzle Kit（迁移唯一入口）
- **Auth**: jose JWT + HttpOnly Cookie（自建，角色为课程级——见规格书 S1 红线）
- **UI**: shadcn/ui（radix-ui）+ Tailwind CSS 4
- **校验**: zod（前后端共用 schema）

## 目录

```
app/            # App Router：(login) sign-in/sign-up · (dashboard) 仪表盘 · api/
components/     # shadcn/ui 组件（复制式，随用随加）
lib/db/         # schema · drizzle · migrations · seed · queries
lib/auth/       # 会话与角色中间件
middleware.ts   # 全局路由保护
```
