"""
Graphiti client singleton — initialized once, reused across tool calls.

Reads configuration from environment variables:
  NEO4J_URI          bolt://localhost:7687
  NEO4J_USER         neo4j
  NEO4J_PASSWORD     drymem_pass
  LOCAL_LLM_URL      http://localhost:11434/v1
  LOCAL_LLM_MODEL    qwen3.6:35b-a3b
  EMBEDDING_MODEL    text-embedding-nomic-embed-text-v1.5  (or whatever your local server exposes)
  EMBEDDING_DIM      768
"""

from __future__ import annotations

import os

from graphiti_core import Graphiti
from graphiti_core.embedder.openai import OpenAIEmbedder, OpenAIEmbedderConfig
from graphiti_core.llm_client.config import LLMConfig
from graphiti_core.llm_client.openai_generic_client import OpenAIGenericClient

_instance: Graphiti | None = None


async def get_graphiti() -> Graphiti:
    """Return (and lazily initialize) the singleton Graphiti client."""
    global _instance
    if _instance is not None:
        return _instance

    neo4j_uri = os.getenv("NEO4J_URI", "bolt://localhost:7687")
    neo4j_user = os.getenv("NEO4J_USER", "neo4j")
    neo4j_password = os.getenv("NEO4J_PASSWORD", "drymem_pass")

    llm_url = os.getenv("LOCAL_LLM_URL", "http://localhost:11434/v1")
    llm_model = os.getenv("LOCAL_LLM_MODEL", "qwen3.6:35b-a3b")
    embedding_model = os.getenv("EMBEDDING_MODEL", "nomic-embed-text")
    embedding_dim = int(os.getenv("EMBEDDING_DIM", "768"))

    llm_client = OpenAIGenericClient(
        config=LLMConfig(
            api_key="not-needed",
            model=llm_model,
            small_model=llm_model,
            base_url=llm_url,
        )
    )

    embedder = OpenAIEmbedder(
        config=OpenAIEmbedderConfig(
            api_key="not-needed",
            embedding_model=embedding_model,
            embedding_dim=embedding_dim,
            base_url=llm_url,
        )
    )

    graphiti = Graphiti(
        neo4j_uri,
        neo4j_user,
        neo4j_password,
        llm_client=llm_client,
        embedder=embedder,
    )

    await graphiti.build_indices_and_constraints()

    _instance = graphiti
    return _instance
