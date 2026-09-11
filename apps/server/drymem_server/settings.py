"""Server configuration, from the environment."""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# .env lives at the monorepo root, two levels above this package's project dir.
_ENV = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV, extra="ignore")

    database_url: str = "postgresql+asyncpg://drymem:drymem_pass@localhost:5432/drymem"

    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "drymem_pass"

    # ollama | fake | anthropic
    drymem_extractor: str = "ollama"
    local_llm_url: str = "http://localhost:11434/v1"
    local_llm_model: str = "qwen3.6:35b-a3b"
    embedding_model: str = "nomic-embed-text"
    embedding_dim: int = 768

    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-haiku-4-5"

    # Extra literals to redact, e.g. client names or internal hostnames.
    scrub_denylist: str = ""


settings = Settings()
