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
    GroupingWeights,
    PreviewMoveRequest,
    PreviewMoveResponse,
)

router = APIRouter(prefix="/internal/grouping", dependencies=[Depends(require_internal_secret)], tags=["grouping"])


def _to_students(req: PreviewMoveRequest | GroupingSolveRequest) -> list[Student]:
    return [Student(id=s.id, name=s.name, skills=s.skills, class_id=s.class_id) for s in req.students]


def _apply_move(groups: list[list[str]], req: PreviewMoveRequest) -> list[list[str]]:
    """把一次移动应用到分组快照上（score/preview 的真实语义，规格书 S4.3）。

    - 按 user_id 实际所在组移动到 to_group（不信任 from_group，避免前端索引错位导致静默不动）；
    - 同时给 swap_with 则两人互换；
    - user_id 不在方案中或 from==to 时原样返回（纯打分模式）。
    """
    next_groups = [list(g) for g in groups]
    user = req.user_id
    from_idx = next((i for i, g in enumerate(next_groups) if user in g), None)
    if from_idx is None:
        return next_groups
    if req.swap_with:
        other = req.swap_with
        gb = next((i for i, g in enumerate(next_groups) if other in g), None)
        if gb is None or from_idx == gb:
            return next_groups
        next_groups[from_idx] = [other if m == user else m for m in next_groups[from_idx]]
        next_groups[gb] = [user if m == other else m for m in next_groups[gb]]
        return next_groups
    to_idx = req.to_group
    if from_idx == to_idx:
        return next_groups
    if not (0 <= to_idx < len(next_groups)):
        return next_groups
    next_groups[from_idx] = [m for m in next_groups[from_idx] if m != user]
    next_groups[to_idx].append(user)
    return next_groups


@router.post("/solve", response_model=GroupingSolveResponse)
def solve(req: GroupingSolveRequest) -> GroupingSolveResponse:
    """CP-SAT 求解，返回三套方案与四维得分（限时 10s，超时回退贪心）。

    三方案各自使用 STRATEGY_PRESETS 权重；req.weights 不覆盖策略预设。
    """
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
    """拖动预演（规格书 S4.3）：内存重算，<= 50ms，绝不重新求解。

    语义：先对 plan_groups 应用 user_id 的移动（或 swap_with 互换），
    再给出「移动前 → 移动后」四维得分与增减量；同时做硬约束校验。
    纯打分模式（from==to 或 user 不在方案中）时 before==after。
    """
    students = _to_students(req)
    before_groups = [list(g) for g in req.plan_groups]
    after_groups = _apply_move(before_groups, req)
    w = req.weights if req.weights is not None else GroupingWeights()

    before = score_plan(
        groups=before_groups,
        students=students,
        weights=w,
        edges=list(req.edges),
        history_pairs=list(req.history_pairs),
    )
    after = score_plan(
        groups=after_groups,
        students=students,
        weights=w,
        edges=list(req.edges),
        history_pairs=list(req.history_pairs),
    )
    violations = validate_plan(
        groups=after_groups,
        students=students,
        num_groups=req.num_groups,
        min_size=req.min_group_size,
        max_size=req.max_group_size,
        forbidden_pairs=list(req.forbidden_pairs),
        allow_cross_class=req.allow_cross_class,
    )
    deltas = {
        "skill_cover": round(after.skill_cover - before.skill_cover, 2),
        "weak_tie": round(after.weak_tie - before.weak_tie, 2),
        "balance": round(after.balance - before.balance, 2),
        "history_avoid": round(after.history_avoid - before.history_avoid, 2),
        "total": round(after.total - before.total, 2),
    }
    return PreviewMoveResponse(
        ok=not violations,
        violations=violations,
        deltas=deltas,
        total_before=before.total,
        total_after=after.total,
        scores={
            "skill_cover": after.skill_cover,
            "weak_tie": after.weak_tie,
            "balance": after.balance,
            "history_avoid": after.history_avoid,
            "total": after.total,
        },
    )


@router.post("/validate", response_model=PreviewMoveResponse)
def validate(req: PreviewMoveRequest) -> PreviewMoveResponse:
    """硬约束校验（H1/H2/H4/H5）。ok=false 时 violations 给出全部违规原因。"""
    students = _to_students(req)
    violations = validate_plan(
        groups=req.plan_groups,
        students=students,
        num_groups=req.num_groups,
        min_size=req.min_group_size,
        max_size=req.max_group_size,
        forbidden_pairs=list(req.forbidden_pairs),
        allow_cross_class=req.allow_cross_class,
    )
    return PreviewMoveResponse(ok=not violations, violations=violations)
