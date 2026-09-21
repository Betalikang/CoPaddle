"""调度算法测试（规格书 S4.4–S4.6 / S9.4 断言）。"""

from app.algorithms.scheduling import Task, critical_path, health, impact


def make_dag() -> list[Task]:
    """T1(4h) → T2(6h) → T4(5h)；T1 → T3(2h)。关键路径应为 T1→T2→T4（15h）。"""
    return [
        Task(id="T1", title="数据收集", deps=[], est_hours=4, status="done"),
        Task(id="T2", title="建模分析", deps=["T1"], est_hours=6, status="doing", assignee_id="u1"),
        Task(id="T3", title="资料整理", deps=["T1"], est_hours=2, status="todo", assignee_id="u2"),
        Task(id="T4", title="报告撰写", deps=["T2"], est_hours=5, status="todo", assignee_id="u1"),
    ]


def test_critical_path_longest_chain() -> None:
    r = critical_path(make_dag())
    assert r["path"] == ["T1", "T2", "T4"]
    assert r["total_hours"] == 15


def test_critical_path_detects_cycle() -> None:
    tasks = [
        Task(id="T1", deps=["T2"], est_hours=1),
        Task(id="T2", deps=["T1"], est_hours=1),
    ]
    r = critical_path(tasks)
    assert r.get("error", "").find("环") >= 0
    assert r["path"] == []


def test_impact_downstream_closure() -> None:
    r = impact(make_dag(), "T1", 2)
    assert set(r["affected"]) == {"T2", "T3", "T4"}
    assert r["est_delay_days"] >= 2


def test_impact_excludes_done() -> None:
    r = impact(make_dag(), "T2", 1)
    assert "T1" not in r["affected"]
    assert r["affected"] == ["T4"]


def test_impact_unknown_task() -> None:
    r = impact(make_dag(), "T9", 1)
    assert r.get("error")


def test_health_all_good() -> None:
    r = health(
        make_dag(),
        ["u1", "u2"],
        {"u1": "2026-09-21T10:00:00", "u2": "2026-09-21T10:00:00"},
        now_iso="2026-09-21T12:00:00",
    )
    assert r["overall"] == 100
    assert r["diagnosis"] == []


def test_health_blocked_task() -> None:
    tasks = make_dag()
    tasks[3].status = "blocked"  # T4 阻塞
    r = health(tasks, ["u1"], {"u1": "2026-09-21T10:00:00"}, now_iso="2026-09-21T12:00:00")
    assert r["blocked_score"] < 100
    assert "T4" in r["blocked_tasks"]
    assert any("阻塞" in d for d in r["diagnosis"])


def test_health_idle_member() -> None:
    r = health(make_dag(), ["u1", "u2"], {"u1": "2026-09-24T10:00:00"}, now_iso="2026-09-25T10:00:00")
    # u2 无信号 → 失联
    assert "u2" in r["idle_members"]
    assert r["idle_score"] == 50
    assert any("无进度信号" in d for d in r["diagnosis"])


def test_health_overload_member() -> None:
    tasks = [
        Task(
            id="T1",
            title="重活",
            est_hours=40,
            status="doing",
            assignee_id="u1",
            due_at="2026-09-22T00:00:00",
            remaining_hours=40,
        ),
    ]
    # 距截止 1 天 × 6h = 6h 上限，剩余 40h → 过载
    r = health(tasks, ["u1"], {"u1": "2026-09-21T10:00:00"}, now_iso="2026-09-21T12:00:00")
    assert "u1" in r["overload_members"]
    assert r["overload_score"] == 0
    assert any("超过可投入工时" in d for d in r["diagnosis"])


def test_health_overall_weights() -> None:
    """综合分 = 0.4×阻塞 + 0.3×失联 + 0.3×过载。"""
    tasks = [Task(id="T1", est_hours=1, status="blocked", assignee_id="u1")]
    # blocked_score=0（1/1 阻塞），idle=100（有信号），overload=100（工时小）
    r = health(tasks, ["u1"], {"u1": "2026-09-21T10:00:00"}, now_iso="2026-09-21T12:00:00")
    assert r["blocked_score"] == 0
    assert r["overall"] == 60  # 0.4×0 + 0.3×100 + 0.3×100
