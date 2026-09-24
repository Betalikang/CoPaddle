"""分组算法测试（规格书 S9.1 相关断言 + S4.2 公式核对）。"""

import time

import pytest

from app.algorithms.grouping import (
    Student,
    _greedy_groups,
    score_plan,
    solve_grouping,
    validate_plan,
)
from app.schemas import GroupingWeights


def make_students(n: int, dims: tuple[str, ...] = ("编程", "写作", "数据分析")) -> list[Student]:
    """构造确定性测试画像：能力按 index 轮转，避免随机波动。"""
    students = []
    for i in range(n):
        skills = {d: (i + j) % 6 for j, d in enumerate(dims)}
        students.append(Student(id=f"u{i + 1}", name=f"学生{i + 1}", skills=skills, class_id=f"c{i % 2}"))
    return students


def test_basic_solve_two_groups() -> None:
    students = make_students(4)
    result = solve_grouping(students, num_groups=2, min_size=2, max_size=2)
    assert result.status == "ok"
    assert len(result.plans) == 3
    for plan in result.plans:
        assert len(plan.groups) == 2
        assert sorted(m for g in plan.groups for m in g) == [s.id for s in students]
        for g in plan.groups:
            assert len(g) == 2


def test_three_strategies_present() -> None:
    students = make_students(12)
    result = solve_grouping(students, num_groups=3, min_size=3, max_size=5)
    assert result.status == "ok"
    strategies = [p.strategy for p in result.plans]
    assert strategies == ["skill_first", "weaktie_first", "fairness_first"]
    # 每个方案都带四维得分与总分
    for plan in result.plans:
        s = plan.scores
        assert 0 <= s.skill_cover <= 100
        assert 0 <= s.weak_tie <= 100
        assert 0 <= s.balance <= 100
        assert 0 <= s.history_avoid <= 100
        assert 0 <= s.total <= 100


def test_scores_match_formula() -> None:
    """solve 返回的得分必须与 score_plan 公式一致（界面展示与求解同源）。"""
    students = make_students(10)
    edges = [("u1", "u2", 0.9), ("u3", "u4", 0.2)]
    history = [("u5", "u6")]
    result = solve_grouping(
        students,
        num_groups=2,
        min_size=5,
        max_size=5,
        edges=edges,
        history_pairs=history,
    )
    assert result.status == "ok"
    for plan in result.plans:
        expected = score_plan(plan.groups, students, _weights_of(plan), edges, history)
        assert abs(plan.scores.total - expected.total) < 0.5


def _weights_of(plan) -> GroupingWeights:
    from app.algorithms.grouping import STRATEGY_PRESETS

    return STRATEGY_PRESETS[plan.strategy][1]


def test_forbidden_pair_separated() -> None:
    students = make_students(8)
    result = solve_grouping(
        students,
        num_groups=2,
        min_size=4,
        max_size=4,
        forbidden_pairs=[("u1", "u2")],
    )
    assert result.status == "ok"
    for plan in result.plans:
        group_of = {m: gi for gi, g in enumerate(plan.groups) for m in g}
        assert group_of["u1"] != group_of["u2"]


def test_same_class_constraint() -> None:
    students = make_students(8)  # class_id = c0/c1 交替
    result = solve_grouping(
        students,
        num_groups=2,
        min_size=4,
        max_size=4,
        allow_cross_class=False,
    )
    assert result.status == "ok"
    by_id = {s.id: s for s in students}
    for plan in result.plans:
        for g in plan.groups:
            assert len({by_id[m].class_id for m in g}) == 1


def test_infeasible_size() -> None:
    students = make_students(3)
    result = solve_grouping(students, num_groups=2, min_size=2, max_size=2)
    assert result.status == "infeasible"
    assert result.detail


def test_validate_plan_violations() -> None:
    students = make_students(4)
    # 超规模 + 未分配
    groups = [["u1", "u2", "u3"], ["u4"]]
    violations = validate_plan(groups, students, num_groups=2, min_size=2, max_size=2)
    assert any(v.code == "H1" for v in violations)
    # 合法分组无违规
    ok_groups = [["u1", "u2"], ["u3", "u4"]]
    assert validate_plan(ok_groups, students, num_groups=2, min_size=2, max_size=2) == []


def test_violation_messages_use_real_names() -> None:
    """违规提示用真实姓名，不用内部 id。"""
    students = make_students(4)
    groups = [["u1", "u2"], ["u3", "u4"]]
    violations = validate_plan(
        groups,
        students,
        num_groups=2,
        min_size=2,
        max_size=2,
        forbidden_pairs=[("u1", "u2")],
    )
    assert any(v.code == "H2" and "学生1" in v.message and "学生2" in v.message for v in violations)
    assert not any("u1" in v.message or "u2" in v.message for v in violations if v.code == "H2")


def test_greedy_fallback_valid() -> None:
    """贪心兜底也必须满足硬约束（规格书 S4.10 快速模式）。"""
    students = make_students(10)
    groups = _greedy_groups(
        students,
        num_groups=2,
        min_size=5,
        max_size=5,
        forbidden_pairs=[("u1", "u2")],
        allow_cross_class=True,
    )
    assert groups is not None
    group_of = {m: gi for gi, g in enumerate(groups) for m in g}
    assert group_of["u1"] != group_of["u2"]
    assert len(group_of) == 10


def test_greedy_used_when_too_large(monkeypatch: pytest.MonkeyPatch) -> None:
    """超过 CP-SAT 规模上限时走贪心，状态仍 ok 并标注快速模式。"""
    monkeypatch.setattr("app.algorithms.grouping.MAX_STUDENTS_FOR_CPSAT", 0)
    students = make_students(6)
    result = solve_grouping(students, num_groups=2, min_size=3, max_size=3)
    assert result.status == "ok"
    assert "快速模式" in result.detail


def test_demo_scale_performance() -> None:
    """30 人 8 组（演示规模）应在秒级完成。"""
    students = make_students(30)
    start = time.monotonic()
    result = solve_grouping(students, num_groups=8, min_size=3, max_size=5)
    elapsed = time.monotonic() - start
    assert result.status == "ok"
    assert elapsed < 15, f"求解耗时 {elapsed:.1f}s 超过预期"
    # 硬约束复查：规模与全覆盖（用 set 比较，避免字典序陷阱）
    for plan in result.plans:
        assigned = [m for g in plan.groups for m in g]
        assert len(assigned) == len(students)
        assert set(assigned) == {s.id for s in students}
        assert all(3 <= len(g) <= 5 for g in plan.groups)
