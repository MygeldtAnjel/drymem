"""
The decision tree.

The pure parts — finding paths, turning one into an area, hanging decisions off
a branch — are what decide whether the tree is readable, so they are tested
directly rather than through a Neo4j round trip.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from drymem_server.tree import (
    ROOT_AREA,
    UNPLACED,
    Area,
    Decision,
    _place,
    _sort,
    area_of,
    paths_in,
)


class TestFindingPaths:
    def test_finds_a_source_file(self):
        assert paths_in("Fixed it in apps/api/src/lib/scan.ts today.") == [
            "apps/api/src/lib/scan.ts"
        ]

    def test_finds_several_and_keeps_the_order(self):
        text = "- `apps/cli/src/diff.ts` — the diff\n- `apps/web/src/pages/Audit.tsx` — the screen"
        assert paths_in(text) == ["apps/cli/src/diff.ts", "apps/web/src/pages/Audit.tsx"]

    def test_does_not_repeat_one(self):
        assert paths_in("apps/api/x.ts and again apps/api/x.ts") == ["apps/api/x.ts"]

    def test_ignores_a_url(self):
        # A memory that cites a doc is not a memory about that doc's path.
        assert paths_in("See https://raw.githubusercontent.com/a/b/HEAD/skills/x/SKILL.md") == []

    def test_ignores_a_dependency(self):
        assert paths_in("It lives in node_modules/left-pad/index.js") == []

    def test_ignores_prose_that_merely_has_a_dot(self):
        assert paths_in("We shipped it, e.g. on Tuesday. No paths here at all.") == []

    def test_wants_a_directory_not_a_bare_filename(self):
        # `README.md` alone says nothing about which part of the tree it is in.
        assert paths_in("Updated README.md") == []


class TestAreas:
    def test_takes_two_directories(self):
        assert area_of("apps/api/src/lib/scan.ts") == "apps/api"

    def test_a_shallow_path_keeps_what_it_has(self):
        assert area_of("apps/README.md") == "apps"

    def test_a_file_is_never_its_own_area(self):
        assert area_of("docs/PLAN.md") == "docs"

    def test_two_files_in_one_service_are_one_area(self):
        a = area_of("apps/api/src/routes/audit.ts")
        b = area_of("apps/api/test/audit.test.ts")
        assert a == b == "apps/api"


def decision(uuid: str, when: datetime) -> Decision:
    return Decision(
        id=uuid, title=uuid, memory_type="decision", author="miguel", created_at=when
    )


class TestRelativePaths:
    def test_dots_are_not_a_branch(self):
        # `../../packages/skills/x.md` means the same place as the plain path.
        assert area_of("../../packages/skills/general/tdd/SKILL.md") == "packages/skills"

    def test_a_leading_dot_is_dropped_too(self):
        assert area_of("./apps/api/src/x.ts") == "apps/api"

    def test_a_file_at_the_top_of_the_repo_is_not_its_own_folder(self):
        # `../../PLAN.md` once produced a branch called `PLAN.md`.
        assert area_of("../../PLAN.md") == ROOT_AREA
        assert area_of("./README.md") == ROOT_AREA


class TestShape:
    def test_a_path_becomes_a_branch_per_segment(self):
        root = Area(id="", label="drymem")
        _place(root, "apps/api", decision("a", datetime(2026, 9, 12, tzinfo=UTC)))

        assert [c.label for c in root.children] == ["apps"]
        assert [c.label for c in root.children[0].children] == ["api"]
        assert root.children[0].children[0].decisions[0].id == "a"

    def test_siblings_share_the_branch_above_them(self):
        root = Area(id="", label="drymem")
        _place(root, "apps/api", decision("a", datetime(2026, 9, 12, tzinfo=UTC)))
        _place(root, "apps/web", decision("b", datetime(2026, 9, 11, tzinfo=UTC)))

        assert len(root.children) == 1
        assert sorted(c.label for c in root.children[0].children) == ["api", "web"]

    def test_total_counts_the_whole_branch(self):
        root = Area(id="", label="drymem")
        _place(root, "apps/api", decision("a", datetime(2026, 9, 12, tzinfo=UTC)))
        _place(root, "apps/web", decision("b", datetime(2026, 9, 11, tzinfo=UTC)))
        assert root.total == 2
        assert root.children[0].total == 2

    def test_total_counts_a_decision_once_however_many_areas_it_touches(self):
        # Summing placements had the root claiming 33 decisions for 21 memories.
        root = Area(id="", label="drymem")
        shared = decision("both", datetime(2026, 9, 12, tzinfo=UTC))
        for area in ("apps/api", "apps/web", "apps/cli"):
            _place(root, area, shared)
        assert root.total == 1
        assert root.children[0].total == 1

    def test_newest_decision_first(self):
        root = Area(id="", label="drymem")
        _place(root, "apps/api", decision("old", datetime(2026, 9, 1, tzinfo=UTC)))
        _place(root, "apps/api", decision("new", datetime(2026, 9, 12, tzinfo=UTC)))
        _sort(root)

        api = root.children[0].children[0]
        assert [d.id for d in api.decisions] == ["new", "old"]

    def test_busiest_branch_first(self):
        root = Area(id="", label="drymem")
        for i in range(3):
            _place(root, "apps/api", decision(f"a{i}", datetime(2026, 9, 1, tzinfo=UTC)))
        _place(root, "docs", decision("d", datetime(2026, 9, 1, tzinfo=UTC)))
        _sort(root)

        assert [c.label for c in root.children] == ["apps", "docs"]

    def test_the_unplaced_branch_goes_last(self):
        root = Area(id="", label="drymem")
        for i in range(5):
            _place(root, "", decision(f"u{i}", datetime(2026, 9, 1, tzinfo=UTC)))
        _place(root, "docs", decision("d", datetime(2026, 9, 1, tzinfo=UTC)))
        _sort(root)

        # Even though it has more in it, the residue is not a headline.
        assert [c.label for c in root.children] == ["docs", UNPLACED]

    def test_a_decision_touching_two_services_appears_under_both(self):
        # Picking one would hide the change from the people who own the other.
        root = Area(id="", label="drymem")
        shared = decision("both", datetime(2026, 9, 12, tzinfo=UTC))
        for area in ("apps/api", "apps/web"):
            _place(root, area, shared)
        _sort(root)

        apps = root.children[0]
        assert {c.label for c in apps.children} == {"api", "web"}
        for child in apps.children:
            assert [d.id for d in child.decisions] == ["both"]


@pytest.mark.parametrize(
    "text,expected",
    [
        ("Touched apps/api/src/lib/seed.ts", "apps/api"),
        ("Touched apps/web/src/pages/Audit.tsx", "apps/web"),
        ("Touched packages/skills/general/tdd/SKILL.md", "packages/skills"),
    ],
)
def test_a_real_memory_line_lands_where_a_person_would_expect(text, expected):
    assert area_of(paths_in(text)[0]) == expected


class TestTheSummaryShownInThePanel:
    """The panel beside the tree is where somebody decides whether to open a
    memory, so a truncated first sentence is not enough to decide on."""

    def test_a_hard_wrapped_paragraph_arrives_whole(self):
        from drymem_server.tree import _gist

        content = (
            "# Retry cap\n\n## Summary\n"
            "The backoff caps at thirty seconds because Adyen\n"
            "rejects anything longer on the retry path.\n\n"
            "## Why\nSomething else entirely.\n"
        )
        assert _gist(content) == (
            "The backoff caps at thirty seconds because Adyen "
            "rejects anything longer on the retry path."
        )

    def test_it_stops_at_the_next_section(self):
        from drymem_server.tree import _gist

        assert "Something else entirely" not in _gist(
            "## Summary\nFirst paragraph.\n\n## Why\nSomething else entirely.\n"
        )

    def test_it_falls_back_to_the_body_when_there_is_no_summary(self):
        from drymem_server.tree import _gist

        assert _gist("# Title\n\nJust prose, no sections.\n") == "Just prose, no sections."

    def test_it_is_capped(self):
        from drymem_server.tree import GIST_CHARS, _gist

        assert len(_gist("## Summary\n" + "word " * 500)) <= GIST_CHARS

    def test_nothing_to_summarise_is_empty_not_a_crash(self):
        from drymem_server.tree import _gist

        assert _gist("") == ""
        assert _gist("# Only a heading\n") == ""
