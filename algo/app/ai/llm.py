"""LLM 客户端（DeepSeek，OpenAI 兼容协议）。

约定（技术选型 T6）：
- openai SDK + response_format=json_object；temperature=0.2 保证结构稳定；
- 换服务商只改 base_url 与模型名（环境变量隔离）；
- 调用失败不重试风暴：重试 1 次，仍失败抛 LlmUnavailableError，由路由降级为
  「AI 暂不可用，可手工创建」（规格书 S4.10）。
"""

from __future__ import annotations

from functools import lru_cache

from openai import OpenAI

from ..config import get_settings


class LlmNotConfiguredError(Exception):
    """LLM_API_KEY 未配置。"""


class LlmUnavailableError(Exception):
    """调用失败（网络 / 鉴权 / 超时 / 输出不可解析）。"""


@lru_cache
def get_client() -> OpenAI:
    settings = get_settings()
    if not settings.llm_api_key:
        raise LlmNotConfiguredError("LLM_API_KEY 未配置")
    return OpenAI(
        api_key=settings.llm_api_key,
        base_url=settings.llm_base_url,
        timeout=settings.llm_timeout,
        max_retries=0,  # 重试策略由调用方按业务语义控制（拆解重试 1 次）
    )


def chat_json(system: str, user: str, max_retries: int = 1) -> tuple[str, dict[str, int]]:
    """单轮 JSON 模式调用。返回 (content, usage)。

    usage: {prompt_tokens, completion_tokens}
    """
    settings = get_settings()
    last_err: Exception | None = None
    for _attempt in range(max_retries + 1):
        try:
            resp = get_client().chat.completions.create(
                model=settings.llm_model,
                temperature=settings.llm_temperature,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            )
            content = resp.choices[0].message.content or ""
            usage: dict[str, int] = {
                "prompt_tokens": resp.usage.prompt_tokens if resp.usage else 0,
                "completion_tokens": resp.usage.completion_tokens if resp.usage else 0,
            }
            return content, usage
        except Exception as err:  # openai 各类异常的统一兜底
            last_err = err
    raise LlmUnavailableError(str(last_err))
