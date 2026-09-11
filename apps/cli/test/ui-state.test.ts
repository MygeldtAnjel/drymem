/**
 * TUI navigation.
 *
 * Every key on every screen, because the way a terminal UI fails is a key that
 * works on one screen and wedges another — invisible in a rendered frame, and
 * tedious to find by hand.
 */

import { describe, expect, it } from "vitest";

import type { EpisodeOut, Fact, ProjectOut } from "../src/client.js";
import {
  ACTIONS,
  type KeyPress,
  type State,
  effectFor,
  initialState,
  reduce,
} from "../src/ui/state.js";

const NONE: KeyPress = {};

const episode = (uuid: string, name: string): EpisodeOut => ({
  uuid,
  name,
  content: `# ${name}\nbody line one\nbody line two`,
  created_at: "2026-09-11T10:00:00Z",
  author: "miguel@ciudadela.eu",
  scope: "private",
    title: "",
    type: "note",
    session_id: "",
    topic_key: "",
    promoted_at: null,
    rating: null,
});

const project: ProjectOut = {
  id: "p1",
  project_key: "github.com/acme/payments",
  display_name: null,
  memory_count: 3,
  positive: 9,
  negative: 1,
};

const fact: Fact = { name: "USES", fact: "payments uses Adyen", created_at: null, superseded: false };

function press(state: State, input: string, key: KeyPress = NONE): State {
  return reduce(state, { type: "key", input, key });
}

const LAUNCHED_FROM = "github.com/acme/payments";
const loaded = (): State =>
  reduce({ ...initialState, activeProject: LAUNCHED_FROM }, { type: "loaded", projects: [project] });
const withEpisodes = (): State =>
  reduce(
    { ...loaded(), screen: "recent" },
    { type: "episodes", episodes: [episode("u1", "auth/jwt"), episode("u2", "db/migration")] },
  );

describe("dashboard", () => {
  it("starts on the first action", () => {
    expect(loaded().cursor).toBe(0);
    expect(loaded().screen).toBe("dashboard");
  });

  it("moves with j/k and the arrows alike", () => {
    expect(press(loaded(), "j").cursor).toBe(1);
    expect(press(loaded(), "", { downArrow: true }).cursor).toBe(1);
    expect(press(press(loaded(), "j"), "k").cursor).toBe(0);
  });

  it("does not run off either end", () => {
    expect(press(loaded(), "k").cursor).toBe(0);

    let state = loaded();
    for (let i = 0; i < 20; i += 1) state = press(state, "j");
    expect(state.cursor).toBe(ACTIONS.length - 1);
  });

  it("opens search with s or /", () => {
    expect(press(loaded(), "s").screen).toBe("searching");
    expect(press(loaded(), "/").screen).toBe("searching");
  });

  it("opens recent with r", () => {
    const next = press(loaded(), "r");
    expect(next.screen).toBe("recent");
    expect(next.loading).toBe(true);
  });

  it("enter runs the selected action", () => {
    expect(press(loaded(), "", { return: true }).screen).toBe("recent");

    const onQuit = { ...loaded(), cursor: ACTIONS.indexOf("Quit") };
    expect(press(onQuit, "", { return: true }).exit).toBe(true);
  });

  it("q quits", () => {
    expect(press(loaded(), "q").exit).toBe(true);
  });
});

describe("recent", () => {
  it("lists what was fetched and resets the cursor", () => {
    const state = withEpisodes();
    expect(state.episodes).toHaveLength(2);
    expect(state.cursor).toBe(0);
    expect(state.loading).toBe(false);
  });

  it("stops at the last row", () => {
    let state = withEpisodes();
    for (let i = 0; i < 10; i += 1) state = press(state, "j");
    expect(state.cursor).toBe(1);
  });

  it("enter opens the memory under the cursor", () => {
    const state = press(press(withEpisodes(), "j"), "", { return: true });

    expect(state.screen).toBe("detail");
    expect(state.selected?.uuid).toBe("u2");
  });

  it("enter on an empty list does nothing", () => {
    const empty = reduce({ ...loaded(), screen: "recent" }, { type: "episodes", episodes: [] });
    expect(press(empty, "", { return: true }).screen).toBe("recent");
  });

  it("esc goes back to the dashboard", () => {
    expect(press(withEpisodes(), "", { escape: true }).screen).toBe("dashboard");
  });
});

