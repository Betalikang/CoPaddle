"""score 拖动预演与冲突归因测试（规格书 S9.1 / S9.4）。"""

from __future__ import annotations

from app.ai.conflict import analyze_conflict, text_similarity
from app.algorithms.grouping import Student, score_plan
from app.routers.grouping import _apply_move
from app.schemas import ConflictRequest, GroupingWeights, PreviewMoveRequest


def make_students(n: int = 4) -> list[Student]:
    dims = ("编程", "写作", "数据分析")
    return [
        Student(id=f"u{i + 1}", skills={d: (i + j) % 6 for j, d in enumerate(dims)}, class_id="c1")
        for i in range(n)
    ]


def test_apply_move_simple() -> None:
    groups = [["u1", "u2"], ["u3", "u4"]]
    req = PreviewMoveRequest(
        plan_groups=groups,
        user_id="u1",
        from_group=0,
        to_group=1,
        students=[],
        num_groups=2,
        min_group_size=1,
        max_group_size=4,
    )
    after = _apply_move(groups, req)
    assert after == [["u2"], ["u3", "u4", "u1"]]


def test_apply_move_swap() -> None:
    groups = [["u1", "u2"], ["u3", "u4"]]
    req = PreviewMoveRequest(
        plan_groups=groups,
        user_id="u1",
        from_group=0,
        to_group=1,
        swap_with="u3",
        students=[],
        num_groups=2,
        min_group_size=1,
        max_group_size=4,
    )
    after = _apply_move(groups, req)
    assert after == [["u3", "u2"], ["u1", "u4"]]


def test_score_endpoint_returns_real_deltas(client, auth_headers) -> None:
    """score 必须应用移动并给出真实 deltas（P-09 实时得分的根）。"""
    students = make_students(4)
    payload = {
        "plan_groups": [["u1", "u2"], ["u3", "u4"]],
        "user_id": "u1",
        "from_group": 0,
        "to_group": 1,
        "students": [{"id": s.id, "skills": s.skills, "class_id": s.class_id} for s in students],
        "num_groups": 2,
        "min_group_size": 1,
        "max_group_size": 4,
        "forbidden_pairs": [],
        "edges": [],
        "history_pairs": [],
        "weights": {"skill_cover": 1.0, "weak_tie": 1.0, "balance": 1.0, "history_avoid": 1.0},
    }
    r = client.post("/internal/grouping/score", json=payload, headers=auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total_after"] != body["total_before"] or body["deltas"] != {}
    assert "total" in body["deltas"]
    assert body["scores"]["total"] == body["total_after"]
    # 移动后 u1 应在第 2 组：用独立 score 验证
    after_payload = dict(payload)
    after_payload["user_id"] = "nobody"
    after_payload["plan_groups"] = [["u2"], ["u3", "u4", "u1"]]
    r2 = client.post("/internal/grouping/score", json=after_payload, headers=auth_headers)
    assert r2.status_code == 200
    assert abs(r2.json()["total_after"] - body["total_after"]) < 0.01


def test_three_strategies_use_preset_weights() -> None:
    """三方案必须用各自策略预设权重，不能被入参 weights 架空。"""
    from app.algorithms.grouping import STRATEGY_PRESETS, solve_grouping

    students = make_students(6)
    custom = GroupingWeights(skill_cover=0.1, weak_tie=0.1, balance=1.9, history_avoid=0.1)
    result = solve_grouping(
        students,
        num_groups=2,
        min_size=3,
        max_size=3,
        weights=custom,  # 即便传入统一权重，三方案仍应用预设
        time_limit=2.0,
    )
    assert result.status == "ok"
    assert [p.strategy for p in result.plans] == ["skill_first", "weaktie_first", "fairness_first"]
    for plan in result.plans:
        expected = score_plan(
            plan.groups, students, STRATEGY_PRESETS[plan.strategy][1], [], []
        )
        assert abs(plan.scores.total - expected.total) < 0.5


def test_conflict_duplicate_skips_llm() -> None:
    """相似度 >= 0.85 走规则分支，判定内容重复，不调用大模型。"""
    a = "城市客流量高峰出现在早七点到九点，重点车站是人民广场与火车站。"
    b = "城市客流量高峰出现在早七点到九点，重点车站是人民广场与火车站！"
    req = ConflictRequest(text_a=a, text_b=b, author_a="甲", author_b="乙")
    result = analyze_conflict(req)
    assert result.kind == "内容重复"
    assert result.model == "rule:rapidfuzz"


def test_conflict_unrelated_skips_llm() -> None:
    a = "今天食堂的红烧肉很好吃"
    b = "数据库第三范式要求消除传递依赖"
    req = ConflictRequest(text_a=a, text_b=b)
    result = analyze_conflict(req)
    assert result.kind == "无冲突"
    assert result.model == "rule:rapidfuzz"


def test_text_similarity_bounds() -> None:
    assert text_similarity("完全一样", "完全一样") >= 0.99
    assert text_similarity("abc", "xyz") < 0.5
    assert text_similarity("", "x") == 0.0


def test_conflict_endpoint_live(client, auth_headers) -> None:
    r = client.post(
        "/internal/ai/conflict",
        json={"text_a": "红烧肉很好吃", "text_b": "红烧肉很好吃啊"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] in {"口径不一致", "接口不匹配", "结论实质矛盾", "内容重复", "无冲突"}
