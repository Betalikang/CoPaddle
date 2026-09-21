"""分组内部接口测试（TestClient + 共享密钥）。"""

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture()
def client() -> TestClient:
    from app.config import get_settings

    get_settings.cache_clear()
    return TestClient(app)


@pytest.fixture()
def auth() -> dict[str, str]:
    return {"X-Internal-Secret": "test-secret"}


def make_payload(n: int = 30, groups: int = 8, **overrides) -> dict:
    students = [
        {"id": f"u{i + 1}", "skills": {"编程": (i) % 6, "写作": (i + 1) % 6, "数据分析": (i + 2) % 6}} for i in range(n)
    ]
    payload = {
        "course_id": "c1",
        "students": students,
        "num_groups": groups,
        "min_group_size": 3,
        "max_group_size": 5,
        "forbidden_pairs": [],
        "required_pairs": [],
        "weights": {"skill_cover": 1.2, "weak_tie": 0.8, "balance": 1.0, "history_avoid": 1.0},
        "time_limit_seconds": 10.0,
    }
    payload.update(overrides)
    return payload


def test_solve_returns_three_plans(client: TestClient, auth: dict[str, str]) -> None:
    r = client.post("/internal/grouping/solve", json=make_payload(), headers=auth)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "ok"
    assert len(body["plans"]) == 3
    for plan in body["plans"]:
        assert len(plan["groups"]) == 8
        assert plan["scores"]["total"] > 0
        assert plan["label"]


def test_solve_infeasible(client: TestClient, auth: dict[str, str]) -> None:
    r = client.post(
        "/internal/grouping/solve",
        json=make_payload(
            n=4, groups=2, min_group_size=2, max_group_size=2, required_pairs=[["u1", "u2"], ["u1", "u3"]]
        ),
        headers=auth,
    )
    assert r.status_code == 200
    assert r.json()["status"] == "infeasible"


def test_validate_reports_violations(client: TestClient, auth: dict[str, str]) -> None:
    r = client.post(
        "/internal/grouping/validate",
        json={
            "plan_groups": [["u1", "u2", "u3"], ["u4"]],
            "user_id": "u1",
            "from_group": 0,
            "to_group": 1,
            "num_groups": 2,
            "min_group_size": 2,
            "max_group_size": 2,
        },
        headers=auth,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False
    assert any(v["code"] == "H1" for v in body["violations"])


def test_validate_accepts_legal_plan(client: TestClient, auth: dict[str, str]) -> None:
    r = client.post(
        "/internal/grouping/validate",
        json={
            "plan_groups": [["u1", "u2"], ["u3", "u4"]],
            "user_id": "u1",
            "from_group": 0,
            "to_group": 1,
            "num_groups": 2,
            "min_group_size": 2,
            "max_group_size": 2,
            "students": [
                {"id": "u1", "skills": {"编程": 4}},
                {"id": "u2", "skills": {"写作": 3}},
                {"id": "u3", "skills": {"编程": 2}},
                {"id": "u4", "skills": {"数据分析": 4}},
            ],
        },
        headers=auth,
    )
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert r.json()["violations"] == []


def test_score_given_plan(client: TestClient, auth: dict[str, str]) -> None:
    r = client.post(
        "/internal/grouping/score",
        json={
            "plan_groups": [["u1", "u2"], ["u3", "u4"]],
            "user_id": "u1",
            "from_group": 0,
            "to_group": 1,
            "num_groups": 2,
            "min_group_size": 1,
            "max_group_size": 3,
            "students": [
                {"id": "u1", "skills": {"编程": 4}},
                {"id": "u2", "skills": {"写作": 3}},
                {"id": "u3", "skills": {"编程": 2}},
                {"id": "u4", "skills": {"数据分析": 4}},
            ],
        },
        headers=auth,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert 0 <= body["total_after"] <= 100


def test_requires_secret(client: TestClient) -> None:
    r = client.post("/internal/grouping/solve", json=make_payload())
    assert r.status_code == 401
