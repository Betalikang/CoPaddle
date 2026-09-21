"""pytest 共享 fixture。

在导入应用前注入测试用共享密钥，并清空配置缓存，
以覆盖 deps.require_internal_secret 的三种状态（正确/错误/未配置）。
"""
import os

os.environ.setdefault("ALGO_SHARED_SECRET", "test-secret")

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app


@pytest.fixture()
def client() -> TestClient:
    get_settings.cache_clear()
    return TestClient(app)


@pytest.fixture()
def auth_headers() -> dict[str, str]:
    return {"X-Internal-Secret": os.environ["ALGO_SHARED_SECRET"]}
