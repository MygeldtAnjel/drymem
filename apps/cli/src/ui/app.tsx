/**
 * The TUI shell: keys in, effects out, screens rendered.
 *
 * Every decision lives in `state.ts`. This file only performs the side effects
 * the reducer asks for, so nothing here needs a terminal to be tested.
 */

import { Box, Text, useApp, useInput } from "ink";
import React, { useCallback, useEffect, useReducer } from "react";

import type { DrymemClient } from "../client.js";
import {
  ConfirmDelete,
  Dashboard,
  Detail,
  Projects,
  Recent,
  Search,
  Searching,
} from "./screens.js";
import {
  type Action,
  type Effect,
  type State,
  effectFor,
  initialState,
  reduce,
} from "./state.js";

export interface AppProps {
  client: Pick<DrymemClient, "projects" | "context" | "search" | "delete" | "rate" | "promote">;
  projectKey: string;
  /** Test seam: lets a test drive the reducer without a real terminal. */
  onState?: (state: State) => void;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function App({ client, projectKey, onState }: AppProps) {
  const { exit } = useApp();
  const [state, dispatch] = useReducer(reduce, {
    ...initialState,
    activeProject: projectKey,
  });

  const run = useCallback(
    async (effect: Effect) => {
      try {
        switch (effect.type) {
          case "fetchEpisodes": {
            dispatch({
              type: "episodes",
              episodes: await client.context(effect.projectKey || projectKey, 50),
            });
            return;
          }
          case "search": {
            // The terminal UI still shows facts; its list view is the memory
            // browser beside it, so the two halves stay distinct there.
            const found = await client.search(effect.projectKey || projectKey, effect.query, 25);
            dispatch({ type: "facts", facts: found.facts, query: effect.query });
            return;
          }
          case "rate": {
            await client.rate(effect.episodeUuid, effect.rating, effect.query);
            dispatch({ type: "rated", episodeUuid: effect.episodeUuid, rating: effect.rating });
            return;
          }
          case "promote": {
            await client.promote(effect.episodeUuid);
            dispatch({ type: "promoted", episodeUuid: effect.episodeUuid });
            return;
          }
          case "delete": {
            await client.delete(effect.episodeUuid);
            dispatch({ type: "removed", episodeUuid: effect.episodeUuid });
            return;
          }
        }
      } catch (error) {
        // The TUI is what people open when something looks wrong, so it has to
        // survive the server being the thing that is wrong.
        dispatch({ type: "error", message: message(error) });
      }
    },
    [client, projectKey],
  );

  useEffect(() => {
    client
      .projects()
      .then((projects) => dispatch({ type: "loaded", projects }))
      .catch((error: unknown) => dispatch({ type: "error", message: message(error) }));
  }, [client]);

  useEffect(() => {
    onState?.(state);
    if (state.exit) exit();
  }, [state, onState, exit]);

  useInput((input, key) => {
    const action: Action = { type: "key", input, key };
    const next = reduce(state, action);
    dispatch(action);

    const effect = effectFor(state, next, input);
    if (effect) void run(effect);
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Body state={state} />
      {state.error && (
        <Box marginTop={1}>
          <Text color="red">✖ {state.error}</Text>
        </Box>
      )}
      {state.status && !state.error && (
        <Box marginTop={1}>
          <Text color="green">{state.status}</Text>
        </Box>
      )}
    </Box>
  );
}

function Body({ state }: { state: State }) {
  if (state.loading && state.screen === "dashboard" && state.projects.length === 0) {
    return <Text color="gray">Loading…</Text>;
  }

  switch (state.screen) {
    case "projects":
      return <Projects state={state} />;
    case "recent":
      return <Recent state={state} />;
    case "search":
      return <Search state={state} />;
    case "searching":
      return <Searching state={state} />;
    case "detail":
      return <Detail state={state} />;
    case "confirmDelete":
      return <ConfirmDelete state={state} />;
    default:
      return <Dashboard state={state} />;
  }
}
