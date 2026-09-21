# 共桨 CoPaddle · AI 小组协作调度系统

面向高校小组协作的 AI 调度系统：教师、队长、队员三端，一个持续在线的调度中枢。
把「小组作业」从一次性分工，变成一条有据可查、可调度、可归因的协作流水线。

> 提交方向：ICAN 九月赛题「AI 产品实现」。本项目仅用于学习，不商用、不对外开放上线。

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
cp .env.example .env.local   # 按注释填 DATABASE_URL / AUTH_SECRET 等
pnpm install
pnpm db:setup                # Drizzle 迁移 + 种子数据
pnpm dev                     # http://localhost:3000

# 3. 算法服务
cd ../algo
python -m venv .venv && source .venv/Scripts/activate
pip install -r requirements.txt
cp .env.example .env         # 填 ALGO_SHARED_SECRET（与 web 一致）、LLM_API_KEY
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
# 自检：http://127.0.0.1:8000/docs
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
