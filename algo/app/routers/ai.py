"""LLM 调用点（全系统仅有的两处，规格书 S6.1 / S6.2）。

调用点 1 decompose：作业要求 -> 任务 DAG + 协作契约。
调用点 2 conflict：语义冲突归因（前置相似度筛选 0.30–0.85 由调用方负责）。

统一约定（《技术选型说明书》T6）：openai SDK + JSON 模式，temperature=0.2，
超时 90s，失败重试 1 次后降级；每次调用写 ai_call_logs（S6 期接入）。
脚手架阶段为占位实现（501）。
"""

from fastapi import APIRouter, Depends, HTTPException

from ..deps import require_internal_secret
from ..schemas import ConflictRequest, ConflictResponse, DecomposeRequest, DecomposeResponse

router = APIRouter(prefix="/internal/ai", dependencies=[Depends(require_internal_secret)], tags=["ai"])


@router.post("/decompose", response_model=DecomposeResponse)
def decompose(req: DecomposeRequest) -> DecomposeResponse:
    """LLM 调用点 1：拆解为任务 DAG + 协作契约，后置规则校验（重复 id/悬空依赖/成环）。"""
    raise HTTPException(status_code=501, detail="S3 期实现：LLM 作业拆解")


@router.post("/conflict", response_model=ConflictResponse)
def conflict(req: ConflictRequest) -> ConflictResponse:
    """LLM 调用点 2：语义冲突归因，reason 必须引用双方原文片段。"""
    raise HTTPException(status_code=501, detail="S5 期实现：LLM 冲突归因")
