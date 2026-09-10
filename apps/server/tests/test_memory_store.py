"""Metadata round-trips, and old episodes stay readable."""

from __future__ import annotations

from datetime import UTC, datetime

from drymem_server.identity import SCHEMA_VERSION
from drymem_server.memory_store import Fact, Metadata


class TestMetadata:
    def test_round_trips(self):
        original = Metadata(project_key="github.com/acme/drymem", author="miguel@ciudadela.eu")
        assert Metadata.decode(original.encode()) == original

    def test_carries_the_schema_version(self):
        assert (
            Metadata.decode(Metadata(project_key="k", author="a").encode()).schema_version
            == SCHEMA_VERSION
        )

    def test_defaults_are_the_step_1_constants(self):
        meta = Metadata(project_key="k", author="a")
        assert meta.tool == "claude-code"
        assert meta.scope == "private"

    def test_episodes_written_before_metadata_existed_are_readable(self):
        """v2 wrote prose here. It must read back as 'no metadata', not crash."""
        assert Metadata.decode("drymem session summary for /home/miguel/proj") is None
        assert Metadata.decode(None) is None
        assert Metadata.decode("") is None

    def test_malformed_json_is_not_fatal(self):
        assert Metadata.decode("{not json") is None
        assert Metadata.decode('{"valid": "json", "but": "not ours"}') is None


class TestFact:
    def test_a_contradicted_fact_is_marked_superseded(self):
        fact = Fact(name="uses", fact="payments uses Stripe", invalid_at=datetime.now(UTC))
        assert fact.superseded is True

    def test_a_current_fact_is_not(self):
        assert Fact(name="uses", fact="payments uses Adyen").superseded is False
