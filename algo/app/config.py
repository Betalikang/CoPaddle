"""算法服务配置：全部经环境变量注入（.env），仓库中只保留 .env.example。

约定见《技术选型说明书》T8。任何密钥不得硬编码。
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # 数据库（algo 只读画像与任务数据、只写计算结果表）
    database_url: str = "postgresql://gongjiang:gongjiang@localhost:5433/gongjiang"

    # 服务间共享密钥；未配置时内部接口一律拒绝（fail-closed）
    algo_shared_secret: str = ""

    # LLM（OpenAI 兼容协议；换服务商只改 base_url 与模型名）
    llm_api_key: str = ""
    llm_base_url: str = "https://api.deepseek.com"
    llm_model: str = "deepseek-chat"
    llm_timeout: int = 90
    llm_temperature: float = 0.2

    # 本地对象存储目录
    storage_dir: str = "./storage/uploads"


@lru_cache
def get_settings() -> Settings:
    return Settings()
