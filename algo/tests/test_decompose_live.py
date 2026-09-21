"""LLM 拆解真 API 冒烟（需要 LLM_API_KEY，走 DeepSeek 真实调用）。

本地验证：pytest tests/test_decompose_live.py -q
（algo/.env 已配置 key 时自动运行；无 key 时 skip）
"""

import os

import pytest

from app.ai.decompose import decompose
from app.config import get_settings
from app.schemas import DecomposeRequest

pytestmark = pytest.mark.skipif(
    not os.environ.get("LLM_API_KEY") and not get_settings().llm_api_key,
    reason="未配置 LLM_API_KEY",
)

ASSIGNMENT = """小组作业：城市商圈客流量分析与选址建议。
要求：
1. 收集某商圈连续两周的客流量数据（可自定采集方式）；
2. 分析客流的时间分布规律（工作日/周末、高峰时段）；
3. 结合周边业态，给出一个新店选址建议；
4. 提交一份图文报告（含至少 3 张图表）与可复现的分析代码。
注意：报告中「客流量」必须统一口径并注明单位。"""


def test_live_decompose_produces_dag_and_contract() -> None:
    get_settings.cache_clear()
    req = DecomposeRequest(
        assignment_text=ASSIGNMENT,
        group_size=4,
        course_name="数据分析基础",
        remaining_days=14,
    )
    resp = decompose(req)

    assert resp.tasks, "应拆出任务"
    assert 1 <= len(resp.tasks) <= 12, f"任务数 {len(resp.tasks)} 超出规格"
    assert resp.validation_problems == [], f"后置校验问题：{resp.validation_problems}"
    assert resp.contract is not None
    assert len(resp.contract.glossary) >= 2, "契约术语表至少 2 条"
    assert all(g.unit or g.definition for g in resp.contract.glossary)
    # 依赖必须成 DAG 且引用存在
    ids = {t.id for t in resp.tasks}
    assert all(d in ids for t in resp.tasks for d in t.deps)
    # token 用量有记录（S6 期接入 ai_call_logs）
    assert resp.prompt_tokens > 0 and resp.completion_tokens > 0
