# 第三方依赖清单

> 按《技术选型说明书》T11 维护。版本以锁文件为准（web/pnpm-lock.yaml、algo/requirements.txt），
> 本表在引入/移除依赖时同步更新。本项目为学习用途，不商用、不对外开放上线；
> 若未来公开发布，需重新核验下列依赖的最新许可状态。

## 应用基座

| 名称 | 版本 | 许可 | 用途 | 来源 |
|---|---|---|---|---|
| nextjs/saas-starter | main（2026-09 快照） | MIT | Web 应用基座（鉴权/DB/UI/Dashboard 骨架） | github.com/nextjs/saas-starter |

## Web 端主要依赖（随基座）

| 名称 | 版本 | 许可 | 用途 | 来源 |
|---|---|---|---|---|
| next | 15.6.x | MIT | Web 框架 | github.com/vercel/next.js |
| react / react-dom | 19.1.x | MIT | UI 运行时 | github.com/facebook/react |
| typescript | 5.8.x | Apache-2.0 | 语言 | github.com/microsoft/TypeScript |
| drizzle-orm / drizzle-kit | 0.43.x / 0.31.x | Apache-2.0 | ORM 与迁移 | github.com/drizzle-team/drizzle-orm |
| postgres | 3.x | MIT | PostgreSQL 驱动（Node 侧） | github.com/porsager/postgres |
| jose | 6.x | MIT | JWT 会话 | github.com/panva/jose |
| bcryptjs | 3.x | MIT | 密码哈希 | github.com/dcodeIO/bcrypt.js |
| zod | 3.24.x | MIT | 数据校验（前后端共用 schema） | github.com/colinhacks/zod |
| tailwindcss | 4.1.x | MIT | 样式 | github.com/tailwindlabs/tailwindcss |
| radix-ui | 最新 | MIT | 无样式组件原语（shadcn/ui 基础） | github.com/radix-ui/primitives |
| lucide-react | 最新 | ISC | 图标 | github.com/lucide-icons/lucide |
| swr | 2.x | MIT | 基座自带数据请求 | github.com/vercel/swr |
| tsx | 4.x | MIT | 运行 seed/setup 脚本（devDependency） | github.com/privatenumber/tsx |

## Web 端计划引入（S2 期起，随用随加）

| 名称 | 版本 | 许可 | 用途 |
|---|---|---|---|
| @tanstack/react-query | 5.x | MIT | 服务端状态 |
| @tanstack/react-table | 8.x | MIT | 数据表格 |
| @dnd-kit/core | 6.x | MIT | 分组工作台拖拽 |
| reactflow | 12.x | MIT | 任务 DAG 图 |
| recharts | 2.x | MIT | 统计图表（得分雷达/贡献构成） |
| cytoscape | 3.x | MIT | 班级社交关系图 |
| frappe-gantt | 1.x（fork 维护版待定） | MIT | 甘特图 |
| zustand | 5.x | MIT | 客户端状态 |
| react-hook-form | 7.x | MIT | 表单 |
| date-fns / sonner | 最新 | MIT | 日期 / 轻提示 |

## 算法服务依赖（algo/）

| 名称 | 版本 | 许可 | 用途 | 来源 |
|---|---|---|---|---|
| fastapi | 0.115+ | MIT | Web 框架 | github.com/fastapi/fastapi |
| uvicorn | 0.32+ | BSD-3 | ASGI 服务器 | github.com/encode/uvicorn |
| pydantic | 2.x | MIT | 数据校验 / LLM 结构化输出解析 | github.com/pydantic/pydantic |
| ortools | 9.x | Apache-2.0 | CP-SAT 约束求解（分组） | github.com/google/or-tools |
| networkx | 3.x | BSD-3 | 图算法（关键路径/环检测） | github.com/networkx/networkx |
| rapidfuzz | 3.x | MIT | 文本相似度（冲突前置筛选） | github.com/rapidfuzz/RapidFuzz |
| jieba | 0.42.x | MIT | 中文分词 | github.com/fxsjy/jieba |
| apscheduler | 3.x | MIT | 定时任务（健康度快照/失联检测） | github.com/agronholm/apscheduler |
| python-docx | 1.x | MIT | DOCX 解析 | github.com/python-openxml/python-docx |
| pdfplumber | 0.11.x | MIT | PDF 文本抽取（避开 pymupdf 的 AGPL） | github.com/jsvine/pdfplumber |
| psycopg[binary] | 3.x | LGPL-3.0 | PostgreSQL 驱动（作为库链接使用，不修改源码） | github.com/psycopg/psycopg |
| numpy | 2.x | BSD-3 | 数值计算（归因矩阵） | github.com/numpy/numpy |
| openai | 1.x | Apache-2.0 | LLM 调用（OpenAI 兼容协议，指向 DeepSeek） | github.com/openai/openai-python |
| pytest / pytest-cov | 8.x / 6.x | MIT | 测试（覆盖率要求 ≥ 80%） | github.com/pytest-dev/pytest |

## 基础设施

| 名称 | 版本 | 许可 | 用途 |
|---|---|---|---|
| postgres（Docker 镜像 postgres:16-alpine） | 16 | PostgreSQL License | 主数据库 |

## 设计参考（未使用其代码）

| 项目 | 许可 | 借鉴内容 |
|---|---|---|
| gruepr | GPL-3.0 | 多目标分组的评分函数设计思路（不引入代码；如参照实现，隔离在独立模块并注明来源） |
| UTDallasEPICS/Teambuilder | 无声明 | CP-SAT 分组建模思路（wiki 文档层面参考） |
| CATME | 闭源商业 | 团队协作评价方法论对标（遵守其 EULA，独立设计，不逐条对照功能清单） |
| ItzPabz/PeerEval | 无声明 | 课程—班级—小组层级数据模型设计思路 |
| jetcom/peer_eval | 无声明 | 评价热力图交互设计思路 |

## 许可风险分级备忘

- 绿（零负担）：MIT / Apache-2.0 / BSD / ISC —— 保留版权声明即可。
- 黄（需隔离）：LGPL-3.0（psycopg）—— 仅作为库链接使用，不修改源码。
- 红（已规避）：AGPL-3.0（pymupdf → 已换 pdfplumber）、GPL-3.0（gruepr → 只借鉴思路）。
- 红（不可用）：无许可声明项目（trackdev / PeerEval / Teambuilder）—— 只读设计思路，代码全部自写。
