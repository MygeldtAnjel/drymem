/**
 * All TUI navigation, as a reducer.
 *
 * Kept out of the components deliberately. Navigation is where a terminal UI
 * actually goes wrong — a key that works on one screen and wedges another, a
 * cursor that survives a list getting shorter — and none of that is visible by
 * looking at a rendered frame. As a reducer it is a table test.
 */

import type { EpisodeOut, Fact, ProjectOut } from "../client.js";

export type Screen = "dashboard" | "recent" | "search" | "detail" | "searching" | "confirmDelete";

export interface Rating {
  episodeUuid: string;
  rating: 1 | -1;
}

export interface State {
  screen: Screen;
  previous: Screen;
  cursor: number;
  projects: ProjectOut[];
  episodes: EpisodeOut[];
  facts: Fact[];
  selected: EpisodeOut | null;
  detailScroll: number;
  query: string;
  draftQuery: string;
  ratings: Record<string, 1 | -1>;
  status: string;
  error: string | null;
  loading: boolean;
  exit: boolean;
}

export const ACTIONS = ["Recent memories", "Search memories", "Projects", "Quit"] as const;

export const initialState: State = {
  screen: "dashboard",
  previous: "dashboard",
  cursor: 0,
  projects: [],
  episodes: [],
  facts: [],
  selected: null,
  detailScroll: 0,
  query: "",
  draftQuery: "",
  ratings: {},
  status: "",
  error: null,
  loading: true,
  exit: false,
};

export type Action =
  | { type: "loaded"; projects: ProjectOut[] }
  | { type: "episodes"; episodes: EpisodeOut[] }
  | { type: "facts"; facts: Fact[]; query: string }
  | { type: "error"; message: string }
  | { type: "status"; message: string }
  | { type: "rated"; episodeUuid: string; rating: 1 | -1 }
  | { type: "promoted"; episodeUuid: string }
  | { type: "removed"; episodeUuid: string }
  | { type: "key"; input: string; key: KeyPress };

export interface KeyPress {
  upArrow?: boolean;
  downArrow?: boolean;
  return?: boolean;
  escape?: boolean;
  backspace?: boolean;
  delete?: boolean;
  ctrl?: boolean;
}

/** How many rows the cursor can move over on this screen. */
function listLength(state: State): number {
  switch (state.screen) {
    case "dashboard":
      return ACTIONS.length;
    case "recent":
      return state.episodes.length;
    case "search":
      return state.facts.length;
    default:
      return 0;
  }
}

function clampCursor(state: State): State {
  const max = Math.max(0, listLength(state) - 1);
  return { ...state, cursor: Math.min(state.cursor, max) };
}

function go(state: State, screen: Screen): State {
  return { ...state, previous: state.screen, screen, cursor: 0, status: "" };
}

const isUp = (input: string, key: KeyPress) => key.upArrow || input === "k";
const isDown = (input: string, key: KeyPress) => key.downArrow || input === "j";

/**
 * Enter, however the terminal chose to send it.
 *
 * Ink maps carriage return to `key.return`, but a line feed to an internal name
 * of "enter" that has **no flag on the key object at all** — so a terminal that
 * sends LF silently does nothing. Checking the raw input as well covers both,
 * and costs nothing.
 */
const isEnter = (input: string, key: KeyPress) =>
  Boolean(key.return) || input === "\r" || input === "\n";

function typing(state: State, input: string, key: KeyPress): State {
  if (isEnter(input, key)) {
    // An empty query would fetch everything; treat it as a cancel.
    if (!state.draftQuery.trim()) return { ...state, screen: state.previous };
    return { ...state, screen: "search", query: state.draftQuery, loading: true, cursor: 0 };
  }
  if (key.escape) return { ...state, screen: state.previous, draftQuery: "" };
  if (key.backspace || key.delete) return { ...state, draftQuery: state.draftQuery.slice(0, -1) };
  // Guard against control characters becoming query text — a stray \r or \n
  // would otherwise be typed into the search box.
  if (input && !key.ctrl && !/[\u0000-\u001f]/.test(input)) {
    return { ...state, draftQuery: state.draftQuery + input };
  }
  return state;
}

function onDashboard(state: State, input: string, key: KeyPress): State {
  if (isUp(input, key)) return { ...state, cursor: Math.max(0, state.cursor - 1) };
  if (isDown(input, key)) {
    return { ...state, cursor: Math.min(ACTIONS.length - 1, state.cursor + 1) };
  }
  if (input === "s" || input === "/") {
    return { ...go(state, "searching"), previous: "dashboard", draftQuery: "" };
  }
  if (input === "r") return { ...go(state, "recent"), loading: true };

  if (isEnter(input, key)) {
    switch (ACTIONS[state.cursor]) {
      case "Recent memories":
        return { ...go(state, "recent"), loading: true };
      case "Search memories":
        return { ...go(state, "searching"), previous: "dashboard", draftQuery: "" };
      case "Quit":
        return { ...state, exit: true };
      default:
        return state;
    }
  }
  return state;
}

