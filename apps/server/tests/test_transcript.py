"""
Transcript parsing.

The bug this pins down: the original parser read `entry["content"]` and
`entry["role"]`, but real entries nest both under `entry["message"]`. Every
branch failed silently, so autosave never saved anything — and even with correct
parsing it compared against `mem_finalize_session` while transcripts record
`mcp__drymem__mem_finalize_session`.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from drymem_server.transcript import (
    assistant_texts,
    iter_entries,
    matches_tool,
    tool_calls,
    was_called,
)

FIXTURES = Path(__file__).parent / "fixtures" / "transcripts"
SAVE_TOOL = "mem_finalize_session"


def fx(name: str) -> Path:
    return FIXTURES / name


class TestToolDetection:
    def test_finds_the_save_when_it_happened(self):
        assert was_called(fx("saved.jsonl"), SAVE_TOOL) is True

    def test_reports_no_save_when_it_did_not(self):
        assert was_called(fx("not-saved.jsonl"), SAVE_TOOL) is False

    def test_another_drymem_tool_is_not_a_save(self):
        """mem_search in the transcript must not be mistaken for mem_finalize_session."""
        assert "mcp__drymem__mem_search" in tool_calls(fx("not-saved.jsonl"))
        assert was_called(fx("not-saved.jsonl"), SAVE_TOOL) is False

    def test_mcp_prefixed_names_match_the_bare_tool_name(self):
        assert matches_tool("mcp__drymem__mem_finalize_session", SAVE_TOOL)
        assert matches_tool("mem_finalize_session", SAVE_TOOL)

    def test_a_different_tool_does_not_match(self):
        assert not matches_tool("mcp__other__mem_finalize_session_v2", SAVE_TOOL)
        assert not matches_tool("Read", SAVE_TOOL)

    def test_tool_calls_are_in_order_with_duplicates(self):
        assert tool_calls(fx("saved.jsonl")) == [
            "Read",
            "mcp__drymem__mem_finalize_session",
        ]


class TestRobustness:
    def test_missing_file_is_not_an_error(self):
        assert tool_calls(fx("does-not-exist.jsonl")) == []
        assert was_called(fx("does-not-exist.jsonl"), SAVE_TOOL) is False

    def test_entries_with_no_message_are_skipped(self):
        assert tool_calls(fx("noise-only.jsonl")) == []
        assert assistant_texts(fx("noise-only.jsonl")) == []
        assert len(list(iter_entries(fx("noise-only.jsonl")))) == 5

    def test_a_half_written_last_line_does_not_lose_the_rest(self):
        """A live transcript is appended to while we read it."""
        texts = assistant_texts(fx("truncated.jsonl"))
        assert len(texts) == 1
        assert "complete line here" in texts[0]

    def test_the_old_parsers_shape_yields_nothing(self):
        """Guards against reintroducing the top-level-content assumption."""
        assert tool_calls(fx("legacy-wrong-shape.jsonl")) == []
        assert was_called(fx("legacy-wrong-shape.jsonl"), SAVE_TOOL) is False


class TestAssistantText:
    def test_returns_assistant_text_oldest_first(self):
        texts = assistant_texts(fx("not-saved.jsonl"))
        assert texts[0] == "Looking at the auth module."
        assert "clock skew" in texts[-1]

    def test_user_text_is_excluded(self):
        assert not any("fix the auth bug" in t for t in assistant_texts(fx("not-saved.jsonl")))

    def test_tool_result_blocks_are_not_text(self):
        assert not any("..." == t for t in assistant_texts(fx("saved.jsonl")))


@pytest.mark.skipif(
    not (Path.home() / ".claude" / "projects").is_dir(),
    reason="no local Claude Code transcripts to check against",
)
def test_parses_a_real_transcript():
    """The fixtures encode our belief about the format; this checks reality.

    Fixtures are hand-written, so they would happily agree with a wrong parser.
    This asserts against a transcript Claude Code actually produced.
    """
    root = Path.home() / ".claude" / "projects"
    transcripts = sorted(root.glob("*/*.jsonl"), key=os.path.getmtime, reverse=True)
    if not transcripts:
        pytest.skip("no transcripts found")

    for path in transcripts[:5]:
        names = tool_calls(path)
        if names:
            assert all(isinstance(n, str) and n for n in names)
            return
    pytest.skip("no tool calls in recent transcripts")
