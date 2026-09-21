"""图算法内部接口（支撑 B-08 任务依赖图 / B-10 波及分析）。

critical-path 为 DAG 最长路径（est_hours 之和最大），
注意与 networkx 默认最短路径不同（技术选型 T4）。
"""

from fastapi import APIRouter, Depends

from ..algorithms.scheduling import Task, critical_path, impact
from ..deps import require_internal_secret
from ..schemas import (
    CriticalPathRequest,
    CriticalPathResponse,
    ImpactRequest,
    ImpactResponse,
)

router = APIRouter(prefix="/internal/graph", dependencies=[Depends(require_internal_secret)], tags=["graph"])


def _to_tasks(req: CriticalPathRequest | ImpactRequest) -> list[Task]:
    return [
        Task(
            id=t.id,
            title=t.title,
            deps=list(t.deps),
            est_hours=t.est_hours,
            status=t.status,
            due_at=t.due_at,
        )
        for t in req.tasks
    ]


@router.post("/critical-path", response_model=CriticalPathResponse)
def critical_path_ep(req: CriticalPathRequest) -> CriticalPathResponse:
    """关键路径：任务 DAG 上 est_hours 之和最大的一条链（拓扑排序 + 最长路径）。"""
    result = critical_path(_to_tasks(req))
    path_val = result.get("path")
    hours_val = result.get("total_hours")
    return CriticalPathResponse(
        path=[str(x) for x in path_val] if isinstance(path_val, list) else [],
        total_hours=float(hours_val) if isinstance(hours_val, (int, float)) else 0.0,
    )


@router.post("/impact", response_model=ImpactResponse)
def impact_ep(req: ImpactRequest) -> ImpactResponse:
    """波及分析：指定任务延期后受影响的下游任务集合与预计顺延天数。"""
    result = impact(_to_tasks(req), req.delayed_task_id, req.delay_days)
    affected_val = result.get("affected")
    days_val = result.get("est_delay_days")
    return ImpactResponse(
        affected=[str(x) for x in affected_val] if isinstance(affected_val, list) else [],
        est_delay_days=float(days_val) if isinstance(days_val, (int, float)) else 0.0,
    )
