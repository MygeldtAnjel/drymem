"""
Graphiti client, cached per event loop.

Reads configuration from environment variables:
  NEO4J_URI          bolt://localhost:7687
  NEO4J_USER         neo4j
  NEO4J_PASSWORD     drymem_pass
  LOCAL_LLM_URL      http://localhost:11434/v1
  LOCAL_LLM_MODEL    qwen3.6:35b-a3b
  EMBEDDING_MODEL    nomic-embed-text
  EMBEDDING_DIM      768
"""

from __future__ import annotations

import asyncio
import os

from graphiti_core import Graphiti
from graphiti_core.embedder.openai import OpenAIEmbedder, OpenAIEmbedderConfig
from graphiti_core.llm_client.config import LLMConfig
from graphiti_core.llm_client.openai_generic_client import OpenAIGenericClient

_instance: Graphiti | None = None
_instance_loop: asyncio.AbstractEventLoop | None = None
_indices_built = False


async def get_graphiti() -> Graphiti:
    """Return the Graphiti client for the running event loop.

    The cache is keyed on the loop because Neo4j's async driver binds its
    connection pool to the loop that created it; reusing it from another loop
    fails with "attached to a different loop". One long-lived server has one
    loop and one client, but a hook script calling asyncio.run() more than once
    gets a fresh client per call rather than a broken one.
    """
    global _instance, _instance_loop, _indices_built

    running = asyncio.get_running_loop()
    if _instance is not None and _instance_loop is running:
        return _instance

    graphiti = Graphiti(
        os.getenv("NEO4J_URI", "bolt://localhost:7687"),
        os.getenv("NEO4J_USER", "neo4j"),
        os.getenv("NEO4J_PASSWORD", "drymem_pass"),
        llm_client=OpenAIGenericClient(
            config=LLMConfig(
                api_key="not-needed",
                model=os.getenv("LOCAL_LLM_MODEL", "qwen3.6:35b-a3b"),
                small_model=os.getenv("LOCAL_LLM_MODEL", "qwen3.6:35b-a3b"),
                base_url=os.getenv("LOCAL_LLM_URL", "http://localhost:11434/v1"),
            )
        ),
        embedder=OpenAIEmbedder(
            config=OpenAIEmbedderConfig(
                api_key="not-needed",
                embedding_model=os.getenv("EMBEDDING_MODEL", "nomic-embed-text"),
                embedding_dim=int(os.getenv("EMBEDDING_DIM", "768")),
                base_url=os.getenv("LOCAL_LLM_URL", "http://localhost:11434/v1"),
            )
        ),
    )

    # Indices live in the database, not the client, so this is once per process.
    if not _indices_built:
        await graphiti.build_indices_and_constraints()
        _indices_built = True

    _instance, _instance_loop = graphiti, running
    return _instance
