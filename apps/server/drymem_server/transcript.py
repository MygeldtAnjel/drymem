"""
Reading Claude Code session transcripts (`~/.claude/projects/*/*.jsonl`).

The shape that matters, verified against real transcripts:

    {"type": "assistant", "message": {"role": "assistant", "content": [ ...blocks ]}}

`type` is the *entry* kind (`assistant`, `user`, `attachment`, ...), never a
content-block type, and the blocks live under `message`, not at the top level.
Reading `entry["content"]` or `entry["role"]` finds nothing at all.

MCP tools appear under their fully-qualified name — `mcp__drymem__mem_search`,
not `mem_search` — so tool matching is by suffix.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

# Entry kinds that never carry a message; skipped cheaply rather than parsed.
NON_MESSAGE_TYPES = frozenset(
    {
        "attachment",
        "queue-operation",
        "file-history-snapshot",
        "atis-latch",
        "last-prompt",
        "ai-title",
        "summary",
    }
)


def iter_entries(path: str | Path) -> Iterator[dict]:
    """Yield each JSON entry. Unreadable files and bad lines yield nothing.

    A transcript is appended to while the session runs, so the final line can be
    half-written; a bad line is skipped, never fatal.
    """
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except ValueError:
                    continue
                if isinstance(entry, dict):
                    yield entry
    except (OSError, UnicodeError):
        return


def iter_blocks(entry: dict, role: str | None = None) -> Iterator[dict]:
    """Yield the content blocks of one entry, optionally filtered by role."""
    if entry.get("type") in NON_MESSAGE_TYPES:
        return
    message = entry.get("message")
    if not isinstance(message, dict):
        return
    if role is not None and message.get("role") != role:
        return
    content = message.get("content")
    if isinstance(content, str):
        yield {"type": "text", "text": content}
        return
    if not isinstance(content, list):
        return
    for block in content:
        if isinstance(block, dict):
            yield block


def tool_calls(path: str | Path) -> list[str]:
    """Every tool name invoked in the transcript, in order, with duplicates."""
    names: list[str] = []
    for entry in iter_entries(path):
        for block in iter_blocks(entry, role="assistant"):
            if block.get("type") == "tool_use":
                name = block.get("name")
                if isinstance(name, str) and name:
                    names.append(name)
    return names


def matches_tool(name: str, wanted: str) -> bool:
    """True for both `mem_search` and `mcp__drymem__mem_search`."""
    return name == wanted or name.endswith(f"__{wanted}")


def was_called(path: str | Path, wanted: str) -> bool:
    """Did this session already invoke `wanted`?"""
    return any(matches_tool(name, wanted) for name in tool_calls(path))


def assistant_texts(path: str | Path) -> list[str]:
    """Assistant text blocks, oldest first.

    Only a fallback: the `Stop` hook payload carries `last_assistant_message`,
    which is cheaper and exact. Used when that field is absent.
    """
    texts: list[str] = []
    for entry in iter_entries(path):
        for block in iter_blocks(entry, role="assistant"):
            if block.get("type") == "text":
                text = block.get("text")
                if isinstance(text, str) and text.strip():
                    texts.append(text)
    return texts
