"""
drymem — persistent memory MCP server backed by a Graphiti knowledge graph.

Tools:
  mem_finalize_session  — Save a structured session summary as a graph episode
  mem_search            — Search the knowledge graph for relevant memories
  mem_context           — Retrieve recent episodes for a project
  mem_update            — Update an existing episode by topic_key
  mem_delete            — Remove an episode from the graph

The tools are deliberately thin: identity lives in `identity.py`, storage behind
`MemoryStore`. In step 2A these bodies become HTTP calls to the server, and the
logic they wrap does not move.
"""

from __future__ import annotations

import sys
from datetime import UTC, datetime
from pathlib import Path

from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP

from drymem_server.identity import group_id_for, resolve_author, resolve_project_key
from drymem_server.memory_store import (
    Episode,
    Fact,
    GraphitiMemoryStore,
    MemoryStore,
    Metadata,
)

# .env lives at the monorepo root, two levels above this package's project dir.
load_dotenv(Path(__file__).resolve().parents[3] / ".env")

mcp = FastMCP(
    "drymem",
    instructions=(
        "Persistent memory for AI coding assistants. "
        "Every tool requires a project_path to isolate context per project."
    ),
)

store: MemoryStore = GraphitiMemoryStore()

_PREVIEW = 300


def _timestamp() -> str:
    return datetime.now(UTC).strftime("%Y%m%dT%H%M%S")


def _metadata_for(project_path: str) -> Metadata:
    return Metadata(
        project_key=resolve_project_key(project_path),
        author=resolve_author(project_path),
    )


def _format_fact(fact: Fact) -> str:
    when = fact.created_at.strftime("%Y-%m-%d %H:%M") if fact.created_at else "?"
    stale = " [superseded]" if fact.superseded else ""
    return f"- ({fact.name}) {fact.fact}  ({when}){stale}"


def _format_episode(episode: Episode) -> str:
    when = episode.created_at.strftime("%Y-%m-%d %H:%M") if episode.created_at else "?"
    who = f" · {episode.metadata.author}" if episode.metadata else ""
    return f"### {episode.name} ({when}{who})\n{episode.content[:_PREVIEW]}\n"


# ---------------------------------------------------------------------------
# Tool 1: mem_finalize_session
# ---------------------------------------------------------------------------
@mcp.tool()
async def mem_finalize_session(
    project_path: str,
    summary: str,
    topic_key: str = "",
) -> str:
    """Save a structured session summary as a knowledge-graph episode.

    Args:
        project_path: Absolute path of the project (used for isolation).
        summary: Markdown body — include problem, solution, affected files, learnings.
        topic_key: Optional stable key like 'auth/jwt-setup' for cross-session linking.
    """
    metadata = _metadata_for(project_path)
    name = topic_key or f"session-{_timestamp()}"

    result = await store.save(
        name=name,
        body=summary,
        group_id=group_id_for(project_path),
        metadata=metadata,
    )

    return (
        f"Session finalized: '{name}'\n"
        f"  project: {metadata.project_key}\n"
        f"  author: {metadata.author}\n"
        f"  entities extracted: {result.entity_count}\n"
        f"  relationships extracted: {result.edge_count}\n"
        f"  episode_id: {result.uuid}"
    )


# ---------------------------------------------------------------------------
# Tool 2: mem_search
# ---------------------------------------------------------------------------
@mcp.tool()
async def mem_search(
    project_path: str,
    query: str,
    num_results: int = 10,
) -> str:
    """Search the knowledge graph for memories matching a query.

    Args:
        project_path: Absolute path of the project (used for isolation).
        query: Short keyword or phrase to search for.
        num_results: Max results to return (default 10).
    """
    facts = await store.search(
        query=query,
        group_ids=[group_id_for(project_path)],
        limit=num_results,
    )
    if not facts:
        return "No memories found."

    lines = [_format_fact(fact) for fact in facts]
    return f"Found {len(facts)} result(s):\n" + "\n".join(lines)


# ---------------------------------------------------------------------------
# Tool 3: mem_context
# ---------------------------------------------------------------------------
@mcp.tool()
async def mem_context(
    project_path: str,
    last_n: int = 10,
) -> str:
    """Retrieve the most recent episodes and graph state for a project.

    Args:
        project_path: Absolute path of the project (used for isolation).
        last_n: Number of recent episodes to retrieve (default 10).
    """
    episodes = await store.recent(
        group_ids=[group_id_for(project_path)],
        limit=last_n,
    )
    if not episodes:
        return "No recent context."

    lines = [_format_episode(episode) for episode in episodes]
    return f"Recent context ({len(episodes)} episodes):\n\n" + "\n".join(lines)


# ---------------------------------------------------------------------------
# Tool 4: mem_update
# ---------------------------------------------------------------------------
@mcp.tool()
async def mem_update(
    project_path: str,
    topic_key: str,
    update_summary: str,
    replace: bool = False,
) -> str:
    """Update an existing memory episode by topic_key.

    By default appends new information as a linked update episode — Graphiti
    reconciles contradicting facts in the graph automatically. Pass replace=True
    to delete the old episode(s) first and save a clean single entry.

    Args:
        project_path: Absolute path of the project (used for isolation).
        topic_key: The stable key used when the episode was originally saved.
        update_summary: New information — what changed, bug found, fix applied.
        replace: If True, deletes old episode(s) before saving. Default False.
    """
    group_id = group_id_for(project_path)
    metadata = _metadata_for(project_path)

    recent = await store.recent(group_ids=[group_id], limit=50)
    matching = [
        ep for ep in recent if ep.name == topic_key or ep.name.startswith(f"{topic_key}/update-")
    ]

    if replace:
        for episode in matching:
            try:
                await store.delete(episode.uuid)
            except Exception as exc:  # noqa: BLE001 - a stale uuid must not block the write
                print(f"drymem: could not delete {episode.uuid}: {exc}", file=sys.stderr)

    # Replacing reuses the topic key; appending suffixes so both survive.
    name = topic_key if replace else f"{topic_key}/update-{_timestamp()}"

    result = await store.save(
        name=name,
        body=update_summary,
        group_id=group_id,
        metadata=metadata,
    )
    action = "replaced" if (replace and matching) else "appended"

    return (
        f"Memory updated ({action}): '{name}'\n"
        f"  project: {metadata.project_key}\n"
        f"  previous episodes found: {len(matching)}\n"
        f"  entities extracted: {result.entity_count}\n"
        f"  relationships extracted: {result.edge_count}\n"
        f"  episode_id: {result.uuid}"
    )


# ---------------------------------------------------------------------------
# Tool 5: mem_delete
# ---------------------------------------------------------------------------
@mcp.tool()
async def mem_delete(
    project_path: str,
    episode_id: str,
) -> str:
    """Delete an episode from the knowledge graph.

    Args:
        project_path: Absolute path of the project (used for isolation).
        episode_id: UUID of the episode to delete.
    """
    try:
        await store.delete(episode_id)
    except Exception as exc:  # noqa: BLE001 - surfaced to the agent, not raised
        return f"Failed to delete episode {episode_id}: {exc}"
    return f"Episode {episode_id} deleted."


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------
def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
