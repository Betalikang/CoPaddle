"""脚手架冒烟测试：验证服务骨架、密钥隔离与关键依赖在本机可用。

业务端点此处只断言 501（占位）；各期实现后按规格书 S9 验收断言替换。
"""
import pytest
from fastapi.testclient import TestClient

INTERNAL_ENDPOINTS: list[tuple[str, dict]] = [
    (
        "/internal/grouping/solve",
        {
            "course_id": "c1",
            "students": [
                {"id": "u1", "skills": {"编程": 4}},
                {"id": "u2", "skills": {"写作": 3}},
                {"id": "u3", "skills": {"编程": 2, "设计": 3}},
                {"id": "u4", "skills": {"数据分析": 4}},
            ],
            "num_groups": 2,
            "min_group_size": 2,
            "max_group_size": 2,
        },
    ),
    (
        "/internal/grouping/score",
        {
            "plan_groups": [["u1", "u2"], ["u3", "u4"]],
            "user_id": "u1",
            "from_group": 0,
            "to_group": 1,
            "num_groups": 2,
            "min_group_size": 1,
            "max_group_size": 3,
        },
    ),
    (
        "/internal/grouping/validate",
        {
            "plan_groups": [["u1", "u2"], ["u3", "u4"]],
            "user_id": "u1",
            "from_group": 0,
            "to_group": 1,
            "num_groups": 2,
            "min_group_size": 1,
            "max_group_size": 3,
        },
    ),
    ("/internal/graph/critical-path", {"tasks": [{"id": "t1", "est_hours": 2}, {"id": "t2", "deps": ["t1"], "est_hours": 3}]}),
    ("/internal/graph/impact", {"tasks": [{"id": "t1", "est_hours": 2}, {"id": "t2", "deps": ["t1"], "est_hours": 3}], "delayed_task_id": "t1"}),
    ("/internal/health/compute", {"group_id": "g1", "member_ids": ["u1", "u2"]}),
    ("/internal/attribution/compute", {"group_id": "g1", "member_ids": ["u1", "u2"]}),
    ("/internal/ai/decompose", {"assignment_text": "完成一份城市客流量分析报告，含数据采集、建模与可视化。"}),
    ("/internal/ai/conflict", {"text_a": "高峰在早 7-9 点", "text_b": "重点在晚高峰"}),
]


def test_healthz_no_auth(client: TestClient) -> None:
    r = client.get("/internal/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_docs_reachable(client: TestClient) -> None:
    assert client.get("/docs").status_code == 200
    openapi = client.get("/openapi.json")
    assert openapi.status_code == 200
    paths = openapi.json()["paths"]
    # 9 个业务接口 + healthz 全部注册
    for path, _ in INTERNAL_ENDPOINTS:
        assert path in paths, f"缺少接口 {path}"
    assert "/internal/healthz" in paths


def test_internal_rejects_missing_or_wrong_secret(client: TestClient) -> None:
    for path, payload in INTERNAL_ENDPOINTS:
        assert client.post(path, json=payload).status_code == 401, f"{path} 未拒绝无密钥请求"
        wrong = client.post(path, json=payload, headers={"X-Internal-Secret": "wrong"})
        assert wrong.status_code == 401, f"{path} 未拒绝错误密钥"


def test_internal_stubs_return_501(client: TestClient, auth_headers: dict[str, str]) -> None:
    for path, payload in INTERNAL_ENDPOINTS:
        r = client.post(path, json=payload, headers=auth_headers)
        assert r.status_code == 501, f"{path} 应返回 501 占位，实际 {r.status_code}"


def test_payload_validation_active(client: TestClient, auth_headers: dict[str, str]) -> None:
    # 空载荷必须被 pydantic 拦截为 422，证明 schema 契约生效
    r = client.post("/internal/grouping/solve", json={}, headers=auth_headers)
    assert r.status_code == 422


def test_secret_unset_fails_closed(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    # 未配置密钥时，内部接口一律 503（fail-closed），healthz 不受影响
    monkeypatch.setenv("ALGO_SHARED_SECRET", "")
    from app.config import get_settings

    get_settings.cache_clear()
    r = client.post("/internal/grouping/solve", json={}, headers={"X-Internal-Secret": "anything"})
    assert r.status_code == 503
    get_settings.cache_clear()


# ---- 关键依赖在本机（Windows / Python 3.12）真实可用 ----


def test_ortools_cpsat_sanity() -> None:
    from ortools.sat.python import cp_model

    m = cp_model.CpModel()
    x = m.NewBoolVar("x")
    y = m.NewBoolVar("y")
    m.Add(x + y == 1)
    m.Maximize(x)
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 5
    status = solver.Solve(m)
    assert status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    assert solver.Value(x) == 1


def test_networkx_sanity() -> None:
    import networkx as nx

    g = nx.DiGraph()
    g.add_edges_from([("t1", "t2"), ("t2", "t3")])
    assert list(nx.topological_sort(g)) == ["t1", "t2", "t3"]
    assert nx.is_directed_acyclic_graph(g)


def test_rapidfuzz_jieba_sanity() -> None:
    import jieba
    from rapidfuzz import fuzz

    tokens = jieba.lcut("城市客流量分析")
    assert "客流量" in tokens or len(tokens) >= 2
    assert fuzz.ratio("高峰在早7-9点", "高峰在早七点到九点") > 50
