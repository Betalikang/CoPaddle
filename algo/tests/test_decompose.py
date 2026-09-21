"""LLM 拆解测试：mock 客户端（不打真 API）+ 可选真 API 冒烟。

mock 覆盖：正常拆解、Markdown 围栏兜底、悬空依赖/成环/重复 id 的后置校验与
带反馈重试、两次失败抛 LlmUnavailableError。

真 API 冒烟（test_decompose_live.py）需要 LLM_API_KEY，默认收集但跳过，
本地验证：`pytest tests/test_decompose_live.py -q`（.env 已配 key 时自动运行）。
"""

from types import SimpleNamespace

import pytest

from app.ai.decompose import decompose, strip_code_fence, validate_decomposed
from app.ai.llm import LlmUnavailableError
from app.config import get_settings
from app.schemas import DecomposedTask, DecomposeRequest

VALID_JSON = """{
  "tasks": [
    {"id": "T1", "title": "数据收集", "deps": [], "est_hours": 4, "skills": ["调研"], "deliverable": "数据集", "milestone": "M1"},
    {"id": "T2", "title": "建模分析", "deps": ["T1"], "est_hours": 6, "skills": ["数据分析"], "deliverable": "模型脚本", "milestone": "M2"},
    {"id": "T3", "title": "报告撰写", "deps": ["T2"], "est_hours": 5, "skills": ["写作"], "deliverable": "报告文档", "milestone": "M3"}
  ],
  "contract": {
    "glossary": [
      {"term": "客流量", "definition": "单位时间进入区域的人次", "unit": "人次/小时"},
      {"term": "高峰时段", "definition": "客流密度超过均值 20% 的连续时段", "unit": "小时"}
    ],
    "interfaces": ["数据集字段：date,time,count"],
    "format": "Markdown"
  }
}"""

FENCED_JSON = f"```json\n{VALID_JSON}\n```"


class FakeUsage:
    prompt_tokens = 100
    completion_tokens = 200


def make_fake(responses: list):
    """responses: str 或 Exception 的序列，按调用次序返回（最后一个重复）。"""
    state = {"i": 0}

    def create(**_kwargs):
        i = state["i"]
        state["i"] += 1
        r = responses[min(i, len(responses) - 1)]
        if isinstance(r, Exception):
            raise r
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=r))],
            usage=FakeUsage,
        )

    fake = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    return fake


def patch_client(monkeypatch: pytest.MonkeyPatch, responses: list) -> None:
    # 注意：fake 只建一次——闭包 state 跨调用保持，否则每次 get_client() 都重置
    fake = make_fake(responses)
    monkeypatch.setattr("app.ai.llm.get_client", lambda: fake)


def make_request() -> DecomposeRequest:
    return DecomposeRequest(
        assignment_text="完成一份城市商圈客流量分析报告：收集数据、建模、撰写报告。",
        group_size=4,
        remaining_days=14,
    )


def test_strip_code_fence() -> None:
    assert strip_code_fence(FENCED_JSON).startswith("{")
    assert strip_code_fence('{"a": 1}') == '{"a": 1}'


def test_decompose_success(monkeypatch: pytest.MonkeyPatch) -> None:
    patch_client(monkeypatch, [VALID_JSON])
    resp = decompose(make_request())
    assert len(resp.tasks) == 3
    assert resp.validation_problems == []
    assert resp.contract is not None
    assert len(resp.contract.glossary) == 2
    assert resp.contract.glossary[0].unit == "人次/小时"
    assert resp.prompt_tokens == 100


def test_decompose_accepts_fenced_json(monkeypatch: pytest.MonkeyPatch) -> None:
    patch_client(monkeypatch, [FENCED_JSON])
    resp = decompose(make_request())
    assert len(resp.tasks) == 3
    assert resp.validation_problems == []


def test_validation_dangling_dep() -> None:
    tasks = [
        DecomposedTask(id="T1", title="a", deps=[], est_hours=1),
        DecomposedTask(id="T2", title="b", deps=["T9"], est_hours=1),
    ]
    problems = validate_decomposed(tasks)
    assert any("悬空依赖" in p for p in problems)


def test_validation_cycle() -> None:
    tasks = [
        DecomposedTask(id="T1", title="a", deps=["T2"], est_hours=1),
        DecomposedTask(id="T2", title="b", deps=["T1"], est_hours=1),
    ]
    problems = validate_decomposed(tasks)
    assert any("成环" in p for p in problems)


def test_validation_duplicate_id() -> None:
    tasks = [
        DecomposedTask(id="T1", title="a", deps=[], est_hours=1),
        DecomposedTask(id="T1", title="b", deps=[], est_hours=1),
    ]
    problems = validate_decomposed(tasks)
    assert any("重复 id" in p for p in problems)


def test_dangling_dep_retries_with_feedback(monkeypatch: pytest.MonkeyPatch) -> None:
    """首次输出悬空依赖 → 带反馈重试 → 第二次合法。"""
    bad = VALID_JSON.replace('"deps": ["T1"]', '"deps": ["T9"]')
    bad = bad.replace('"deps": ["T2"]', '"deps": ["T2"]')
    patch_client(monkeypatch, [bad, VALID_JSON])
    resp = decompose(make_request())
    assert resp.validation_problems == []
    assert len(resp.tasks) == 3


def test_problems_kept_after_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    """两次都有问题：带着 problems 返回（不静默丢弃，界面高亮人工修正）。"""
    bad = VALID_JSON.replace('"deps": ["T1"]', '"deps": ["T9"]')
    patch_client(monkeypatch, [bad, bad])
    resp = decompose(make_request())
    assert resp.validation_problems
    assert any("悬空依赖" in p for p in resp.validation_problems)
    assert len(resp.tasks) == 3  # 数据仍在，供人工修正


def test_unavailable_after_retries(monkeypatch: pytest.MonkeyPatch) -> None:
    """连续失败：抛 LlmUnavailableError（路由降级为手工创建）。"""
    patch_client(monkeypatch, [RuntimeError("boom"), RuntimeError("boom")])
    with pytest.raises(LlmUnavailableError):
        decompose(make_request())


def test_invalid_json_retries(monkeypatch: pytest.MonkeyPatch) -> None:
    patch_client(monkeypatch, ["这不是 JSON", VALID_JSON])
    resp = decompose(make_request())
    assert resp.validation_problems == []


def test_llm_not_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    """未配置 key：抛 LlmNotConfiguredError（503 语义）。"""
    from app.ai import llm
    from app.ai.llm import LlmNotConfiguredError, get_client

    class FakeSettings:
        llm_api_key = ""
        llm_base_url = ""
        llm_model = "m"
        llm_timeout = 5
        llm_temperature = 0.2

    # patch llm 模块内的 get_settings 引用（它 from ..config import get_settings）
    monkeypatch.setattr(llm, "get_settings", lambda: FakeSettings())
    get_client.cache_clear()
    try:
        with pytest.raises(LlmNotConfiguredError):
            get_client()
    finally:
        monkeypatch.undo()
        get_settings.cache_clear()
        get_client.cache_clear()
