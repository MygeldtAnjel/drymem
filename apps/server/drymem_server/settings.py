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

    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-haiku-4-5"
    # Drafting a skill is the one place model quality shows most, so this is
    # a bigger model than extraction uses. Only reached when a key is set.
    distill_model: str = "claude-opus-5"

    # Extra literals to redact, e.g. client names or internal hostnames.
    scrub_denylist: str = ""

    # Where the UI is reached from, for links in invites and device-login
    # prompts. Empty means "use the host of the request that asked".
    public_url: str = ""
    # Off on a laptop over http; on behind TLS.
    cookie_secure: bool = False
    session_days: int = 30
    invite_days: int = 7
    # Invites are printed for the admin to forward unless SMTP is configured.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""


settings = Settings()
