"""
Graphiti client, cached per event loop.

Configuration comes from `settings`; which model does the extraction comes from
`extraction.build_llm_client` (see DRYMEM_EXTRACTOR).
"""

from __future__ import annotations

import asyncio

from graphiti_core import Graphiti

from drymem_server.extraction import build_cross_encoder, build_embedder, build_llm_client
from drymem_server.settings import settings

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
        settings.neo4j_uri,
        settings.neo4j_user,
        settings.neo4j_password,
        llm_client=build_llm_client(),
        embedder=build_embedder(),
        # Never let Graphiti fall back to its OpenAI default — see build_cross_encoder.
        cross_encoder=build_cross_encoder(),
    )

    # Indices live in the database, not the client, so this is once per process.
    if not _indices_built:
        await graphiti.build_indices_and_constraints()
        _indices_built = True

    _instance, _instance_loop = graphiti, running
    return _instance
