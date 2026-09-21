"""分组求解相关内部接口（支撑 B-06 分组编排）。

规格书 S2：solve / score / validate 三个端点。
脚手架阶段为占位实现（501），S2 期按附录 B.5 用 CP-SAT 建模落地。
"""
from fastapi import APIRouter, Depends, HTTPException

from ..deps import require_internal_secret
from ..schemas import (
    GroupingSolveRequest,
    GroupingSolveResponse,
    PreviewMoveRequest,
    PreviewMoveResponse,
)

router = APIRouter(prefix="/internal/grouping", dependencies=[Depends(require_internal_secret)], tags=["grouping"])


@router.post("/solve", response_model=GroupingSolveResponse)
def solve(req: GroupingSolveRequest) -> GroupingSolveResponse:
    """CP-SAT 求解，返回三套方案与四维得分（限时 10s，超时回退贪心）。"""
    raise HTTPException(status_code=501, detail="S2 期实现：CP-SAT 分组求解")


@router.post("/score", response_model=PreviewMoveResponse)
def score(req: PreviewMoveRequest) -> PreviewMoveResponse:
    """给定方案打分（preview-move 用，不重新求解，内存重算，<= 50ms）。"""
    raise HTTPException(status_code=501, detail="S2 期实现：四维得分内存重算")


@router.post("/validate")
def validate(req: PreviewMoveRequest) -> PreviewMoveResponse:
    """硬约束校验，返回违规清单（H1–H5，规格书 S4.2）。"""
    raise HTTPException(status_code=501, detail="S2 期实现：硬约束校验")
