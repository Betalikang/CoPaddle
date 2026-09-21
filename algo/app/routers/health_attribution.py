"""健康度与贡献归因内部接口（支撑 B-10 / B-14）。

全部为纯计算，不使用大模型（规格书 S6.3）。脚手架阶段为占位实现（501）。
"""

from fastapi import APIRouter, Depends, HTTPException

from ..deps import require_internal_secret
from ..schemas import (
    AttributionComputeRequest,
    AttributionComputeResponse,
    HealthComputeRequest,
    HealthComputeResponse,
)

health_router = APIRouter(prefix="/internal/health", dependencies=[Depends(require_internal_secret)], tags=["health"])
attribution_router = APIRouter(
    prefix="/internal/attribution", dependencies=[Depends(require_internal_secret)], tags=["attribution"]
)


@health_router.post("/compute", response_model=HealthComputeResponse)
def compute_health(req: HealthComputeRequest) -> HealthComputeResponse:
    """三维健康度（阻塞/失联/过载）+ 诊断条目，公式见规格书 S4.4。"""
    raise HTTPException(status_code=501, detail="S5 期实现：健康度三维计算")


@attribution_router.post("/compute", response_model=AttributionComputeResponse)
def compute_attribution(req: AttributionComputeRequest) -> AttributionComputeResponse:
    """三类证据加权 -> 贡献区间与置信度，公式见规格书 S4.7。永不输出单一分数。"""
    raise HTTPException(status_code=501, detail="S4 期实现：贡献归因计算")
