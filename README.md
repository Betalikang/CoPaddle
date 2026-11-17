# 共桨 CoPaddle · AI 小组协作调度系统

面向高校小组协作的 AI 调度系统：教师、队长、队员三端，一个持续在线的调度中枢。
把「小组作业」从一次性分工，变成一条有据可查、可调度、可归因的协作流水线。

> 本项目仅用于学习与竞赛展示，不商用、不对外开放上线。

## 仓库结构

```
CoPaddle/
├── docs/                 # 产品方案、功能规格、技术选型、附录 A/B（5 份 HTML）
├── web/                  # Next.js 应用（fork 自 nextjs/saas-starter，MIT）
│                         #   三角色界面 · 看板 · 拖拽 · 图表 · Route Handlers
├── algo/                 # FastAPI 算法服务（Python）
│                         #   CP-SAT 分组 · 图算法 · 健康度 · 归因 · 2 个 LLM 调用点
├── docker-compose.yml    # 开发期仅容器化 PostgreSQL 16（端口 5433）
└── THIRD_PARTY.md        # 第三方依赖与设计参考留档
```

架构：双服务 + 共享数据库。web 通过内网 HTTP（共享密钥）调用 algo 的 9 个
`/internal/*` 接口；algo 只读画像数据、只写结果表；建表与迁移统一由 web 侧
Drizzle Kit 管理。

## 快速开始（Windows / Git Bash）

前置：Node ≥ 22、Python 3.12+、pnpm、Docker Desktop。

```bash
# 1. 数据库（端口 5433，避免与本机既有服务冲突）
docker compose up -d db

# 2. Web 应用
cd web
cp .env.example .env         # 注意是 .env（不是 .env.local）；变量名是 POSTGRES_URL（不是 DATABASE_URL）
pnpm install
pnpm db:migrate              # 只跑 Drizzle 迁移
pnpm db:seed                 # 再灌演示数据（按需）
pnpm dev                     # http://localhost:3000

# 3. 算法服务
cd ../algo
python -m venv .venv && source .venv/Scripts/activate
pip install -r requirements.txt
cp .env.example .env         # 填 ALGO_SHARED_SECRET（与 web 一致）、LLM_API_KEY
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
# 自检：http://127.0.0.1:8000/docs
```

> ⚠️ 不要用 `pnpm db:setup`：它是 fork 来的 saas-starter 脚手架遗留脚本，要 Stripe 密钥、
> 会写一份端口 54322 的 compose 文件并整份覆盖 `.env`。该脚本现已改为打印指引后直接退出。
> 初始化环境的正确顺序就是上面三步：`cp .env.example .env` → `pnpm db:migrate` → `pnpm db:seed`。

## 登录与演示账号

登录页的演示账号卡片只在**显式开启演示模式**时渲染：服务端读 `DEMO_MODE=true` 且
`DEMO_PASSWORD` 非空才下发账号列表，客户端构建里不含口令（CI 会 grep `.next/static`
断言这一点）。正式部署不要开 `DEMO_MODE`，也不要用种子脚本里的默认口令对外。

## 质量门槛

```bash
cd web
pnpm typecheck   # tsc --noEmit
pnpm test        # 离线单测 + 组件测试（不需要数据库）
pnpm test:services  # 需要 POSTGRES_URL 指向隔离库
pnpm verify      # typecheck + test + build，提交前跑这个
```

## 文档索引

| 文档 | 回答的问题 |
|---|---|
| [产品方案](docs/共桨-AI小组协作系统-产品方案.html) | 为什么做：问题定义、六个 AI 模块、MVP 路径、差异化 |
| [完整功能规格说明书](docs/共桨-完整功能规格说明书.html) | 做什么：47 表 / 155 API / 52 页面 / 状态机与公式 |
| [技术选型说明书](docs/共桨-技术选型说明书.html) | 用什么做：T0–T14，每项含否决理由，12 条「明确不用」 |
| [附录 A · 开源生态调研](docs/共桨-附录A-开源生态调研.html) | 赛道现状：零件齐全、没有整机 |
| [附录 B · 技术选型与组装方案](docs/共桨-附录B-技术选型与组装方案.html) | 怎么组装：fork 脚手架，只自建三块 |

## 排期基线

按规格书 S8：完整版约 182 人天，可演示版约 68 人天，分 S1–S7 七期。
两个「答辩杀手锏」：P-09 分组工作台（拖动实时得分）、P-19 贡献账本（证据下钻）。