function onList(state: State, input: string, key: KeyPress): State {
  const length = listLength(state);

  if (isUp(input, key)) return { ...state, cursor: Math.max(0, state.cursor - 1) };
  if (isDown(input, key)) return { ...state, cursor: Math.min(length - 1, state.cursor + 1) };
  if (input === "/" || input === "s") {
    return { ...go(state, "searching"), previous: state.screen, draftQuery: "" };
  }
  if (key.escape) return go(state, "dashboard");

  if (isEnter(input, key) && state.screen === "recent") {
    const episode = state.episodes[state.cursor];
    if (!episode) return state;
    return { ...go(state, "detail"), selected: episode, detailScroll: 0, previous: "recent" };
  }
  return state;
}

function onDetail(state: State, input: string, key: KeyPress): State {
  if (key.escape) return { ...go(state, state.previous), selected: null };
  if (isDown(input, key)) return { ...state, detailScroll: state.detailScroll + 1 };
  if (isUp(input, key)) return { ...state, detailScroll: Math.max(0, state.detailScroll - 1) };
  if (input === "d") return { ...state, screen: "confirmDelete" };
  if (input === "p") {
    if (state.selected?.scope === "team") {
      return { ...state, status: "Already shared with the team." };
    }
    return { ...state, loading: true };
  }
  return state;
}

function onConfirmDelete(state: State, input: string, key: KeyPress): State {
  if (input === "y") return { ...state, loading: true };
  if (input === "n" || key.escape) return { ...state, screen: "detail", status: "" };
  // Enter must not confirm a delete: a stray keypress should never destroy a memory.
  return state;
}

export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "loaded":
      return clampCursor({ ...state, projects: action.projects, loading: false, error: null });

    case "episodes":
      return clampCursor({
        ...state,
        episodes: action.episodes,
        loading: false,
        error: null,
        cursor: 0,
      });

    case "facts":
      return {
        ...state,
        facts: action.facts,
        query: action.query,
        screen: "search",
        loading: false,
        error: null,
        cursor: 0,
      };

    case "error":
      return { ...state, error: action.message, loading: false };

    case "status":
      return { ...state, status: action.message, loading: false };

    case "rated":
      return {
        ...state,
        ratings: { ...state.ratings, [action.episodeUuid]: action.rating },
        status: action.rating > 0 ? "Rated useful" : "Rated not useful",
        loading: false,
      };

    case "promoted": {
      const mark = (e: EpisodeOut) =>
        e.uuid === action.episodeUuid ? { ...e, scope: "team" } : e;
      return {
        ...state,
        episodes: state.episodes.map(mark),
        selected: state.selected ? mark(state.selected) : null,
        status: "Shared with the team",
        loading: false,
      };
    }

    case "removed": {
      const episodes = state.episodes.filter((e) => e.uuid !== action.episodeUuid);
      return clampCursor({
        ...state,
        episodes,
        selected: null,
        screen: "recent",
        status: "Deleted",
        loading: false,
      });
    }

    case "key": {
      const { input, key } = action;
      if (state.screen === "searching") return typing(state, input, key);

      // Quit works everywhere except while typing, where 'q' is a letter.
      if (input === "q" || (key.ctrl && input === "c")) return { ...state, exit: true };

      switch (state.screen) {
        case "dashboard":
          return onDashboard(state, input, key);
        case "recent":
        case "search":
          return onList(state, input, key);
        case "detail":
          return onDetail(state, input, key);
        case "confirmDelete":
          return onConfirmDelete(state, input, key);
        default:
          return state;
      }
    }

    default:
      return state;
  }
}

/** What the reducer cannot do itself: the side effect a key implies. */
export function effectFor(before: State, after: State, input: string): Effect | null {
  if (after.screen === "recent" && before.screen !== "recent" && after.loading) {
    return { type: "fetchEpisodes" };
  }
  if (after.query !== before.query && after.query) return { type: "search", query: after.query };
  if (before.screen === "confirmDelete" && input === "y" && before.selected) {
    return { type: "delete", episodeUuid: before.selected.uuid };
  }
  if (before.screen === "detail" && input === "p" && before.selected?.scope !== "team") {
    return { type: "promote", episodeUuid: before.selected!.uuid };
  }
  if (before.screen === "detail" && (input === "+" || input === "-") && before.selected) {
    return {
      type: "rate",
      episodeUuid: before.selected.uuid,
      rating: input === "+" ? 1 : -1,
      query: before.query,
    };
  }
  return null;
}

export type Effect =
  | { type: "fetchEpisodes" }
  | { type: "search"; query: string }
  | { type: "delete"; episodeUuid: string }
  | { type: "rate"; episodeUuid: string; rating: 1 | -1; query: string }
  | { type: "promote"; episodeUuid: string };
