"""
Who and where a memory belongs to.

A memory's home must be the same on every machine, so a project is identified by
its git remote rather than by its path on disk. Two clones of one repo at
different absolute paths resolve to one project; two unrelated local folders
that happen to share a name do not.
"""

from __future__ import annotations

import hashlib
import os
import re
import socket
import subprocess
from functools import lru_cache
from pathlib import Path

# Bumped when the shape of stored episode metadata changes, so a later step can
# find and migrate episodes written by an earlier one.
SCHEMA_VERSION = 2

_MAX_GROUP_ID = 60
_CREDENTIALS = re.compile(r"^[^/@]*@")


def _git(cwd: str | Path, *args: str) -> str | None:
    """Run a git command, returning stripped stdout or None if it fails."""
    try:
        out = subprocess.run(
            ["git", "-C", str(cwd), *args],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0:
        return None
    return out.stdout.strip() or None


@lru_cache(maxsize=64)
def resolve_ssh_host(host: str) -> str:
    """Resolve an SSH config alias to the hostname it actually points at.

    Anyone juggling two GitHub accounts has a `Host github-personal` block in
    ~/.ssh/config, so their remote reads `git@github-personal:me/repo.git` while
    a teammate's reads `git@github.com:me/repo.git`. Same repo, and it must be
    the same project key. `ssh -G` answers this in about 2ms without connecting,
    and is a no-op for hosts that have no config entry.
    """
    try:
        out = subprocess.run(
            ["ssh", "-G", host],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return host
    if out.returncode != 0:
        return host
    for line in out.stdout.splitlines():
        key, _, value = line.strip().partition(" ")
        if key == "hostname" and value:
            return value.lower()
    return host


def normalize_remote(url: str) -> str | None:
    """Reduce any git remote URL to `host/org/repo`.

    All of these are the same project:
        git@github.com:Acme/drymem.git
        https://github.com/acme/drymem
        ssh://git@github.com:22/acme/drymem.git
        https://user:token@github.com/acme/drymem.git
        git@github-personal:acme/drymem.git   (an ~/.ssh/config alias)
    """
    url = url.strip()
    if not url:
        return None

    # scp-style (git@host:org/repo) has no scheme and uses ':' as a separator
    is_ssh = "://" not in url and ":" in url
    if is_ssh:
        host_part, _, path_part = url.partition(":")
        url = f"ssh://{host_part}/{path_part}"
    elif url.startswith("ssh://"):
        is_ssh = True

    _, _, rest = url.rpartition("://")
    rest = _CREDENTIALS.sub("", rest, count=1)  # drop user:token@ / git@

    host, _, path = rest.partition("/")
    host = host.split(":", 1)[0].lower()  # drop :port
    path = path.strip("/")
    path = path.removesuffix(".git")

    if not host or not path:
        return None
    if is_ssh:
        host = resolve_ssh_host(host)
    return f"{host}/{path.lower()}"


def resolve_project_key(cwd: str | Path) -> str:
    """The stable identity of the project at `cwd`.

    Falls back to a path-derived key when there is no git remote — the hash
    keeps two same-named folders apart, and the basename keeps it readable.
    """
    remote = _git(cwd, "remote", "get-url", "origin")
    if remote:
        normalized = normalize_remote(remote)
        if normalized:
            return normalized

    root = _git(cwd, "rev-parse", "--show-toplevel") or str(cwd)
    abspath = str(Path(root).resolve())
    digest = hashlib.sha1(abspath.encode()).hexdigest()[:8]
    return f"local/{Path(abspath).name.lower()}-{digest}"


def sanitize_group_id(project_key: str) -> str:
    """Convert a project key into a stable, Neo4j-safe group id.

    The only definition — hooks and server both import this one. Changing it
    orphans every memory already stored, so it changes only with a migration.
    """
    slug = re.sub(r"[^a-z0-9]", "-", project_key.lower().strip("/"))
    slug = re.sub(r"-+", "-", slug).strip("-")
    if len(slug) > _MAX_GROUP_ID:
        suffix = hashlib.sha1(project_key.encode()).hexdigest()[:8]
        slug = slug[: _MAX_GROUP_ID - 9] + "-" + suffix
    return slug


def group_id_for(cwd: str | Path) -> str:
    """The unscoped group id. Pre-3A memories live here; new writes do not."""
    return sanitize_group_id(resolve_project_key(cwd))


def _short(value: object) -> str:
    """Eight hex of a uuid.

    Not the whole thing: a full uuid pushes the id past the 60-char cap into the
    hash branch, which is deterministic but unreadable for anyone debugging
    against Neo4j directly. Eight hex is 4 billion values.
    """
    return str(value).replace("-", "")[:8]


def group_id_team(org_id: object, project_key: str) -> str:
    """Where promoted memories live. Every project member reads this.

    **Scoped by organisation, not by project key alone.** A project key is a git
    remote, and two organisations can perfectly well both track
    `github.com/acme/payments` — one forked it, the other depends on it. Keyed
    on the project alone they shared a Neo4j group, and a member of the second
    org read the first org's shared memories through their own project. The
    control plane's `org_id` check passed the whole way, because both callers
    were legitimately members of *a* project with that key.
    """
    return sanitize_group_id(f"{_short(org_id)}/{project_key}/team")


def group_id_private(org_id: object, project_key: str, user_id: object) -> str:
    """Where one person's unshared memories live.

    The user id already makes this unique across organisations; the org is here
    so both group ids are built the same way and neither can be derived without
    knowing which tenant is asking.
    """
    return sanitize_group_id(f"{_short(org_id)}/{project_key}/u/{_short(user_id)}")


def resolve_author(cwd: str | Path) -> str:
    """Who is saving this memory. Their git identity, or a machine-local one."""
    email = _git(cwd, "config", "user.email")
    if email:
        return email
    user = os.getenv("USER") or os.getenv("USERNAME") or "unknown"
    return f"{user}@{socket.gethostname()}"
