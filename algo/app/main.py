"""共桨算法服务入口。

启动：uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
仅内网监听；9 个 /internal/* 业务接口全部要求共享密钥头，/internal/healthz 为存活探针。
"""

from fastapi import FastAPI
from fastapi.responses import RedirectResponse

from .routers import ai, graph, grouping, health_attribution

app = FastAPI(
    title="共桨 CoPaddle · 算法服务",
    version="0.1.0",
    description="CP-SAT 分组求解 · 图算法 · 健康度 · 贡献归因 · 2 个 LLM 调用点。"
    "仅供 web 服务内网调用（共享密钥头 X-Internal-Secret）。",
    docs_url="/docs",
)

app.include_router(grouping.router)
app.include_router(graph.router)
app.include_router(health_attribution.health_router)
app.include_router(health_attribution.attribution_router)
app.include_router(ai.router)


@app.get("/internal/healthz", tags=["system"])
def healthz() -> dict[str, str]:
    """存活探针（无需密钥，供 docker/部署侧探活；不触库、不调 LLM）。"""
    return {"status": "ok"}


@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    return RedirectResponse(url="/docs")
