#!/usr/bin/env python3
"""
drymem autosave — runs as a Stop hook after every Claude Code agent turn.

Parses the session transcript (.jsonl), checks if mem_finalize_session was
already called. If not, extracts a summary from assistant messages and saves
it directly to Neo4j via Graphiti (bypassing MCP).

Usage: autosave.py <project_path> <transcript_path> <session_id>
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

DRYMEM_DIR = os.environ.get(
    "DRYMEM_DIR",
    str(Path(__file__).resolve().parent.parent.parent.parent),
)
load_dotenv(os.path.join(DRYMEM_DIR, ".env"))

# Add src to path so we can import graph module
sys.path.insert(0, DRYMEM_DIR)


def sanitize_group_id(project_path: str) -> str:
    slug = re.sub(r"[^a-z0-9]", "-", project_path.lower().strip("/"))
    slug = re.sub(r"-+", "-", slug).strip("-")
    if len(slug) > 60:
        suffix = hashlib.sha1(project_path.encode()).hexdigest()[:8]
        slug = slug[:51] + "-" + suffix
    return slug


def parse_transcript(transcript_path: str) -> dict:
    """Parse the JSONL transcript and extract useful info."""
    already_saved = False
    assistant_messages: list[str] = []
    tool_calls: list[str] = []

    try:
        with open(transcript_path, "r") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue

                # Check if mem_finalize_session was called
                if entry.get("type") == "tool_use":
                    tool_name = entry.get("name", "")
                    if tool_name == "mem_finalize_session":
                        already_saved = True
                    tool_calls.append(tool_name)

                # Also check nested content blocks
                for block in entry.get("content", []):
                    if isinstance(block, dict):
                        if block.get("type") == "tool_use":
                            if block.get("name") == "mem_finalize_session":
                                already_saved = True
                            tool_calls.append(block.get("name", ""))
                        elif block.get("type") == "text":
                            text = block.get("text", "")
                            if text and entry.get("role") == "assistant":
                                assistant_messages.append(text)

                # Top-level assistant text
                if entry.get("role") == "assistant" and isinstance(entry.get("content"), str):
                    assistant_messages.append(entry["content"])

    except (FileNotFoundError, PermissionError):
        return {"already_saved": True, "summary": ""}

    # Build a summary from the last few assistant messages
    recent = assistant_messages[-5:] if assistant_messages else []
    summary = "\n\n".join(recent)

    # Truncate to reasonable length
    if len(summary) > 3000:
        summary = summary[:3000] + "\n...(truncated)"

    return {
        "already_saved": already_saved,
        "summary": summary,
        "tool_calls": tool_calls,
    }


async def autosave(project_path: str, transcript_path: str, session_id: str):
    parsed = parse_transcript(transcript_path)

    if parsed["already_saved"]:
        return

    summary = parsed["summary"]
    if not summary or len(summary.strip()) < 50:
        return

    try:
        from src.graph import get_graphiti

        graphiti = await get_graphiti()
        group_id = sanitize_group_id(project_path)

        episode_name = f"autosave-{session_id[:8]}"
        episode_body = (
            f"## Auto-saved session summary\n\n"
            f"**Session:** {session_id}\n"
            f"**Project:** {project_path}\n\n"
            f"### Assistant activity\n\n{summary}"
        )

        if parsed["tool_calls"]:
            tools_used = ", ".join(set(parsed["tool_calls"]))
            episode_body += f"\n\n### Tools used\n{tools_used}"

        await graphiti.add_episode(
            name=episode_name,
            episode_body=episode_body,
            source_description=f"drymem autosave for {project_path}",
            reference_time=datetime.now(timezone.utc),
            group_id=group_id,
        )

    except Exception:
        # Autosave is best-effort — never crash the hook
        pass


if __name__ == "__main__":
    if len(sys.argv) < 4:
        sys.exit(0)

    project_path = sys.argv[1]
    transcript_path = sys.argv[2]
    session_id = sys.argv[3]

    asyncio.run(autosave(project_path, transcript_path, session_id))
