"""
The decision tree.

Miguel, looking at the graph canvas: *"it's awful, it should be something clear
like a decision tree."* He was right, and the render was not the problem. The
store holds 509 untyped entities for 20 memories — nineteen per memory, and they
are things like `npm` and `Git`. There is no hierarchy in that, so the canvas
drew everything against everything and produced a hairball.

A tree needs one parent per node. `MENTIONS` is many-to-many, so it can never be
one. The parent has to come from somewhere else, and it does:

    project
      └── area          two path segments, from the files the memory names
           └── decision  the memory that changed that area — who, and when
                └── ⊘    the decision it replaced, where one is recorded

**Areas come from file paths, not from the model.** Every drymem memory has a
"Where" section listing the files it touched, and a path is a hierarchy already.
That makes the roots deterministic — `apps/api` is an area whether or not a
local model was having a good day — and it makes the tree answer the question it
exists for: *who changed the payment component last?* Fourteen of this project's
twenty-one memories name a path. The seven that do not are notes about a deploy,
which are not about a component and should not pretend to be.

**Supersession is read, never guessed**. A decision is drawn as replaced
only when an edge says so. Inferring it from similar text would put invented
history in front of someone making a decision from it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime

from drymem_server.graph import get_graphiti
from drymem_server.memory_store import Metadata

DEFAULT_LIMIT = 200
MAX_LIMIT = 500

# Two segments. One (`apps`) puts everything under three roots and says nothing;
# three (`apps/api/src`) splits one service across a dozen branches nobody reads
# as a unit.
AREA_DEPTH = 2

# Where a memory with no path at all goes. Named rather than hidden: a decision
# that is real but not about code still happened, and silently dropping a third
# of the memories would make the tree a lie by omission.
UNPLACED = "Not about a file"

# A file that lives at the top of the repository — `PLAN.md`, `README.md`. It
# has no directory to be filed under, and naming the branch after the file put
# `PLAN.md` in the tree as though it were a folder.
ROOT_AREA = "repo root"

# A path inside the repository, as a memory would write one: at least one
# directory, ending in a file with a known-ish extension, or a bare directory
# under a top-level folder. Anchored on characters that cannot start a word so
# prose like "see api/ for details" still matches but "e.g." does not.
_PATH = re.compile(
    r"(?<![\w./-])"
    r"((?:[a-zA-Z0-9_.-]+/){1,6}[a-zA-Z0-9_.-]+"
    # Longest extension first, and nothing word-like after it: `ts` before
    # `tsx` in the alternation truncated every `Audit.tsx` to `Audit.ts`.
    r"(?:\.(?:tsx|jsx|yaml|toml|json|yml|css|sql|md|sh|ts|js|py)))"
    r"(?![\w])"
)

# Things that look like a path and are not ours: a URL's tail, a package name, a
# version range. Checked against the first segment.
_NOT_OURS = {
    "http:",
    "https:",
    "github.com",
    "raw.githubusercontent.com",
    "node_modules",
    "www",
}


@dataclass
class Decision:
    """One memory, hanging off the area it changed."""

    id: str
    title: str
    memory_type: str
    author: str
    created_at: datetime | None
    gist: str = ""
    # The files that put it in this area, so a person can see why it is here.
    paths: list[str] = field(default_factory=list)
    # Set when an edge records that a later decision replaced this one.
    superseded_by: str | None = None
    # The person's name when the org knows one; the cards showed a raw email.
    author_name: str = ""


@dataclass
class Area:
    """A part of the codebase, and what was decided about it."""

    id: str
    label: str
    decisions: list[Decision] = field(default_factory=list)
    children: list[Area] = field(default_factory=list)

    @property
    def total(self) -> int:
        """Distinct decisions in this branch.

        Counted by id, not by placement: one memory that touched four services
        hangs under four areas, and summing the placements made the root claim
        thirty-three decisions for twenty-one memories.
        """
        return len(self.decision_ids)

    @property
    def decision_ids(self) -> set[str]:
        ids = {d.id for d in self.decisions}
        for child in self.children:
            ids |= child.decision_ids
        return ids


@dataclass
class Tree:
    root: Area
    truncated: bool = False
    total_memories: int = 0
    # How many memories named no file. Reported rather than hidden.
    unplaced: int = 0


def paths_in(text: str) -> list[str]:
    """Every repository path a memory names, in the order it names them."""
    found: list[str] = []
    for match in _PATH.finditer(text or ""):
        path = match.group(1)
        if path.split("/", 1)[0].lower() in _NOT_OURS:
            continue
        if path not in found:
            found.append(path)
    return found


def area_of(path: str) -> str:
    """The branch a file belongs to: its first `AREA_DEPTH` real directories.

    `.` and `..` are dropped rather than kept: a memory that wrote
    `../../packages/skills/x.md` means the same place as one that wrote the
    absolute path, and keeping the dots put a branch called `..` in the tree.
    """
    parts = [p for p in path.split("/") if p and p not in {".", ".."}]
    # The last part is the file itself and is never an area.
    directories = parts[:-1]
    if not directories:
        return ROOT_AREA
    return "/".join(directories[:AREA_DEPTH])


def _iso(value: object) -> datetime | None:
    if isinstance(value, datetime):
        return value
    to_native = getattr(value, "to_native", None)
    return to_native() if callable(to_native) else None


def _place(root: Area, area: str, decision: Decision) -> None:
    """Hang a decision on `area`, creating the branch on the way down."""
    node = root
    trail: list[str] = []
    for segment in area.split("/") if area else [UNPLACED]:
        trail.append(segment)
        key = "/".join(trail)
        existing = next((c for c in node.children if c.id == key), None)
        if existing is None:
            existing = Area(id=key, label=segment)
            node.children.append(existing)
        node = existing
    node.decisions.append(decision)


def _sort(area: Area) -> None:
    """Busiest branch first, newest decision first. Depth-first, in place."""
    area.decisions.sort(key=lambda d: (d.created_at is None, d.created_at), reverse=True)
    # `UNPLACED` always last: it is the residue, not a headline.
    area.children.sort(key=lambda c: (c.label == UNPLACED, -c.total, c.label))
    for child in area.children:
        _sort(child)


async def build(
    *,
    groups: list[str],
    project_label: str = "project",
    limit: int = DEFAULT_LIMIT,
    kinds: list[str] | None = None,
) -> Tree:
    """The decision tree for these groups.

    Layout is the browser's job, as with the graph: this returns a hierarchy and
    nothing about where anything goes.
    """
    limit = max(1, min(limit, MAX_LIMIT))
    graphiti = await get_graphiti()

    counted, _, _ = await graphiti.driver.execute_query(
        "MATCH (e:Episodic) WHERE e.group_id IN $groups RETURN count(e) AS n",
        groups=groups,
    )
    total = int(counted[0]["n"]) if counted else 0

    records, _, _ = await graphiti.driver.execute_query(
        """
        MATCH (e:Episodic)
        WHERE e.group_id IN $groups
        WITH e ORDER BY e.created_at DESC LIMIT $limit
        OPTIONAL MATCH (e)-[:SUPERSEDES]->(old:Episodic)
        RETURN e.uuid AS uuid,
               e.name AS name,
               e.created_at AS created_at,
               e.source_description AS meta,
               e.content AS content,
               collect(DISTINCT old.uuid) AS replaces
        """,
        groups=groups,
        limit=limit,
    )

    root = Area(id="", label=project_label)
    tree = Tree(root=root, truncated=total > limit, total_memories=total)
    wanted = {k for k in (kinds or []) if k}
    replaced_by: dict[str, str] = {}
    # Same de-duplication as the canvas: promotion copies an episode into the
    # team group, and the author can read both.
    seen: set[tuple[str, str]] = set()

    for record in records:
        meta = Metadata.decode(record["meta"])
        kind = meta.memory_type if meta else "note"
        if wanted and kind not in wanted:
            continue

        content = record["content"] or ""
        identity = (record["name"] or "", content[:400])
        if identity in seen:
            continue
        seen.add(identity)

        for old in record["replaces"] or []:
            if old:
                replaced_by[old] = record["uuid"]

        found = paths_in(content)
        decision = Decision(
            id=record["uuid"],
            title=_title(record["name"], content),
            memory_type=kind,
            author=meta.author if meta else "",
            created_at=_iso(record["created_at"]),
            gist=_gist(content),
            paths=found[:6],
        )

        areas = sorted({area_of(p) for p in found})
        if not areas:
            tree.unplaced += 1
            _place(root, "", decision)
            continue
        # A memory that touched three services belongs under all three. The
        # alternative — picking one — hides the change from two of the people
        # who would go looking for it.
        for area in areas:
            _place(root, area, decision)

    for area_id, newer in replaced_by.items():
        for decision in _walk(root):
            if decision.id == area_id:
                decision.superseded_by = newer

    _sort(root)
    return tree


def _walk(area: Area):
    yield from area.decisions
    for child in area.children:
        yield from _walk(child)


def _title(name: str, content: str) -> str:
    """The memory's own heading, which is what a person wrote for it."""
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            return stripped[2:].strip()
    # No heading: the name is a path like `product/steps-c-d-e-built`.
    return (name or "").rsplit("/", 1)[-1].replace("-", " ").strip() or "Untitled"


# One line under a title in the tree; a readable paragraph in the panel beside
# it. The panel is where somebody decides whether to open the memory at all, and
# a truncated first sentence is not enough to decide on.
GIST_CHARS = 700


def _gist(content: str) -> str:
    """The memory's summary — the paragraph a person wrote to explain it."""
    body = content
    if "## Summary" in body:
        body = body.split("## Summary", 1)[1]

    # Consecutive prose lines are one paragraph; memories are hard-wrapped at 80
    # columns, so taking a single line gives you half a sentence.
    paragraph: list[str] = []
    for line in body.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith(("#", "|", "```")):
            if paragraph:
                break
            continue
        paragraph.append(stripped)

    return " ".join(paragraph)[:GIST_CHARS]
