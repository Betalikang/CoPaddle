"""分组求解相关内部接口（支撑 B-06 分组编排，规格书 S2）。

solve：CP-SAT 求解三套方案（限时，超时降级贪心）；
score：给定方案打分（preview-move 用，不重新求解）；
validate：硬约束校验（H1–H5）。
"""

from fastapi import APIRouter, Depends, HTTPException

from ..algorithms.grouping import (
    Student,
    score_plan,
    solve_grouping,
    validate_plan,
)
from ..deps import require_internal_secret
from ..schemas import (
    GroupingPlan,
    GroupingSolveRequest,
    GroupingSolveResponse,
    PreviewMoveRequest,
    PreviewMoveResponse,
)

router = APIRouter(prefix="/internal/grouping", dependencies=[Depends(require_internal_secret)], tags=["grouping"])


def _to_students(req: PreviewMoveRequest | GroupingSolveRequest) -> list[Student]:
    return [Student(id=s.id, skills=s.skills, class_id=s.class_id) for s in req.students]


@router.post("/solve", response_model=GroupingSolveResponse)
def solve(req: GroupingSolveRequest) -> GroupingSolveResponse:
    """CP-SAT 求解，返回三套方案与四维得分（限时 10s，超时回退贪心）。"""
    students = _to_students(req)
    if len(students) != len({s.id for s in students}):
        raise HTTPException(status_code=400, detail="学生 id 重复")

    result = solve_grouping(
        students=students,
        num_groups=req.num_groups,
        min_size=req.min_group_size,
        max_size=req.max_group_size,
        weights=req.weights,
        forbidden_pairs=list(req.forbidden_pairs),
        required_pairs=list(req.required_pairs),
        edges=list(req.edges),
        history_pairs=list(req.history_pairs),
        time_limit=req.time_limit_seconds,
    )

    plans = [
        GroupingPlan(
            label=p.label,
            strategy=p.strategy,
            groups=p.groups,
            scores=p.scores,
            explanation=p.explanation,
        )
        for p in result.plans
    ]
    return GroupingSolveResponse(
        run_id="",
        status=result.status,
        plans=plans,
        detail=result.detail,
        degraded="快速模式" in result.detail,
    )


@router.post("/score", response_model=PreviewMoveResponse)
def score(req: PreviewMoveRequest) -> PreviewMoveResponse:
    """给定方案打分（preview-move 用，不重新求解，内存重算，<= 50ms）。"""
    students = _to_students(req)
    scores = score_plan(
        groups=req.plan_groups,
        students=students,
        weights=req.weights,
        edges=list(req.edges),
        history_pairs=list(req.history_pairs),
    )
    return PreviewMoveResponse(
        ok=True,
        violations=[],
        deltas={},
        total_before=scores.total,
        total_after=scores.total,
    )


@router.post("/validate", response_model=PreviewMoveResponse)
def validate(req: PreviewMoveRequest) -> PreviewMoveResponse:
    """硬约束校验（H1–H5）。ok=false 时 violations 给出全部违规原因。"""
    students = _to_students(req)
    violations = validate_plan(
        groups=req.plan_groups,
        students=students,
        num_groups=req.num_groups,
        min_size=req.min_group_size,
        max_size=req.max_group_size,
        forbidden_pairs=list(req.forbidden_pairs),
        required_pairs=list(req.required_pairs),
        allow_cross_class=req.allow_cross_class,
    )
    return PreviewMoveResponse(ok=not violations, violations=violations)
