"""LLM 调用点 2：语义冲突归因（规格书 S6.2）。

前置筛选（rapidfuzz + jieba）把大部分无关文本挡在模型之外：
- 相似度 >= 0.85 → 判定「内容重复」，不调用大模型；
- 相似度 < 0.30  → 判定「无冲突」，不调用大模型；
- [0.30, 0.85)   → 调用大模型做语义归因。

失败处理：重试 1 次后降级为「人工判断」，reason 标明模型不可用，
界面仍可展示双方原文对比与契约条款（规格书 S6.2）。
"""

from __future__ import annotations

import json
import re
from typing import Any

import jieba
from rapidfuzz import fuzz

from ..schemas import (
    ConflictRequest,
    ConflictResponse,
    ContractGlossaryItem,
)
from .llm import LlmUnavailableError, chat_json

# 前置筛选阈值（规格书 S6.2）
SIM_DUPLICATE = 0.85
SIM_UNRELATED = 0.30

SYSTEM_PROMPT = (
    "你是高校小组协作的冲突分析助手。比较两段产出，判断是否存在协作冲突。"
    "你必须且只能输出一个 JSON 对象，不要输出任何解释文字或 Markdown 代码块。"
    "kind 只能是：口径不一致、接口不匹配、结论实质矛盾、内容重复、无冲突。"
    "severity 只能是：low、medium、high。"
    "reason 必须引用双方原文片段作为依据，不允许空泛评价。"
    "若给出 merged_text，请给出可合并的建议文本。"
)


def strip_code_fence(text: str) -> str:
    t = text.strip()
    m = re.match(r"^```(?:json)?\s*(.*?)\s*```$", t, re.DOTALL)
    return m.group(1) if m else t


def text_similarity(a: str, b: str) -> float:
    """中文文本相似度：jieba 分词后 rapidfuzz token_set_ratio，归一到 0–1。"""
    if not a.strip() or not b.strip():
        return 0.0
    ta = " ".join(jieba.lcut(a))
    tb = " ".join(jieba.lcut(b))
    return fuzz.token_set_ratio(ta, tb) / 100.0


def _build_user_prompt(req: ConflictRequest, similarity: float) -> str:
    terms = req.contract_terms or []
    term_lines = [
        f"- {t.term}：{t.definition}" + (f"（单位 {t.unit}）" if t.unit else "")
        for t in terms[:20]
    ]
    return "\n".join(
        [
            "【段落 A · 作者 " + (req.author_a or "未知") + "】",
            req.text_a.strip()[:4000],
            "",
            "【段落 B · 作者 " + (req.author_b or "未知") + "】",
            req.text_b.strip()[:4000],
            "",
            f"【前置相似度】{similarity:.2f}（仅供参考）",
            "【协作契约中的术语与口径约定】",
            *(term_lines or ["（无）"]),
            "",
            '请输出 JSON：{"kind":"...", "severity":"low|medium|high",'
            ' "reason":"必须引用双方原文片段", "suggestion":"...",'
            ' "merged_text":"..."}',
        ]
    )


def _parse(content: str, similarity: float) -> ConflictResponse:
    data: dict[str, Any] = json.loads(strip_code_fence(content))
    kind = str(data.get("kind") or "无冲突")
    allowed = {"口径不一致", "接口不匹配", "结论实质矛盾", "内容重复", "无冲突"}
    if kind not in allowed:
        kind = "无冲突"
    severity = str(data.get("severity") or "low")
    if severity not in {"low", "medium", "high"}:
        severity = "low"
    return ConflictResponse(
        kind=kind,
        severity=severity,
        reason=str(data.get("reason") or ""),
        suggestion=str(data.get("suggestion") or ""),
        merged_text=str(data.get("merged_text") or ""),
        model="",
        prompt_tokens=0,
        completion_tokens=0,
    )


def analyze_conflict(req: ConflictRequest) -> ConflictResponse:
    """冲突归因主流程。LLM 不可用时降级为「人工判断」占位结果。"""
    sim = text_similarity(req.text_a, req.text_b)

    # 前置分支：不调用大模型（规格书 S6.2 成本控制关键）
    if sim >= SIM_DUPLICATE:
        return ConflictResponse(
            kind="内容重复",
            severity="medium",
            reason=f"两段文本相似度 {sim:.2f}（≥{SIM_DUPLICATE}），判定为内容重复，未调用大模型。",
            suggestion="请合并重复表述，保留一处权威版本。",
            merged_text=req.text_a.strip()[:2000],
            model="rule:rapidfuzz",
        )
    if sim < SIM_UNRELATED:
        return ConflictResponse(
            kind="无冲突",
            severity="low",
            reason=f"两段文本相似度 {sim:.2f}（<{SIM_UNRELATED}），主题无关，未调用大模型。",
            suggestion="",
            merged_text="",
            model="rule:rapidfuzz",
        )

    # 语义归因：调用大模型，失败重试 1 次后降级人工判断
    feedback: str | None = None
    for _attempt in range(2):
        prompt = _build_user_prompt(req, sim)
        if feedback:
            prompt += "\n\n【上次输出的问题，必须修正】\n- " + feedback
        try:
            content, usage = chat_json(SYSTEM_PROMPT, prompt)
        except LlmUnavailableError as err:
            return ConflictResponse(
                kind="无冲突",
                severity="low",
                reason=f"AI 暂不可用（{err}），已降级为人工判断。请对照双方原文与契约条款自行裁定。",
                suggestion="可稍后重试分析，或直接人工处理。",
                merged_text="",
                model="",
            )
        try:
            result = _parse(content, sim)
            result.prompt_tokens = usage["prompt_tokens"]
            result.completion_tokens = usage["completion_tokens"]
            # reason 必须引用原文片段：过短则视为无效并重试
            if len(result.reason.strip()) < 8:
                feedback = "reason 过短或未引用双方原文片段，请重新输出"
                continue
            return result
        except (json.JSONDecodeError, ValueError) as err:
            feedback = f"输出不是合法 JSON：{err}"

    return ConflictResponse(
        kind="无冲突",
        severity="low",
        reason="模型输出无法解析，已降级为人工判断。请对照双方原文与契约条款自行裁定。",
        suggestion="可稍后重试分析，或直接人工处理。",
        merged_text="",
        model="",
    )
