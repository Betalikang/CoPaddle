"""调度算法（共桨 M4/M5 / 规格书 S4.4–S4.6）。

覆盖：
- critical_path：任务 DAG 上 est_hours 之和最大的链（拓扑排序 + 最长路径）；
- impact：指定任务延期后的下游波及集合与预计顺延天数；
- health：三维健康度（阻塞 / 失联 / 过载）+ 综合分 + 诊断条目；
- replan：滚动重规划三方案（重新分配 / 缩减范围 / 组间补位）+ 代价说明。

全部为确定性计算，不使用大模型（规格书 S6.3）。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC
from typing import Any


@dataclass
class Task:
    id: str
    title: str = ""
    deps: list[str] = field(default_factory=list)
    est_hours: float = 1.0
    status: str = "todo"  # todo|doing|blocked|reviewing|done|cancelled
    due_at: str | None = None
    skills: list[str] = field(default_factory=list)
    assignee_id: str | None = None
    remaining_hours: float | None = None
    deliverable_type: str = "document"
    milestone: str = ""


# ---------------- 关键路径 ----------------


def critical_path(tasks: list[Task]) -> dict[str, Any]:
    """DAG 最长路径（按 est_hours 加权）。返回 {path, total_hours}。"""
    by_id = {t.id: t for t in tasks}
    # 拓扑序（Kahn）
    indeg = {t.id: 0 for t in tasks}
    for t in tasks:
        for d in t.deps:
            if d in by_id:
                indeg[t.id] += 1
    queue = [tid for tid, d in indeg.items() if d == 0]
    topo: list[str] = []
    while queue:
        n = queue.pop(0)
        topo.append(n)
        for t in tasks:
            if n in t.deps and t.id in by_id:
                indeg[t.id] -= 1
                if indeg[t.id] == 0:
                    queue.append(t.id)
    if len(topo) != len(tasks):
        return {"path": [], "total_hours": 0.0, "error": "依赖成环，无法计算关键路径"}

    # dist[t] = 到 t 为止的最长链长度；prev 用于回溯
    dist = {t.id: t.est_hours for t in tasks}
    prev: dict[str, str | None] = {t.id: None for t in tasks}
    for tid in topo:
        for t in tasks:
            if tid in t.deps and t.id in by_id:
                if dist[tid] + t.est_hours > dist[t.id]:
                    dist[t.id] = dist[tid] + t.est_hours
                    prev[t.id] = tid
    if not dist:
        return {"path": [], "total_hours": 0.0}
    end = max(dist, key=lambda k: dist[k])
    path: list[str] = []
    cur: str | None = end
    while cur is not None:
        path.append(cur)
        cur = prev[cur]
    path.reverse()
    return {"path": path, "total_hours": round(dist[end], 1)}


# ---------------- 波及分析 ----------------


def impact(tasks: list[Task], delayed_task_id: str, delay_days: float) -> dict[str, Any]:
    """指定任务延期后的下游波及。返回 {affected, est_delay_days}。

    est_delay_days：延期沿依赖链传播——每个下游任务顺延 delay_days，
    取其最长链上累计的顺延（简化口径：下游任务各自至少顺延 delay_days）。
    """
    by_id = {t.id: t for t in tasks}
    if delayed_task_id not in by_id:
        return {"affected": [], "est_delay_days": 0.0, "error": "任务不存在"}

    # 下游闭包
    downstream: set[str] = set()
    stack = [delayed_task_id]
    while stack:
        cur = stack.pop()
        for t in tasks:
            if cur in t.deps and t.id not in downstream and t.id != delayed_task_id:
                downstream.add(t.id)
                stack.append(t.id)

    # 未完成的下游才算受影响
    affected = [tid for tid in downstream if by_id[tid].status not in ("done", "cancelled")]
    # 顺延口径：延期沿最长下游链累计（每层累加一次 delay_days 过于悲观，
    # 取下游关键路径的层数 × delay_days，封顶 30 天）
    depth = _max_depth(tasks, delayed_task_id, downstream)
    est_delay = round(min(delay_days * max(depth, 1), 30.0), 1)
    return {"affected": sorted(affected), "est_delay_days": est_delay}


def _max_depth(tasks: list[Task], start: str, scope: set[str]) -> int:
    """start 到 scope 内节点的最长链深度。"""
    memo: dict[str, int] = {}

    def depth(tid: str, seen: set[str]) -> int:
        if tid in memo:
            return memo[tid]
        best = 0
        for t in tasks:
            if tid in t.deps and t.id in scope and t.id not in seen:
                best = max(best, 1 + depth(t.id, seen | {t.id}))
        memo[tid] = best
        return best

    return depth(start, set())


# ---------------- 三维健康度（规格书 S4.4） ----------------


def health(
    tasks: list[Task],
    member_ids: list[str],
    last_signal_at: dict[str, str],
    idle_trigger_days: int = 3,
    now_iso: str | None = None,
) -> dict[str, Any]:
    """三维健康度（0–100，越高越好）+ 综合分 + 诊断条目。"""
    from datetime import datetime

    now = datetime.fromisoformat(now_iso) if now_iso else datetime.now(UTC)
    if now.tzinfo is None:
        now = now.replace(tzinfo=UTC)

    open_tasks = [t for t in tasks if t.status not in ("done", "cancelled")]

    # 阻塞：status=blocked，或前驱未完成且 due_at 已过期
    blocked: list[str] = []
    done_ids = {t.id for t in tasks if t.status == "done"}
    for t in open_tasks:
        if t.status == "blocked":
            blocked.append(t.id)
            continue
        if t.due_at:
            due = datetime.fromisoformat(t.due_at)
            if due.tzinfo is None:
                due = due.replace(tzinfo=UTC)
            if now > due and any(d not in done_ids for d in t.deps):
                blocked.append(t.id)
    blocked_score = 100 * (1 - len(blocked) / max(len(open_tasks), 1))

    # 失联：近 idle_trigger_days 天无任何信号的成员
    idle_members: list[str] = []
    for uid in member_ids:
        last = last_signal_at.get(uid)
        if not last:
            idle_members.append(uid)
            continue
        ts = datetime.fromisoformat(last)
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=UTC)
        if (now - ts).days >= idle_trigger_days:
            idle_members.append(uid)
    idle_score = 100 * (1 - len(idle_members) / max(len(member_ids), 1))

    # 过载：剩余工时 > 距截止剩余天数 × 6 小时/天（按任务的 due_at 计算）
    overload_members: list[str] = []
    per_member_hours: dict[str, float] = {}
    per_member_days: dict[str, float] = {}
    for t in open_tasks:
        # 过载判定需要截止时间：无 due_at 的任务不参与（没有 deadline 无从判断）
        if not t.assignee_id or not t.due_at:
            continue
        rem = t.remaining_hours if t.remaining_hours is not None else t.est_hours
        per_member_hours[t.assignee_id] = per_member_hours.get(t.assignee_id, 0.0) + rem
        due = datetime.fromisoformat(t.due_at)
        if due.tzinfo is None:
            due = due.replace(tzinfo=UTC)
        days_left = max((due - now).days, 0)
        per_member_days[t.assignee_id] = max(per_member_days.get(t.assignee_id, 0.0), days_left)
    for uid, hours in per_member_hours.items():
        days = per_member_days.get(uid, 0)
        if hours > days * 6:
            overload_members.append(uid)
    overload_score = 100 * (1 - len(overload_members) / max(len(member_ids), 1))

    overall = round(0.4 * blocked_score + 0.3 * idle_score + 0.3 * overload_score, 1)

    diagnosis: list[str] = []
    if blocked:
        diagnosis.append(f"{len(blocked)} 个任务阻塞（被依赖卡住或已过期）")
    if idle_members:
        diagnosis.append(f"{len(idle_members)} 名成员超过 {idle_trigger_days} 天无进度信号")
    if overload_members:
        diagnosis.append(f"{len(overload_members)} 名成员剩余工时超过可投入工时")

    return {
        "blocked_score": round(blocked_score, 1),
        "idle_score": round(idle_score, 1),
        "overload_score": round(overload_score, 1),
        "overall": overall,
        "blocked_tasks": blocked,
        "idle_members": idle_members,
        "overload_members": overload_members,
        "diagnosis": diagnosis,
    }
