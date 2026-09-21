"""LLM 调用点 1：作业要求 → 任务 DAG + 协作契约（规格书 S6.1）。

流程：构造提示词 → JSON 模式调用 → pydantic 二次校验 → 规则后置校验
（重复 id / 悬空依赖 / 成环）→ 有问题则带问题反馈重试 1 次 → 仍失败就带着
problems 返回（界面高亮要求人工修正，不静默丢弃，规格书 S6.1）。
"""

from __future__ import annotations

import json
import re
from typing import Any

from ..schemas import (
    ContractGlossaryItem,
    DecomposeContract,
    DecomposedTask,
    DecomposeRequest,
    DecomposeResponse,
)
from .llm import LlmUnavailableError, chat_json

SYSTEM_PROMPT = (
    "你是高校小组作业的拆解助手。把作业要求拆成可执行的任务 DAG，并同时产出一份协作契约。"
    "你必须且只能输出一个 JSON 对象，不要输出任何解释文字或 Markdown 代码块。"
    "任务粒度以 2-8 小时可完成为宜，总数不超过 12 个。"
    "每个任务必须显式声明依赖（deps 为所依赖任务 id 的数组），不允许出现孤立任务。"
    "id 使用 T1、T2 这样的连续编号，deps 中引用的 id 必须真实存在。"
    "协作契约的术语表至少 2 条，每条必须写明单位与统计口径——这是抑制成果冲突的根治手段。"
)


def _build_user_prompt(req: DecomposeRequest, feedback: list[str] | None = None) -> str:
    parts = [
        "【作业要求原文】",
        req.assignment_text.strip(),
        "",
        f"【小组人数】{req.group_size}",
    ]
    if req.remaining_days is not None:
        parts.append(f"【剩余天数】{req.remaining_days}")
    parts.append(
        '请输出 JSON：{"tasks":[{"id":"T1","title":"...","deps":[],'
        '"est_hours":4,"skills":["编程"],"deliverable":"...",'
        '"milestone":"..."}],"contract":{"glossary":[{"term":"...",'
        '"definition":"...","unit":"..."}],"interfaces":["..."],'
        '"format":"..."}}'
    )
    if feedback:
        parts.append("")
        parts.append("【上次输出的问题，必须修正】")
        parts.extend(f"- {f}" for f in feedback)
    return "\n".join(parts)


def strip_code_fence(text: str) -> str:
    """兜底：模型偶尔仍会包裹 Markdown 代码块。"""
    t = text.strip()
    m = re.match(r"^```(?:json)?\s*(.*?)\s*```$", t, re.DOTALL)
    return m.group(1) if m else t


def validate_decomposed(tasks: list[DecomposedTask]) -> list[str]:
    """规则后置校验（规格书 S6.1）：重复 id、悬空依赖、成环。"""
    problems: list[str] = []
    ids = [t.id for t in tasks]
    if len(ids) != len(set(ids)):
        dup = sorted({i for i in ids if ids.count(i) > 1})
        problems.append(f"重复 id：{'、'.join(dup)}")
    id_set = set(ids)
    for t in tasks:
        for d in t.deps:
            if d not in id_set:
                problems.append(f"任务 {t.id} 的依赖 {d} 不存在（悬空依赖）")
    if not _is_acyclic(tasks):
        cycle = _find_cycle(tasks)
        problems.append(f"依赖成环：{' → '.join(cycle) if cycle else '检测到环'}")
    return problems


def _is_acyclic(tasks: list[DecomposedTask]) -> bool:
    graph = {t.id: list(t.deps) for t in tasks}
    state: dict[str, int] = {}

    def visit(n: str) -> bool:
        if state.get(n) == 2:
            return True
        if state.get(n) == 1:
            return False
        state[n] = 1
        for d in graph.get(n, []):
            if d in graph and not visit(d):
                return False
        state[n] = 2
        return True

    return all(visit(n) for n in graph)


def _find_cycle(tasks: list[DecomposedTask]) -> list[str]:
    graph = {t.id: list(t.deps) for t in tasks}
    stack: list[str] = []
    in_stack: set[str] = set()
    visited: set[str] = set()

    def visit(n: str) -> list[str] | None:
        if n in in_stack:
            idx = stack.index(n)
            return stack[idx:] + [n]
        if n in visited:
            return None
        visited.add(n)
        in_stack.add(n)
        stack.append(n)
        for d in graph.get(n, []):
            if d in graph:
                found = visit(d)
                if found:
                    return found
        stack.pop()
        in_stack.discard(n)
        return None

    for n in graph:
        found = visit(n)
        if found:
            return found
    return []


def decompose(req: DecomposeRequest) -> DecomposeResponse:
    """执行拆解。LLM 不可用抛 LlmUnavailableError（路由降级为手工创建）。"""
    feedback: list[str] | None = None
    last_parse_error = ""

    for _attempt in range(2):  # 首次 + 带反馈重试 1 次
        content, usage = chat_json(SYSTEM_PROMPT, _build_user_prompt(req, feedback))
        try:
            data: dict[str, Any] = json.loads(strip_code_fence(content))
        except json.JSONDecodeError as err:
            last_parse_error = f"输出不是合法 JSON：{err}"
            feedback = [last_parse_error]
            continue

        raw_tasks = data.get("tasks") or []
        raw_contract = data.get("contract") or {}
        try:
            tasks = [DecomposedTask.model_validate(t) for t in raw_tasks]
            contract_items = [ContractGlossaryItem.model_validate(g) for g in raw_contract.get("glossary") or []]
        except Exception as err:
            last_parse_error = f"任务结构不符合约定：{err}"
            feedback = [last_parse_error]
            continue

        problems = validate_decomposed(tasks)
        contract = _contract(raw_contract, contract_items)
        if problems:
            # 有问题：带问题反馈重试一次；仍失败则带问题返回（不静默丢弃）
            if feedback is None:
                feedback = problems
                continue
            return DecomposeResponse(
                tasks=tasks,
                contract=contract,
                validation_problems=problems,
                model="",
                prompt_tokens=usage["prompt_tokens"],
                completion_tokens=usage["completion_tokens"],
            )

        return DecomposeResponse(
            tasks=tasks,
            contract=contract,
            validation_problems=[],
            model="",
            prompt_tokens=usage["prompt_tokens"],
            completion_tokens=usage["completion_tokens"],
        )

    raise LlmUnavailableError(f"拆解失败：{last_parse_error or '未知错误'}")


def _contract(raw: dict[str, Any], items: list[ContractGlossaryItem]) -> DecomposeContract:
    return DecomposeContract(
        glossary=items,
        interfaces=[str(i) for i in raw.get("interfaces") or []],
        format=str(raw.get("format") or ""),
    )
