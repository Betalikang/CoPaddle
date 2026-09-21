"""健康度与贡献归因内部接口（支撑 B-10 / B-14）。

全部为纯计算，不使用大模型（规格书 S6.3）。
"""

from fastapi import APIRouter, Depends, HTTPException

from ..algorithms.attribution import compute_attribution as attribution_impl
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
    """三类证据加权 -> 贡献区间与置信度，公式见规格书 S4.7。

    铁律：永不输出单一分数；区间 + 置信度 + 构成 + 搭便车提示（附
    「不构成扣分依据」）；同伴证据整体缺席时权重重分配并标记。
    """
    return attribution_impl(req)
