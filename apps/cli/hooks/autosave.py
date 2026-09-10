#!/usr/bin/env python3
"""
drymem autosave — the Stop hook's safety net.

If the agent already called mem_finalize_session this session, do nothing.
Otherwise save what it last said, so a session's work is not lost because the
agent forgot to save it.

Reads the hook payload as JSON on stdin: `last_assistant_message` is the summary
material, `transcript_path` tells us whether a save already happened. Both are
provided by Claude Code — neither needs to be reconstructed.

Usage: autosave.py  (hook JSON on stdin)
"""

from __future__ import annotations

import asyncio
import json
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

from drymem_server.identity import group_id_for, resolve_author
from drymem_server.memory_store import GraphitiMemoryStore, Metadata
from drymem_server.transcript import assistant_texts, was_called

SAVE_TOOL = "mem_finalize_session"
MIN_SUMMARY = 50
MAX_SUMMARY = 3000


def build_summary(payload: dict) -> str:
    """The text worth saving, preferring the payload over the transcript."""
    last = payload.get("last_assistant_message")
    if isinstance(last, str) and last.strip():
        return last.strip()

    transcript = payload.get("transcript_path")
    if not transcript:
        return ""
    texts = assistant_texts(transcript)
    return "\n\n".join(texts[-5:]).strip()


async def autosave(payload: dict) -> str:
    cwd = payload.get("cwd") or os.getcwd()
    session_id = payload.get("session_id") or "unknown"
    transcript = payload.get("transcript_path")

    if transcript and was_called(transcript, SAVE_TOOL):
        return "skipped: agent already saved"

    summary = build_summary(payload)
    if len(summary) < MIN_SUMMARY:
        return "skipped: nothing substantial to save"
    if len(summary) > MAX_SUMMARY:
        summary = summary[:MAX_SUMMARY] + "\n...(truncated)"

    store = GraphitiMemoryStore()
    metadata = Metadata(
        project_key=payload.get("project_key") or "",
        author=resolve_author(cwd),
        scope="private",
    )
    if not metadata.project_key:
        from drymem_server.identity import resolve_project_key

        metadata = Metadata(
            project_key=resolve_project_key(cwd),
            author=metadata.author,
            scope="private",
        )

    body = (
        f"## Auto-saved session summary\n\n"
        f"The agent did not call `{SAVE_TOOL}`, so this is what it last said.\n\n"
        f"{summary}"
    )
    result = await store.save(
        name=f"autosave-{session_id[:8]}",
        body=body,
        group_id=group_id_for(cwd),
        metadata=metadata,
    )
    return f"saved {result.uuid}"


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except (ValueError, OSError):
        return
    if not isinstance(payload, dict):
        return
    try:
        print(asyncio.run(autosave(payload)), file=sys.stderr)
    except Exception as exc:  # noqa: BLE001 - a safety net must never break the session
        print(f"drymem autosave failed: {exc}", file=sys.stderr)


if __name__ == "__main__":
    main()
