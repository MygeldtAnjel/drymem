#!/usr/bin/env python3
"""
drymem query helper for the session-start and post-compaction hooks.

Talks to Neo4j directly rather than going through MCP: session start is on the
critical path of every session, and a Cypher read is milliseconds where booting
the Graphiti client is seconds.

Usage: query.py <project_path> context
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

DRYMEM_DIR = os.environ.get(
    "DRYMEM_DIR",
    str(Path(__file__).resolve().parents[3]),
)
load_dotenv(os.path.join(DRYMEM_DIR, ".env"))

# The server package is a sibling app, not on the path.
sys.path.insert(0, os.path.join(DRYMEM_DIR, "apps", "server"))

from drymem_server.identity import group_id_for
from drymem_server.memory_store import Metadata

RECENT_LIMIT = 5
PREVIEW = 300


def get_context(project_path: str) -> str:
    try:
        from neo4j import GraphDatabase
    except ImportError:
        return ""

    uri = os.getenv("NEO4J_URI", "bolt://localhost:7687")
    user = os.getenv("NEO4J_USER", "neo4j")
    password = os.getenv("NEO4J_PASSWORD", "drymem_pass")

    try:
        driver = GraphDatabase.driver(uri, auth=(user, password))
        with driver.session() as session:
            records = list(
                session.run(
                    """
                    MATCH (e:Episodic)
                    WHERE e.group_id = $group_id
                    RETURN e.name AS name,
                           e.content AS content,
                           e.created_at AS created_at,
                           e.source_description AS source_description
                    ORDER BY e.created_at DESC
                    LIMIT $limit
                    """,
                    group_id=group_id_for(project_path),
                    limit=RECENT_LIMIT,
                )
            )
        driver.close()
    except Exception:  # noqa: BLE001 - a cold database must not block session start
        return ""

    lines = []
    for record in records:
        name = record["name"] or "untitled"
        content = (record["content"] or "")[:PREVIEW]
        created = record["created_at"] or ""
        metadata = Metadata.decode(record["source_description"])
        who = f" · {metadata.author}" if metadata and metadata.author else ""
        lines.append(f"### {name} ({created}{who})\n{content}\n")

    return "\n".join(lines)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(0)

    if sys.argv[2] == "context":
        output = get_context(sys.argv[1])
        if output:
            print(output)
