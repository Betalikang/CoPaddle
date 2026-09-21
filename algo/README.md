# 共桨 · 算法服务（algo/）

FastAPI + Python 3.12。承担确定性计算（CP-SAT 分组、图算法、健康度、贡献归因）
与全系统仅有的 2 个 LLM 调用点。仅供 web（Next.js）服务端内网调用，不暴露公网。

> 脚手架阶段：全部业务接口为 501 占位，输入输出契约（pydantic schema）已按规格书锁定；
> healthz、共享密钥隔离、依赖可用性已验证。各期实现见接口描述中的 S2–S5 标注。

## 运行

```bash
python -m venv .venv
.venv/Scripts/activate            # Windows Git Bash；Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt   # 走阿里云 PyPI 镜像（全局 pip.ini）
cp .env.example .env              # 填 ALGO_SHARED_SECRET（与 web 一致）、LLM_API_KEY
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

接口文档：http://127.0.0.1:8000/docs （FastAPI 自动生成，无需手写）。

## 测试与检查

```bash
pytest --cov=app --cov-report=term-missing   # 覆盖率要求 >= 80%（业务实现后）
ruff check . && ruff format --check .
mypy app
```

## 内部接口（9 + 1，全部 POST + JSON）

调用方必须携带请求头 `X-Internal-Secret: <ALGO_SHARED_SECRET>`；
密钥未配置时服务 fail-closed（一律 503）。

| 接口 | 用途 | 实现期 |
|---|---|---|
| `/internal/grouping/solve` | CP-SAT 求解，返回三套方案与四维得分 | S2 |
| `/internal/grouping/score` | 给定方案打分（preview-move 用，不重新求解） | S2 |
| `/internal/grouping/validate` | 硬约束校验（H1–H5） | S2 |
| `/internal/graph/critical-path` | 关键路径（DAG 最长路径） | S3 |
| `/internal/graph/impact` | 延期波及分析 | S3 |
| `/internal/health/compute` | 三维健康度 + 诊断 | S5 |
| `/internal/attribution/compute` | 三类证据加权 → 贡献区间与置信度 | S4 |
| `/internal/ai/decompose` | LLM 调用点 1：作业要求 → 任务 DAG + 契约 | S3 |
| `/internal/ai/conflict` | LLM 调用点 2：语义冲突归因 | S5 |
| `/internal/healthz`（GET） | 存活探针，无需密钥 | ✅ |

## 目录

```
algo/
├── app/
│   ├── main.py          # FastAPI 入口与路由挂载
│   ├── config.py        # 环境变量（pydantic-settings）
│   ├── deps.py          # 共享密钥校验（fail-closed）
│   ├── schemas.py       # 全部内部接口的输入输出契约
│   └── routers/         # grouping / graph / health_attribution / ai
├── tests/               # pytest（冒烟 + 各期验收断言）
├── requirements.txt     # 锁定次版本（T12 版本纪律）
└── pyproject.toml       # pytest / ruff / mypy 配置
```

## 边界纪律（写代码前重读）

- 能算的不要问模型：数值全部由公式/求解器产出，LLM 只做两件事（读作业要求、判两段产出是否矛盾）。
- algo 不建表、不做业务写入：迁移统一由 web 侧 Drizzle Kit 管理（T5）。
- 贡献归因永不输出单一分数（S4.7）。
