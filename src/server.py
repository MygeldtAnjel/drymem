"""
Drymem V2 — Persistent memory MCP server backed by Graphiti knowledge graph.

Tools:
  mem_finalize_session  — Save a structured session summary as a graph episode
  mem_search            — Search the knowledge graph for relevant memories
  mem_context           — Retrieve recent episodes for a project
  mem_delete            — Remove an episode from the graph
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone

from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP

from src.graph import get_graphiti

load_dotenv()

mcp = FastMCP(
    "drymem",
    instructions=(
        "Persistent memory for AI coding assistants. "
        "Every tool requires a project_path to isolate context per project."
    ),
)


def _sanitize_group_id(project_path: str) -> str:
    """Convert an arbitrary filesystem path into a stable, Neo4j-safe group_id."""
    slug = re.sub(r"[^a-z0-9]", "-", project_path.lower().strip("/"))
    slug = re.sub(r"-+", "-", slug).strip("-")
    if len(slug) > 60:
        suffix = hashlib.sha1(project_path.encode()).hexdigest()[:8]
        slug = slug[:51] + "-" + suffix
    return slug


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
    graphiti = await get_graphiti()
    group_id = _sanitize_group_id(project_path)

    episode_name = topic_key if topic_key else f"session-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}"

    result = await graphiti.add_episode(
        name=episode_name,
        episode_body=summary,
        source_description=f"drymem session summary for {project_path}",
        reference_time=datetime.now(timezone.utc),
        group_id=group_id,
    )

    entity_count = len(result.entity_nodes) if result.entity_nodes else 0
    edge_count = len(result.entity_edges) if result.entity_edges else 0

    return (
        f"Session finalized: '{episode_name}'\n"
        f"  group: {group_id}\n"
        f"  entities extracted: {entity_count}\n"
        f"  relationships extracted: {edge_count}\n"
        f"  episode_id: {result.episode.uuid}"
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
    graphiti = await get_graphiti()
    group_id = _sanitize_group_id(project_path)

    edges = await graphiti.search(
        query=query,
        group_ids=[group_id],
        num_results=num_results,
    )

    if not edges:
        return "No memories found."

    lines: list[str] = []
    for edge in edges:
        source = edge.source_node_name or "?"
        target = edge.target_node_name or "?"
        fact = edge.fact or edge.name or ""
        created = edge.created_at.strftime("%Y-%m-%d %H:%M") if edge.created_at else "?"
        lines.append(f"- [{source}] --({edge.name})--> [{target}]  {fact}  (created: {created})")

    return f"Found {len(edges)} result(s):\n" + "\n".join(lines)


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
    graphiti = await get_graphiti()
    group_id = _sanitize_group_id(project_path)

    episodes = await graphiti.retrieve_episodes(
        reference_time=datetime.now(timezone.utc),
        last_n=last_n,
        group_ids=[group_id],
    )

    if not episodes:
        return "No recent context."

    lines: list[str] = []
    for ep in episodes:
        ts = ep.created_at.strftime("%Y-%m-%d %H:%M") if ep.created_at else "?"
        body_preview = (ep.content or ep.name or "")[:300]
        lines.append(f"### {ep.name} ({ts})\n{body_preview}\n")

    return f"Recent context ({len(episodes)} episodes):\n\n" + "\n".join(lines)


# ---------------------------------------------------------------------------
# Tool 4: mem_delete
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
    graphiti = await get_graphiti()

    try:
        await graphiti.remove_episode(episode_id)
        return f"Episode {episode_id} deleted."
    except Exception as e:
        return f"Failed to delete episode {episode_id}: {e}"


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------
def main():
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
