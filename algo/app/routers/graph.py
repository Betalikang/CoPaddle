"""图算法内部接口（支撑 B-08 任务依赖图 / B-10 波及分析）。

脚手架阶段为占位实现（501）；关键路径为 DAG 最长路径（est_hours 之和最大），
注意与 networkx 默认最短路径不同（《技术选型说明书》T4）。
"""
from fastapi import APIRouter, Depends, HTTPException

from ..deps import require_internal_secret
from ..schemas import (
    CriticalPathRequest,
    CriticalPathResponse,
    ImpactRequest,
    ImpactResponse,
)

router = APIRouter(prefix="/internal/graph", dependencies=[Depends(require_internal_secret)], tags=["graph"])


@router.post("/critical-path", response_model=CriticalPathResponse)
def critical_path(req: CriticalPathRequest) -> CriticalPathResponse:
    """关键路径：任务 DAG 上 est_hours 之和最大的一条链（拓扑排序 + 最长路径）。"""
    raise HTTPException(status_code=501, detail="S3 期实现：关键路径计算")


@router.post("/impact", response_model=ImpactResponse)
def impact(req: ImpactRequest) -> ImpactResponse:
    """波及分析：指定任务延期后受影响的下游任务集合与预计顺延天数。"""
    raise HTTPException(status_code=501, detail="S3 期实现：下游波及分析")
