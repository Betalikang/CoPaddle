"""内部接口的共享密钥校验。

隔离要求（《技术选型说明书》T4 / 规格书 S2）：
算法服务不暴露公网，仅由 Next.js 服务端经内网调用，请求必须携带共享密钥头。
部署层另需保证：仅监听 127.0.0.1、来源 IP 白名单（由反代/防火墙负责，不在本模块内）。
"""
from fastapi import Header, HTTPException

from .config import get_settings

SECRET_HEADER = "X-Internal-Secret"


def require_internal_secret(x_internal_secret: str = Header(default="")) -> None:
    expected = get_settings().algo_shared_secret
    if not expected:
        # 密钥未配置时拒绝一切内部调用，防止裸奔
        raise HTTPException(status_code=503, detail="ALGO_SHARED_SECRET 未配置，服务拒绝内部调用")
    if x_internal_secret != expected:
        raise HTTPException(status_code=401, detail="共享密钥无效")