describe("search", () => {
  it("types, then searches on enter", () => {
    let state = press(loaded(), "s");
    for (const ch of "auth") state = press(state, ch);
    expect(state.draftQuery).toBe("auth");

    state = press(state, "", { return: true });
    expect(state.query).toBe("auth");
    expect(state.screen).toBe("search");
  });

  it("backspace deletes", () => {
    let state = press(loaded(), "s");
    for (const ch of "auth") state = press(state, ch);
    expect(press(state, "", { backspace: true }).draftQuery).toBe("aut");
  });

  it("an empty query cancels rather than fetching everything", () => {
    const state = press(press(loaded(), "s"), "", { return: true });
    expect(state.screen).toBe("dashboard");
    expect(state.query).toBe("");
  });

  it("esc cancels and clears the draft", () => {
    let state = press(loaded(), "s");
    state = press(state, "x");
    state = press(state, "", { escape: true });

    expect(state.screen).toBe("dashboard");
    expect(state.draftQuery).toBe("");
  });

  it("q is a letter while typing, not a quit", () => {
    const state = press(press(loaded(), "s"), "q");
    expect(state.exit).toBe(false);
    expect(state.draftQuery).toBe("q");
  });

  it("returns to whichever screen opened it", () => {
    const state = press(withEpisodes(), "/");
    expect(state.previous).toBe("recent");
    expect(press(state, "", { escape: true }).screen).toBe("recent");
  });

  it("shows results", () => {
    const state = reduce(loaded(), { type: "facts", facts: [fact], query: "payments" });
    expect(state.screen).toBe("search");
    expect(state.facts).toHaveLength(1);
    expect(state.query).toBe("payments");
  });
});

describe("detail", () => {
  const open = () => press(withEpisodes(), "", { return: true });

  it("scrolls down and never above the top", () => {
    expect(press(open(), "j").detailScroll).toBe(1);
    expect(press(open(), "k").detailScroll).toBe(0);
  });

  it("esc returns to the list it came from", () => {
    const state = press(open(), "", { escape: true });
    expect(state.screen).toBe("recent");
    expect(state.selected).toBeNull();
  });

  it("d asks before deleting", () => {
    expect(press(open(), "d").screen).toBe("confirmDelete");
  });

  it("p shares a private memory", () => {
    const before = open();
    expect(effectFor(before, press(before, "p"), "p")).toEqual({
      type: "promote",
      episodeUuid: "u1",
    });
  });

  it("p on an already-shared memory says so instead of re-sharing", () => {
    const before = open();
    const shared = { ...before, selected: { ...before.selected!, scope: "team" } };

    expect(press(shared, "p").status).toBe("Already shared with the team.");
    expect(effectFor(shared, press(shared, "p"), "p")).toBeNull();
  });

  it("promotion marks the memory in the list and the detail view", () => {
    const state = reduce(open(), { type: "promoted", episodeUuid: "u1" });

    expect(state.selected?.scope).toBe("team");
    expect(state.episodes.find((e) => e.uuid === "u1")?.scope).toBe("team");
    expect(state.episodes.find((e) => e.uuid === "u2")?.scope).toBe("private");
    expect(state.status).toBe("Shared with the team");
  });

  it("records a rating", () => {
    const state = reduce(open(), { type: "rated", episodeUuid: "u1", rating: 1 });
    expect(state.ratings["u1"]).toBe(1);
    expect(state.status).toBe("Rated useful");
  });
});

describe("delete confirmation", () => {
  const confirm = () => press(press(withEpisodes(), "", { return: true }), "d");

  it("n cancels back to the detail view", () => {
    expect(press(confirm(), "n").screen).toBe("detail");
  });

  it("esc also cancels", () => {
    expect(press(confirm(), "", { escape: true }).screen).toBe("detail");
  });

  it("any other key does nothing — no accidental deletes", () => {
    expect(press(confirm(), "x").screen).toBe("confirmDelete");
    expect(press(confirm(), "", { return: true }).screen).toBe("confirmDelete");
  });

  it("removing drops the row and returns to the list", () => {
    const state = reduce(confirm(), { type: "removed", episodeUuid: "u1" });

    expect(state.screen).toBe("recent");
    expect(state.episodes.map((e) => e.uuid)).toEqual(["u2"]);
    expect(state.status).toBe("Deleted");
  });

  it("the cursor cannot point past the end after a delete", () => {
    const onLast = press(withEpisodes(), "j");
    const state = reduce(onLast, { type: "removed", episodeUuid: "u2" });

    expect(state.episodes).toHaveLength(1);
    expect(state.cursor).toBeLessThanOrEqual(0);
  });
});

describe("effects", () => {
  it("entering recent fetches", () => {
    const before = loaded();
    const after = press(before, "r");
    expect(effectFor(before, after, "r")).toEqual({
      type: "fetchEpisodes",
      projectKey: LAUNCHED_FROM,
    });
  });

  it("a submitted query searches", () => {
    let before = press(loaded(), "s");
    for (const ch of "auth") before = press(before, ch);
    const after = press(before, "", { return: true });

    expect(effectFor(before, after, "")).toEqual({
      type: "search",
      query: "auth",
      projectKey: LAUNCHED_FROM,
    });
  });

  it("y on the confirmation deletes the selected memory", () => {
    const before = press(press(withEpisodes(), "", { return: true }), "d");
    const after = press(before, "y");

    expect(effectFor(before, after, "y")).toEqual({ type: "delete", episodeUuid: "u1" });
  });

  it("+ and - rate, carrying the query that surfaced the memory", () => {
    const opened = press(withEpisodes(), "", { return: true });
    const before = { ...opened, query: "auth" };

    expect(effectFor(before, press(before, "+"), "+")).toEqual({
      type: "rate",
      episodeUuid: "u1",
      rating: 1,
      query: "auth",
    });
    expect(effectFor(before, press(before, "-"), "-")?.type).toBe("rate");
  });

  it("navigation alone causes no side effect", () => {
    const before = loaded();
    expect(effectFor(before, press(before, "j"), "j")).toBeNull();
  });
});

