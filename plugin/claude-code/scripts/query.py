#!/usr/bin/env python3
"""
drymem query helper for hook scripts.
Queries Neo4j directly (bypasses MCP) for fast context loading at session start.

Usage: query.py <project_path> context
"""

import hashlib
import os
import re
import sys
from datetime import datetime, timezone

from dotenv import load_dotenv

DRYMEM_DIR = os.environ.get("DRYMEM_DIR", os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))
load_dotenv(os.path.join(DRYMEM_DIR, ".env"))


def sanitize_group_id(project_path: str) -> str:
    slug = re.sub(r"[^a-z0-9]", "-", project_path.lower().strip("/"))
    slug = re.sub(r"-+", "-", slug).strip("-")
    if len(slug) > 60:
        suffix = hashlib.sha1(project_path.encode()).hexdigest()[:8]
        slug = slug[:51] + "-" + suffix
    return slug


def get_context(project_path: str) -> str:
    try:
        from neo4j import GraphDatabase
    except ImportError:
        return ""

    uri = os.getenv("NEO4J_URI", "bolt://localhost:7687")
    user = os.getenv("NEO4J_USER", "neo4j")
    password = os.getenv("NEO4J_PASSWORD", "drymem_pass")
    group_id = sanitize_group_id(project_path)

    try:
        driver = GraphDatabase.driver(uri, auth=(user, password))
        with driver.session() as session:
            result = session.run(
                """
                MATCH (e:Episodic)
                WHERE e.group_id = $group_id
                RETURN e.name AS name, e.content AS content, e.created_at AS created_at
                ORDER BY e.created_at DESC
                LIMIT 5
                """,
                group_id=group_id,
            )
            records = list(result)
        driver.close()
    except Exception:
        return ""

    if not records:
        return ""

    lines = []
    for r in records:
        name = r["name"] or "untitled"
        content = (r["content"] or "")[:300]
        ts = r["created_at"] or ""
        lines.append(f"### {name} ({ts})\n{content}\n")

    return "\n".join(lines)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(0)

    project_path = sys.argv[1]
    command = sys.argv[2]

    if command == "context":
        output = get_context(project_path)
        if output:
            print(output)
