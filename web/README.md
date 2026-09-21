# 共桨 web（Next.js 应用）

Fork 自 [nextjs/saas-starter](https://github.com/nextjs/saas-starter)（MIT），
作为共桨 CoPaddle 的 Web 应用基座：三角色界面、看板、拖拽、图表、Route Handlers。

> 本项目为学习用途（ICAN 赛题），不商用、不对外上线。

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
pnpm db:seed              # 演示账号 test@test.com / admin123
pnpm dev                  # http://localhost:3000
```

`pnpm db:setup`（基座自带）不可用：它强制要求 Stripe CLI 并交互式提问，已被上面的
手动流程替代。

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
