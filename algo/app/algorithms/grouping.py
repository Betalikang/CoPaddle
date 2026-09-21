"""多目标最优分组（共桨 M2 / 规格书 S4.2）。

实现要点：
- CP-SAT 声明式建模：硬约束（H1–H5）写进模型，解一定合法；
- 四维软目标全部线性化后加权合成单目标：
  * 技能覆盖：组内各能力维度是否存在 ≥3 的成员（布尔覆盖变量）；
  * 弱连接引入：组内「非强连接对数」最大（强连接对用 AND 变量线性化）；
  * 组间均衡：组实力 max−min 最小（hi/lo 变量）；
  * 历史规避：组内「非历史同组对数」最大；
- 组内总对数用 size·(size−1) 表达（避免除法，偶数性由乘法天然保证）；
- 班内限制（H4）用班级计数布尔聚合，避免 O(n²·G) 约束；
- 超时/失败降级：贪心 + 局部交换（规格书 S4.10），结果标注快速模式。

打分（score_plan）与求解目标分离：目标为线性近似，打分按 S4.2 原始公式，
用于界面展示与 preview-move 的实时重算。
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from ortools.sat.python import cp_model

from ..schemas import (
    GroupingPlanScores,
    GroupingWeights,
    MoveViolation,
)

# 三套方案的权重预设（规格书 S4.2）
STRATEGY_PRESETS: dict[str, tuple[str, GroupingWeights]] = {
    "skill_first": (
        "方案A · 能力互补优先（推荐）",
        GroupingWeights(skill_cover=1.5, weak_tie=0.6, balance=1.2, history_avoid=1.0),
    ),
    "weaktie_first": (
        "方案B · 弱连接优先",
        GroupingWeights(skill_cover=1.0, weak_tie=1.6, balance=1.0, history_avoid=0.8),
    ),
    "fairness_first": (
        "方案C · 公平优先",
        GroupingWeights(skill_cover=1.0, weak_tie=0.6, balance=1.8, history_avoid=1.2),
    ),
}

# CP-SAT 的 pair AND 变量规模上限；超过则只用贪心（保护求解时间）
MAX_STUDENTS_FOR_CPSAT = 200


@dataclass
class Student:
    id: str
    skills: dict[str, int] = field(default_factory=dict)
    class_id: str | None = None


@dataclass
class Plan:
    label: str
    strategy: str
    groups: list[list[str]]
    scores: GroupingPlanScores
    explanation: str = ""


@dataclass
class SolveResult:
    status: str  # ok | infeasible | timeout | error
    plans: list[Plan] = field(default_factory=list)
    detail: str = ""


def _power(s: Student) -> int:
    return sum(s.skills.values())


def _pairs(students: list[Student]) -> int:
    n = len(students)
    return n * (n - 1) // 2


def score_plan(
    groups: list[list[str]],
    students: list[Student],
    weights: GroupingWeights,
    edges: list[tuple[str, str, float]] | None = None,
    history_pairs: list[tuple[str, str]] | None = None,
) -> GroupingPlanScores:
    """按规格书 S4.2 原始公式给一套分组打分（0–100，越高越好）。O(n)，供 preview-move 用。"""
    by_id = {s.id: s for s in students}
    dims = sorted({d for s in students for d in s.skills})
    n_dims = max(len(dims), 1)

    edges = edges or []
    history_pairs = history_pairs or []
    strong = {frozenset((a, b)) for a, b, w in edges if w >= 0.5}
    history = {frozenset((a, b)) for a, b in history_pairs}

    # ---- 维度 1：技能覆盖度 ----
    covers = []
    for g in groups:
        member_ids = [m for m in g if m in by_id]
        covered = sum(1 for d in dims if any((by_id[m].skills.get(d, 0) >= 3) for m in member_ids))
        covers.append(covered / n_dims)
    mean_cover = sum(covers) / max(len(covers), 1)
    min_cover = min(covers) if covers else 0.0
    score_skill = 100 * (0.7 * mean_cover + 0.3 * min_cover)

    # ---- 维度 2：弱连接引入度 ----
    novelties = []
    for g in groups:
        member_ids = [m for m in g if m in by_id]
        total = len(member_ids) * (len(member_ids) - 1) // 2
        if total == 0:
            novelties.append(1.0)
            continue
        strong_count = sum(
            1
            for i in range(len(member_ids))
            for j in range(i + 1, len(member_ids))
            if frozenset((member_ids[i], member_ids[j])) in strong
        )
        novelties.append(1 - strong_count / total)
    score_weak = 100 * (sum(novelties) / max(len(novelties), 1))

    # ---- 维度 3：组间均衡度 ----
    powers = [sum(_power(by_id[m]) for m in g if m in by_id) for g in groups]
    if powers and sum(powers) > 0:
        mean_p = sum(powers) / len(powers)
        var = sum((p - mean_p) ** 2 for p in powers) / len(powers)
        std = math.sqrt(var)
        score_balance = 100 * max(0.0, min(1.0, 1 - std / mean_p))
    else:
        score_balance = 100.0

    # ---- 维度 4：历史搭档规避 ----
    repeats = []
    for g in groups:
        member_ids = [m for m in g if m in by_id]
        total = len(member_ids) * (len(member_ids) - 1) // 2
        if total == 0:
            repeats.append(0.0)
            continue
        rep = sum(
            1
            for i in range(len(member_ids))
            for j in range(i + 1, len(member_ids))
            if frozenset((member_ids[i], member_ids[j])) in history
        )
        repeats.append(rep / total)
    score_hist = 100 * (1 - (sum(repeats) / max(len(repeats), 1)))

    w = weights
    denom = w.skill_cover + w.weak_tie + w.balance + w.history_avoid
    total_score = (
        w.skill_cover * score_skill + w.weak_tie * score_weak + w.balance * score_balance + w.history_avoid * score_hist
    ) / (denom if denom > 0 else 1)

    return GroupingPlanScores(
        skill_cover=round(score_skill, 2),
        weak_tie=round(score_weak, 2),
        balance=round(score_balance, 2),
        history_avoid=round(score_hist, 2),
        total=round(total_score, 2),
    )


def validate_plan(
    groups: list[list[str]],
    students: list[Student],
    num_groups: int,
    min_size: int,
    max_size: int,
    forbidden_pairs: list[tuple[str, str]] | None = None,
    required_pairs: list[tuple[str, str]] | None = None,
    allow_cross_class: bool = True,
) -> list[MoveViolation]:
    """硬约束校验（H1–H5，规格书 S4.2）。返回违规清单，空列表 = 合法。"""
    forbidden_pairs = forbidden_pairs or []
    required_pairs = required_pairs or []
    by_id = {s.id: s for s in students}
    violations: list[MoveViolation] = []

    if len(groups) != num_groups:
        violations.append(MoveViolation(code="H5", message=f"组数应为 {num_groups}，实际 {len(groups)}"))

    seen: dict[str, int] = {}
    for gi, g in enumerate(groups):
        if not g:
            violations.append(MoveViolation(code="H5", message=f"第 {gi + 1} 组为空"))
            continue
        if not (min_size <= len(g) <= max_size):
            violations.append(
                MoveViolation(code="H1", message=f"第 {gi + 1} 组人数 {len(g)} 超出 [{min_size}, {max_size}]")
            )
        if not allow_cross_class:
            class_ids = {by_id[m].class_id for m in g if m in by_id and by_id[m].class_id is not None}
            if len(class_ids) > 1:
                violations.append(
                    MoveViolation(
                        code="H4",
                        message=f"第 {gi + 1} 组跨班（{'、'.join(sorted(c for c in class_ids if c is not None))}）",
                    )
                )
        for m in g:
            if m in seen:
                violations.append(
                    MoveViolation(code="H5", message=f"{m} 被重复分配到第 {seen[m] + 1} 组和第 {gi + 1} 组")
                )
            seen[m] = gi

    missing = [s.id for s in students if s.id not in seen]
    if missing:
        violations.append(
            MoveViolation(code="H5", message=f"未分配：{'、'.join(missing[:5])}{' 等' if len(missing) > 5 else ''}")
        )

    for a, b in forbidden_pairs:
        if a in seen and b in seen and seen[a] == seen[b]:
            violations.append(MoveViolation(code="H2", message=f"{a} 与 {b} 不可同组"))
    for a, b in required_pairs:
        if a in seen and b in seen and seen[a] != seen[b]:
            violations.append(MoveViolation(code="H3", message=f"{a} 与 {b} 必须同组"))

    return violations


def _greedy_groups(
    students: list[Student],
    num_groups: int,
    min_size: int,
    max_size: int,
    forbidden_pairs: list[tuple[str, str]],
    required_pairs: list[tuple[str, str]],
    allow_cross_class: bool,
) -> list[list[str]] | None:
    """贪心兜底：按实力降序轮询放入第一个可行组（满足硬约束）。"""
    by_id = {s.id: s for s in students}
    forbidden_set = set(forbidden_pairs) | {(b, a) for a, b in forbidden_pairs}
    groups: list[list[str]] = [[] for _ in range(num_groups)]
    group_of: dict[str, int] = {}
    ordered = sorted(students, key=_power, reverse=True)

    def feasible(gi: int, sid: str) -> bool:
        g = groups[gi]
        if len(g) >= max_size:
            return False
        s = by_id[sid]
        if not allow_cross_class and g:
            if any(by_id[m].class_id != s.class_id for m in g):
                return False
        for m in g:
            if (sid, m) in forbidden_set:
                return False
        return True

    for s in ordered:
        placed = False
        # 第一遍：直接放入第一个可行组
        for gi in range(num_groups):
            if feasible(gi, s.id):
                groups[gi].append(s.id)
                group_of[s.id] = gi
                placed = True
                break
        # 第二遍：换位放置——把目标组里某个无冲突成员移到别组，腾出位置
        if not placed:
            for gi in range(num_groups):
                movable = [m for m in groups[gi] if (s.id, m) not in forbidden_set]
                for m in movable:
                    for gj in range(num_groups):
                        if gj == gi or len(groups[gj]) >= max_size:
                            continue
                        if any((m, x) in forbidden_set for x in groups[gj]):
                            continue
                        if not allow_cross_class and groups[gj]:
                            if any(by_id[x].class_id != by_id[m].class_id for x in groups[gj]):
                                continue
                        groups[gi].remove(m)
                        groups[gj].append(m)
                        groups[gi].append(s.id)
                        group_of[m] = gj
                        group_of[s.id] = gi
                        placed = True
                        break
                    if placed:
                        break
                if placed:
                    break
        if not placed:
            return None

    # required pairs 捆绑检查：贪心未保证同组，做一次修复交换
    for a, b in required_pairs:
        if group_of.get(a) == group_of.get(b):
            continue
        ga, gb = group_of[a], group_of[b]
        # 找 gb 中可与 a 交换的成员
        for m in list(groups[gb]):
            if m == b:
                continue
            groups[ga].remove(a)
            groups[gb].remove(m)
            groups[ga].append(m)
            groups[gb].append(a)
            if not validate_plan(
                groups, students, num_groups, min_size, max_size, forbidden_pairs, required_pairs, allow_cross_class
            ):
                group_of[a], group_of[m] = gb, ga
                break
            groups[ga].remove(m)
            groups[gb].remove(a)
            groups[ga].append(a)
            groups[gb].append(m)
    return groups


def solve_grouping(
    students: list[Student],
    num_groups: int,
    min_size: int,
    max_size: int,
    weights: GroupingWeights | None = None,
    forbidden_pairs: list[tuple[str, str]] | None = None,
    required_pairs: list[tuple[str, str]] | None = None,
    allow_cross_class: bool = True,
    edges: list[tuple[str, str, float]] | None = None,
    history_pairs: list[tuple[str, str]] | None = None,
    time_limit: float = 10.0,
) -> SolveResult:
    """CP-SAT 求解三套分组方案（规格书 S4.2）。

    失败降级：超时/无解时回退贪心 + 局部交换，结果标注快速模式（S4.10）。
    """
    forbidden_pairs = forbidden_pairs or []
    required_pairs = required_pairs or []
    edges = edges or []
    history_pairs = history_pairs or []

    # 输入自检：规模约束是否先天不可行
    n = len(students)
    if n < num_groups * min_size or n > num_groups * max_size:
        return SolveResult(
            status="infeasible",
            detail=f"{n} 人无法分成 {num_groups} 组且每组 [{min_size}, {max_size}] 人，请调整组数或规模约束",
        )

    plans: list[Plan] = []
    degraded = False

    for strategy, (label, preset) in STRATEGY_PRESETS.items():
        w = weights or preset
        groups = None
        if n <= MAX_STUDENTS_FOR_CPSAT:
            groups = _solve_once(
                students,
                num_groups,
                min_size,
                max_size,
                w,
                forbidden_pairs,
                required_pairs,
                allow_cross_class,
                edges,
                history_pairs,
                time_limit,
            )
        if groups is None:
            degraded = True
            groups = _greedy_groups(
                students,
                num_groups,
                min_size,
                max_size,
                forbidden_pairs,
                required_pairs,
                allow_cross_class,
            )
            # 贪心只是兜底：必须过全部硬约束，否则视为无解（规格书 S4.10/S9.1）
            if groups is None or validate_plan(
                groups,
                students,
                num_groups,
                min_size,
                max_size,
                forbidden_pairs,
                required_pairs,
                allow_cross_class,
            ):
                return SolveResult(
                    status="infeasible",
                    detail="约束组合无可行解（常见原因：不可同组配对过多、必须同组人数超过组规模上限）",
                )
        scores = score_plan(groups, students, w, edges, history_pairs)
        plans.append(Plan(label=label, strategy=strategy, groups=groups, scores=scores))

    return SolveResult(status="ok", plans=plans, detail="快速模式（贪心兜底）" if degraded else "")


def _solve_once(
    students: list[Student],
    num_groups: int,
    min_size: int,
    max_size: int,
    weights: GroupingWeights,
    forbidden_pairs: list[tuple[str, str]],
    required_pairs: list[tuple[str, str]],
    allow_cross_class: bool,
    edges: list[tuple[str, str, float]],
    history_pairs: list[tuple[str, str]],
    time_limit: float,
) -> list[list[str]] | None:
    by_id = {s.id: s for s in students}
    dims = sorted({d for s in students for d in s.skills})
    n_dims = max(len(dims), 1)
    n = len(students)
    G = num_groups
    total_power = sum(_power(s) for s in students) or 1
    all_pairs = n * (n - 1) or 1  # ×2 后的总对数（2×C(n,2)）

    m = cp_model.CpModel()
    x = {(s.id, g): m.NewBoolVar(f"x_{s.id}_{g}") for s in students for g in range(G)}

    # H1/H5：每人恰好一组；组规模上下限
    for s in students:
        m.AddExactlyOne(x[s.id, g] for g in range(G))
    size = {g: sum(x[s.id, g] for s in students) for g in range(G)}
    for g in range(G):
        m.Add(size[g] >= min_size)
        m.Add(size[g] <= max_size)

    # H2 不可同组 / H3 必须同组
    for a, b in forbidden_pairs:
        for g in range(G):
            m.AddAtMostOne([x[a, g], x[b, g]])
    for a, b in required_pairs:
        for g in range(G):
            m.Add(x[a, g] == x[b, g])

    # H4 同班限制：每组至多一个班级（班级计数布尔聚合，避免 O(n²·G)）
    if not allow_cross_class:
        class_ids = sorted({s.class_id for s in students if s.class_id is not None})
        for g in range(G):
            cg_vars = []
            for c in class_ids:
                members = [s.id for s in students if s.class_id == c]
                cg = m.NewBoolVar(f"cg_{c}_{g}")
                for sid in members:
                    m.Add(cg >= x[sid, g])
                m.Add(cg <= sum(x[sid, g] for sid in members))
                cg_vars.append(cg)
            m.Add(sum(cg_vars) <= 1)

    # 组内总对数（2×C(size,2) = size·(size−1)），乘法等式由 CP-SAT 线性化
    pairs2 = {}
    for g in range(G):
        p2 = m.NewIntVar(0, n * n, f"pairs2_{g}")
        m.AddMultiplicationEquality(p2, [size[g], size[g] - 1])
        pairs2[g] = p2

    # ---- 维度 1：技能覆盖（布尔覆盖变量）----
    cover_terms = []
    for g in range(G):
        for d in dims:
            capable = [s.id for s in students if s.skills.get(d, 0) >= 3]
            if not capable:
                continue
            cv = m.NewBoolVar(f"cv_{g}_{d}")
            for sid in capable:
                m.Add(cv >= x[sid, g])
            m.Add(cv <= sum(x[sid, g] for sid in capable))
            cover_terms.append(cv)

    # ---- 维度 2/4：弱连接与历史规避（强连接/历史对用 AND 变量，只建一次）----
    def pair_and_terms(pairs: set[frozenset[str]]) -> list[Any]:
        terms: list[Any] = []
        for g in range(G):
            for pr in pairs:
                a, b = tuple(pr)
                if a not in by_id or b not in by_id:
                    continue
                z = m.NewBoolVar(f"z_{a}_{b}_{g}")
                m.Add(z <= x[a, g])
                m.Add(z <= x[b, g])
                m.Add(z >= x[a, g] + x[b, g] - 1)
                terms.append(z)
        return terms

    strong_pairs = {frozenset((a, b)) for a, b, w in edges if w >= 0.5}
    hist_pairs = {frozenset((a, b)) for a, b in history_pairs}
    strong_terms = pair_and_terms(strong_pairs)
    hist_pair_terms = pair_and_terms(hist_pairs)
    # 组内「非强连接对数」= 组内总对数 − 2×强连接对数（pairs2 已是 2×C(size,2)）
    weak_expr = sum(pairs2.values()) - 2 * sum(strong_terms)
    hist_expr = sum(pairs2.values()) - 2 * sum(hist_pair_terms)

    # ---- 维度 3：组间均衡（max−min 最小化）----
    tot = {g: sum(x[s.id, g] * _power(s) for s in students) for g in range(G)}
    hi = m.NewIntVar(0, total_power, "hi")
    lo = m.NewIntVar(0, total_power, "lo")
    for g in range(G):
        m.Add(tot[g] <= hi)
        m.Add(tot[g] >= lo)
    spread = hi - lo

    # 单目标：四维加权。归一化系数全部取整（ortools 线性表达式不支持除法），
    # SCALE 保证小权重（0.05 步进）也有足够精度。
    w = weights
    SCALE = 1000
    skill_coef = round(SCALE * w.skill_cover * 1000 / (n_dims * G))
    weak_coef = round(SCALE * w.weak_tie * 1000 / all_pairs)
    hist_coef = round(SCALE * w.history_avoid * 1000 / all_pairs)
    balance_coef = round(SCALE * w.balance * 1000 / total_power)

    obj = skill_coef * sum(cover_terms) + weak_coef * weak_expr + hist_coef * hist_expr - balance_coef * spread
    m.Maximize(obj)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max(time_limit, 1.0)
    solver.parameters.num_workers = 4
    status = solver.Solve(m)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None

    return [[s.id for s in students if solver.Value(x[s.id, g])] for g in range(G)]