describe("errors", () => {
  it("an error stops the spinner and is kept for display", () => {
    const state = reduce(loaded(), { type: "error", message: "Cannot reach the server" });
    expect(state.error).toBe("Cannot reach the server");
    expect(state.loading).toBe(false);
  });
});


describe("Enter, however the terminal sends it", () => {
  /**
   * Ink maps CR to `key.return` but LF to a name with no flag on the key
   * object, so a terminal that sends LF silently did nothing. Every path that
   * accepts Enter is checked against all three forms.
   */
  const forms: Array<[string, string, KeyPress]> = [
    ["key.return", "", { return: true }],
    ["carriage return", "\r", {}],
    ["line feed", "\n", {}],
  ];

  for (const [label, input, key] of forms) {
    it(`runs a dashboard action - ${label}`, () => {
      expect(press(loaded(), input, key).screen).toBe("recent");
    });

    it(`opens a memory from the list - ${label}`, () => {
      const state = press(withEpisodes(), input, key);
      expect(state.screen).toBe("detail");
      expect(state.selected?.uuid).toBe("u1");
    });

    it(`submits a search - ${label}`, () => {
      let state = press(loaded(), "s");
      for (const ch of "auth") state = press(state, ch);
      state = press(state, input, key);

      expect(state.query).toBe("auth");
      expect(state.screen).toBe("search");
    });
  }

  it("never types a control character into the search box", () => {
    let state = press(loaded(), "s");
    for (const ch of "au") state = press(state, ch);
    state = press(state, "\u0007"); // a bell, not a letter

    expect(state.draftQuery).toBe("au");
  });

  it("does NOT confirm a delete - a stray keypress must not destroy a memory", () => {
    const confirming = press(press(withEpisodes(), "\r", {}), "d");

    for (const [, input, key] of forms) {
      expect(press(confirming, input, key).screen).toBe("confirmDelete");
    }
  });
});


describe("the Projects menu item", () => {
  /**
   * It sat in the menu doing nothing: `onDashboard` had no case for it, so
   * Enter fell through to `default` and returned the state unchanged. A menu
   * item that does nothing is a broken promise, and this one is also the only
   * way to read a project other than the directory you launched from.
   */
  const onProjects = () => {
    const state = { ...loaded(), cursor: ACTIONS.indexOf("Projects") };
    return press(state, "", { return: true });
  };

  it("opens a projects screen", () => {
    expect(onProjects().screen).toBe("projects");
  });

  it("lists the projects and starts at the first", () => {
    const state = onProjects();
    expect(state.projects).toHaveLength(1);
    expect(state.cursor).toBe(0);
  });

  it("switching project changes what everything else reads", () => {
    const before = onProjects();
    const after = press(before, "", { return: true });

    expect(after.activeProject).toBe("github.com/acme/payments");
    expect(after.screen).toBe("recent");
    expect(after.episodes).toEqual([]);
  });

  it("fetches the chosen project, not the launch directory", () => {
    const before = onProjects();
    const after = press(before, "", { return: true });

    expect(effectFor(before, after, "")).toEqual({
      type: "fetchEpisodes",
      projectKey: "github.com/acme/payments",
    });
  });

  it("a later search stays on the chosen project", () => {
    let state = press(onProjects(), "", { return: true });
    state = { ...state, screen: "recent", loading: false };
    let typing = press(state, "/");
    for (const ch of "auth") typing = press(typing, ch);
    const after = press(typing, "", { return: true });

    expect(effectFor(typing, after, "")).toEqual({
      type: "search",
      query: "auth",
      projectKey: "github.com/acme/payments",
    });
  });

  it("esc returns to the dashboard", () => {
    expect(press(onProjects(), "", { escape: true }).screen).toBe("dashboard");
  });

  it("does not run off the end of a one-project list", () => {
    let state = onProjects();
    for (let i = 0; i < 5; i += 1) state = press(state, "j");
    expect(state.cursor).toBe(0);
  });

  it("enter on an empty list does nothing", () => {
    const empty = { ...initialState, screen: "projects" as const, projects: [] };
    expect(press(empty, "", { return: true }).screen).toBe("projects");
  });

  it("every menu action now does something", () => {
    // The bug was one unhandled case; this stops another being added silently.
    for (const action of ACTIONS) {
      const state = { ...loaded(), cursor: ACTIONS.indexOf(action) };
      const after = press(state, "", { return: true });
      const moved = after.screen !== state.screen || after.exit;
      expect(moved, `"${action}" did nothing`).toBe(true);
    }
  });
});
