"""Project identity: the same repo must resolve the same way everywhere."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from drymem_server.identity import (
    group_id_for,
    normalize_remote,
    resolve_author,
    resolve_project_key,
    sanitize_group_id,
)

CANONICAL = "github.com/acme/drymem"

# Shared with the TypeScript client's suite. Two implementations of project
# identity that drift would silently split a team into two projects, so the
# cases live in one file neither side can change alone.
FIXTURES = json.loads(
    (
        Path(__file__).resolve().parents[3] / "packages" / "api-types" / "fixtures" / "remotes.json"
    ).read_text()
)


@pytest.mark.parametrize(
    "case", FIXTURES["canonical"], ids=[c["url"].strip() for c in FIXTURES["canonical"]]
)
def test_shared_fixture_remotes(case, monkeypatch):
    """Every remote form in the shared fixture normalises to its expected key."""
    import drymem_server.identity as ident

    # The fixture's ssh cases assume `github-personal`-style aliases resolve to
    # the literal host; real resolution is covered by TestSshAliases.
    monkeypatch.setattr(ident, "resolve_ssh_host", lambda host: host)

    assert ident.normalize_remote(case["url"]) == case["key"]


@pytest.mark.parametrize("url", FIXTURES["rejected"])
def test_shared_fixture_rejects(url):
    assert normalize_remote(url) is None


@pytest.mark.parametrize("case", FIXTURES["groupIds"], ids=[c["key"] for c in FIXTURES["groupIds"]])
def test_shared_fixture_group_ids(case):
    assert sanitize_group_id(case["key"]) == case["groupId"]


def _init_repo(path: Path, remote: str | None) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "init", "-q"], cwd=path, check=True)
    if remote:
        subprocess.run(["git", "remote", "add", "origin", remote], cwd=path, check=True)
    return path


def test_two_clones_at_different_paths_are_one_project(tmp_path):
    """The acceptance criterion: Miguel's clone and Jose's clone share memory."""
    miguel = _init_repo(tmp_path / "home" / "miguel" / "drymem", "git@github.com:acme/drymem.git")
    jose = _init_repo(
        tmp_path / "Users" / "jose" / "work" / "drymem", "https://github.com/acme/drymem.git"
    )

    assert resolve_project_key(miguel) == resolve_project_key(jose) == CANONICAL
    assert group_id_for(miguel) == group_id_for(jose)


def test_no_remote_falls_back_to_a_stable_local_key(tmp_path):
    repo = _init_repo(tmp_path / "solo", None)
    key = resolve_project_key(repo)

    assert key.startswith("local/solo-")
    assert resolve_project_key(repo) == key, "must be stable across runs"


def test_same_name_different_places_do_not_collide(tmp_path):
    a = _init_repo(tmp_path / "one" / "api", None)
    b = _init_repo(tmp_path / "two" / "api", None)

    assert resolve_project_key(a) != resolve_project_key(b)


def test_subdirectory_resolves_to_the_repo_not_the_subdirectory(tmp_path):
    repo = _init_repo(tmp_path / "repo", None)
    nested = repo / "apps" / "server"
    nested.mkdir(parents=True)

    assert resolve_project_key(nested) == resolve_project_key(repo)


def test_non_repo_directory_still_yields_a_key(tmp_path):
    plain = tmp_path / "plain"
    plain.mkdir()
    assert resolve_project_key(plain).startswith("local/plain-")


class TestGroupId:
    def test_is_neo4j_safe(self):
        gid = sanitize_group_id("github.com/acme/dry_mem.v2")
        assert all(c.isalnum() or c == "-" for c in gid)
        assert not gid.startswith("-") and not gid.endswith("-")

    def test_is_idempotent(self):
        once = sanitize_group_id(CANONICAL)
        assert sanitize_group_id(once) == once

    def test_long_keys_are_capped_but_distinct(self):
        a = sanitize_group_id("github.com/acme/" + "a" * 90)
        b = sanitize_group_id("github.com/acme/" + "a" * 91)

        assert len(a) <= 60 and len(b) <= 60
        assert a != b, "the hash suffix must keep long keys apart"


def test_author_prefers_git_identity(tmp_path):
    repo = _init_repo(tmp_path / "authored", None)
    subprocess.run(["git", "config", "user.email", "miguel@ciudadela.eu"], cwd=repo, check=True)

    assert resolve_author(repo) == "miguel@ciudadela.eu"


def test_author_falls_back_when_git_has_no_identity(tmp_path, monkeypatch):
    monkeypatch.setenv("USER", "miguel")
    plain = tmp_path / "nogit"
    plain.mkdir()

    author = resolve_author(plain)
    assert author.startswith("miguel@") and len(author) > len("miguel@")


class TestSshAliases:
    """Two GitHub accounts means an ~/.ssh/config alias, and a different key.

    Found on Miguel's own machine: his remote is `git@github-personal:...`
    while a teammate cloning normally gets `git@github.com:...`. Without alias
    resolution those are two projects and the memory never meets.
    """

    def test_an_alias_resolves_to_the_real_host(self, monkeypatch):
        import drymem_server.identity as ident

        ident.resolve_ssh_host.cache_clear()
        monkeypatch.setattr(
            ident,
            "resolve_ssh_host",
            lambda host: "github.com" if host == "github-personal" else host,
        )

        assert (
            ident.normalize_remote("git@github-personal:MygeldtAnjel/drymem.git")
            == "github.com/mygeldtanjel/drymem"
        )

    def test_alias_and_plain_clone_are_one_project(self, monkeypatch):
        import drymem_server.identity as ident

        monkeypatch.setattr(
            ident,
            "resolve_ssh_host",
            lambda host: "github.com" if host == "github-personal" else host,
        )

        assert ident.normalize_remote(
            "git@github-personal:acme/drymem.git"
        ) == ident.normalize_remote("https://github.com/acme/drymem.git")

    def test_https_urls_never_consult_ssh_config(self, monkeypatch):
        import drymem_server.identity as ident

        def boom(host):
            raise AssertionError("ssh -G must not run for an https remote")

        monkeypatch.setattr(ident, "resolve_ssh_host", boom)
        assert (
            ident.normalize_remote("https://github-personal/acme/drymem")
            == "github-personal/acme/drymem"
        )

    def test_an_unknown_host_is_left_alone(self):
        from drymem_server.identity import resolve_ssh_host

        assert resolve_ssh_host("totally-made-up-host-xyz") == "totally-made-up-host-xyz"
