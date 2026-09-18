"""Server configuration, from the environment."""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


def find_env_file() -> Path | None:
    """The nearest .env above this package, if there is one.

    Walking up rather than counting parents: the package sits three levels below
    the repo root in the monorepo, at / in a container, and somewhere else again
    when pip-installed. A fixed index crashes on import in two of those three.
    Config comes from the environment in a container, so finding nothing is fine.
    """
    for parent in Path(__file__).resolve().parents:
        candidate = parent / ".env"
        if candidate.is_file():
            return candidate
    return None


_ENV = find_env_file()


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
    # Embeddings need not come from the same place as the reasoning. A machine
    # with no GPU can point these at a hosted embedding provider and skip
    # running a model locally altogether; left unset they follow
    # `local_llm_url` with no key, which is what an Ollama wants.
    embedding_url: str | None = None
    embedding_api_key: str | None = None

    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-haiku-4-5"
    # Drafting a skill is the one place model quality shows most, so this is
    # a bigger model than extraction uses. Only reached when a key is set.
    distill_model: str = "claude-opus-5"

    # Extra literals to redact, e.g. client names or internal hostnames.
    scrub_denylist: str = ""

    # Shared with the control plane (`apps/api`), which signs a short-lived
    # assertion of who the caller is. This service verifies it and trusts
    # nothing else, which is what lets it listen without auth of its own.
    service_secret: str = "dev-only-change-me-0c4f1a9b7e2d5836"


settings = Settings()
