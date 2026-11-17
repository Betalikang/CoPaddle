"""多目标最优分组（共桨 M2 / 规格书 S4.2）。

实现要点：
- CP-SAT 声明式建模：硬约束（H1–H5）写进模型，解一定合法；
- 四维软目标全部线性化后加权合成单目标：
  * 技能覆盖：组内各能力维度是否存在 ≥3 的成员（布尔覆盖变量）；
  * 弱连接引入：组内「非强连接对数」最大（强连接对用 AND 变量线性化）；
  * 组间均衡：组实力 max−min 最小（hi/lo 变量）；
  * 历史规避：组内「非历史同组对数」最大；
- 弱连接/历史规避的展示口径（score_plan）是「1 − 不良对数 / 组内总对数」这种
  规模中性的比率，所以目标里只惩罚强连接/历史配对本身，组规模另用
  Σ|size_g − target| 显式惩罚（理由见目标函数处的注释）；
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
    name: str = ""
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


def _display_name(sid: str, by_id: dict[str, Student]) -> str:
    """违规提示用真实姓名，缺姓名时回退 id。"""
    s = by_id.get(sid)
    return (s.name or sid) if s else sid


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
    allow_cross_class: bool = True,
) -> list[MoveViolation]:
    """硬约束校验（H1/H2/H4/H5，规格书 S4.2；已去掉 H3 必须同组）。返回违规清单，空列表 = 合法。"""
    forbidden_pairs = forbidden_pairs or []
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
                    MoveViolation(
                        code="H5",
                        message=f"{_display_name(m, by_id)} 被重复分配到第 {seen[m] + 1} 组和第 {gi + 1} 组",
                    )
                )
            seen[m] = gi

    missing = [s for s in students if s.id not in seen]
    if missing:
        names = [_display_name(s.id, by_id) for s in missing[:5]]
        violations.append(
            MoveViolation(code="H5", message=f"未分配：{'、'.join(names)}{' 等' if len(missing) > 5 else ''}")
        )

    for a, b in forbidden_pairs:
        if a in seen and b in seen and seen[a] == seen[b]:
            violations.append(
                MoveViolation(
                    code="H2",
                    message=f"{_display_name(a, by_id)} 与 {_display_name(b, by_id)} 不可同组",
                )
            )

    return violations


def _greedy_groups(
    students: list[Student],
    num_groups: int,
    min_size: int,
    max_size: int,
    forbidden_pairs: list[tuple[str, str]],
    allow_cross_class: bool,
) -> list[list[str]] | None:
    """贪心兜底：先定每组目标人数，再按实力降序轮询放入最空的可行组。

    目标人数 = 均分 + 余数（`divmod(n, G)`，前 rem 组各多 1 人）：调用方已保证
    n ∈ [G·min_size, G·max_size]，均分值必然落在 [min_size, max_size] 内，因此
    兜底结果天然满足 H1。旧实现只看 `len(g) >= max_size` 且从第 0 组开始填满，
    n=12/G=3/min=3/max=5 会产出 [5,5,2] 而被 validate_plan 判 H1 违规 → 假 infeasible。
    """
    by_id = {s.id: s for s in students}
    if num_groups <= 0:
        return None
    forbidden_set = set(forbidden_pairs) | {(b, a) for a, b in forbidden_pairs}
    groups: list[list[str]] = [[] for _ in range(num_groups)]
    ordered = sorted(students, key=_power, reverse=True)

    base, rem = divmod(len(students), num_groups)
    target = [base + (1 if gi < rem else 0) for gi in range(num_groups)]

    def class_ok(pool: list[str]) -> bool:
        """H4：不混班时同一组只能有一个班级（空组/单人组总是可以）。"""
        if allow_cross_class or len(pool) <= 1:
            return True
        cls = by_id[pool[0]].class_id
        return all(by_id[m].class_id == cls for m in pool[1:])

    def fits(pool: list[str], sid: str) -> bool:
        """sid 放进 pool 后 H2（不可同组）与 H4（班级）都成立。"""
        return class_ok([*pool, sid]) and all((sid, m) not in forbidden_set for m in pool)

    def has_room(gi: int) -> bool:
        return len(groups[gi]) < target[gi]

    def fill_key(gi: int, sid: str) -> tuple[int, int, int]:
        """第一遍的选组优先级：先收拢同班，再均衡人数。

        禁混班时必须让「已含本班」严格优先于「空组」——否则两个班会被均衡地
        摊成各半（a0→g0、a1→g1…），随后两组的班级都与新同学不符，
        明明 [4 个 c0][4 个 c1] 可行却报无解。
        三个档位：0=已含本班，1=空组（可起头），2=异班（fits 会拒）。
        """
        if allow_cross_class:
            return (0, len(groups[gi]), gi)
        pool = groups[gi]
        if not pool:
            return (1, 0, gi)
        if by_id[pool[0]].class_id == by_id[sid].class_id:
            return (0, len(pool), gi)
        return (2, len(pool), gi)

    for s in ordered:
        placed = False
        # 第一遍：放进「最空且可行」的组（同时均衡各组实力）。
        # 禁混班时要先优先「已含本班」的组，否则两个班会被均衡地摊成各半，
        # 随后两组的班级都与新同学不符 → 明明 [4 个 c0][4 个 c1] 可行却报无解。
        # 第一遍：按 fill_key 选组（禁混班先收拢同班，否则最空优先以均衡实力）
        for gi in sorted(range(num_groups), key=lambda g: fill_key(g, s.id)):
            if not has_room(gi) or not fits(groups[gi], s.id):
                continue
            groups[gi].append(s.id)
            placed = True
            break
        # 第二遍：把目标组里「与 s 冲突」的成员移到还有空位的别组，腾出位置。
        # 注意移走的是冲突者本身（旧实现按 `not in forbidden_set` 取，移走的恰好是
        # 不冲突的人，冲突者留在组里再 append s → H2 违规，又一类假 infeasible）。
        if not placed:
            for gi in range(num_groups):
                for m in [x for x in groups[gi] if (s.id, x) in forbidden_set]:
                    rest = [x for x in groups[gi] if x != m]
                    if not fits(rest, s.id):
                        continue  # 该组还有别的冲突者，移走一个不够
                    for gj in range(num_groups):
                        if gj == gi or not has_room(gj) or not fits(groups[gj], m):
                            continue
                        groups[gi].remove(m)
                        groups[gj].append(m)
                        groups[gi].append(s.id)
                        placed = True
                        break
                    if placed:
                        break
                if placed:
                    break
        # 第三遍：唯一还有空位的组恰好就是 s 冲突的那组、其余组都已满——
        # 此时需要三向轮换：gi 的冲突者 m 换到满组 gj，gj 的 x 换进 gi，s 也进 gi
        # （gi 净 +1 达到目标人数，gj 人数不变）。没有这一步，n 人 n-1 落位的收尾
        # 会大量误报 infeasible。
        if not placed:
            for gi in range(num_groups):
                if not has_room(gi):
                    continue
                for m in [x for x in groups[gi] if (s.id, x) in forbidden_set]:
                    rest = [x for x in groups[gi] if x != m]
                    if any((s.id, x) in forbidden_set for x in rest):
                        continue
                    for gj in range(num_groups):
                        if gj == gi or has_room(gj):
                            continue
                        for x in groups[gj]:
                            tail = [y for y in groups[gj] if y != x]
                            if (m, x) in forbidden_set or (s.id, x) in forbidden_set:
                                continue
                            if not fits(rest, x) or not fits([*rest, x], s.id):
                                continue
                            if not fits(tail, m):
                                continue
                            groups[gi].remove(m)
                            groups[gj].remove(x)
                            groups[gi].extend([x, s.id])
                            groups[gj].append(m)
                            placed = True
                            break
                        if placed:
                            break
                    if placed:
                        break
                if placed:
                    break
        if not placed:
            return None

    # 兜底结果自检：H1 规模与 H5 全员覆盖（人数守恒由「每人只放一次」保证）
    if sum(len(g) for g in groups) != len(students):
        return None
    if any(not (min_size <= len(g) <= max_size) for g in groups):
        return None
    return groups


def solve_grouping(
    students: list[Student],
    num_groups: int,
    min_size: int,
    max_size: int,
    weights: GroupingWeights | None = None,
    forbidden_pairs: list[tuple[str, str]] | None = None,
    allow_cross_class: bool = True,
    edges: list[tuple[str, str, float]] | None = None,
    history_pairs: list[tuple[str, str]] | None = None,
    time_limit: float = 10.0,
) -> SolveResult:
    """CP-SAT 求解三套分组方案（规格书 S4.2）。

    失败降级：超时/无解时回退贪心 + 局部交换，结果标注快速模式（S4.10）。
    硬约束仅保留不可同组（H2），已去掉必须同组（H3）。
    """
    forbidden_pairs = forbidden_pairs or []
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

    # 三套方案共享同一时间预算（规格书 S4.2：10s 为总预算），每套保底 1s
    # 三方案必须使用各自的策略预设权重（skill/weaktie/fairness），
    # 否则 A/B/C 会退化成同一套权重的三次随机扰动（规格书 S4.2）。
    # 入参 weights 仅用于 score/preview 的统一打分口径，不覆盖策略预设。
    per_plan_limit = max(time_limit / len(STRATEGY_PRESETS), 1.0)
    for strategy, (label, preset) in STRATEGY_PRESETS.items():
        w = preset
        groups = None
        if n <= MAX_STUDENTS_FOR_CPSAT:
            groups = _solve_once(
                students,
                num_groups,
                min_size,
                max_size,
                w,
                forbidden_pairs,
                allow_cross_class,
                edges,
                history_pairs,
                per_plan_limit,
            )
        if groups is None:
            degraded = True
            groups = _greedy_groups(
                students,
                num_groups,
                min_size,
                max_size,
                forbidden_pairs,
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
                allow_cross_class,
            ):
                return SolveResult(
                    status="infeasible",
                    detail="约束组合无可行解（常见原因：不可同组配对过多）",
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

    # H2 不可同组（H3 必须同组已去掉）
    # forbidden_pairs 可能指向已不再 active（不在本次 students 里）的学生，
    # x 只有 (student.id, g) 键，直接取会抛 KeyError → 与下方 pair_and_terms 一致先过滤。
    for a, b in forbidden_pairs:
        if a not in by_id or b not in by_id:
            continue
        for g in range(G):
            m.AddAtMostOne([x[a, g], x[b, g]])

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

    # 组规模偏差项：展示口径的四维得分都是比率，组规模本身不应出现在目标里。
    # target 用 n // G（余数由均衡项与偏差项自然分摊），dev 取 |size_g − target|
    # 的线性化上界（dev ≥ ±(size_g − target)）。
    target_size = n // G
    size_dev_terms = []
    for g in range(G):
        dev = m.NewIntVar(0, n, f"size_dev_{g}")
        m.Add(dev >= size[g] - target_size)
        m.Add(dev >= target_size - size[g])
        size_dev_terms.append(dev)

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
    # 展示口径（score_plan）是规模中性的比率：
    #   weak_tie = 1 − 强连接对数 / 组内总对数，history_avoid = 1 − 历史同组对数 / 组内总对数。
    # 旧目标写的是 sum(pairs2) − 2×强连接对数，把凸项 Σ size_g·(size_g−1) 以正号
    # 计入目标两次（弱连接与历史各一次），等价于奖励规模不均：12 人 3 组会偏向
    # [5,4,3]（Σ size² = 50）而不是 [4,4,4]（Σ size² = 48），而后者在展示口径下更高。
    # 现在两项只保留「惩罚不良配对」的部分（与比率的分子同向），
    # 规模中性由下面的 abs_dev 项显式承担：
    #   目标 = w_skill·覆盖 − w_weak·强连接对数 − w_hist·历史对数
    #          − w_balance·(max P − min P) − (w_weak + w_hist)·Σ|size_g − target|
    weak_expr = -2 * sum(strong_terms)
    hist_expr = -2 * sum(hist_pair_terms)

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
    # 规模偏差项的归一化与 pair 项同一口径（all_pairs = n(n−1) = 2×总对数），
    # 权重取 weak_tie + history_avoid：与旧目标里两处凸项的杠杆同量级，
    # 但符号反过来——旧目标奖励规模不均，新目标惩罚规模不均。
    size_coef = round(SCALE * (w.weak_tie + w.history_avoid) * 1000 / all_pairs)

    obj = (
        skill_coef * sum(cover_terms)
        + weak_coef * weak_expr
        + hist_coef * hist_expr
        - balance_coef * spread
        - size_coef * sum(size_dev_terms)
    )
    m.Maximize(obj)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max(time_limit, 1.0)
    solver.parameters.num_workers = 4
    status = solver.Solve(m)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None

    return [[s.id for s in students if solver.Value(x[s.id, g])] for g in range(G)]
