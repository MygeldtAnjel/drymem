/** The screens. All state comes in as props; nothing here fetches or decides. */

import { Box, Text } from "ink";
import React from "react";

import { author, episodeLabel, firstLine, ratio, when } from "./format.js";
import { ACTIONS, type State } from "./state.js";

const ACCENT = "cyan";
const MUTED = "gray";

function Header({ title }: { title: string }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color={ACCENT}>
        {title}
      </Text>
      <Text color={MUTED}>{"─".repeat(Math.max(title.length, 40))}</Text>
    </Box>
  );
}

function Footer({ keys }: { keys: string }) {
  return (
    <Box marginTop={1}>
      <Text color={MUTED}>{keys}</Text>
    </Box>
  );
}

function Cursor({ selected }: { selected: boolean }) {
  return <Text color={ACCENT}>{selected ? "▸ " : "  "}</Text>;
}

export function Dashboard({ state }: { state: State }) {
  const memories = state.projects.reduce((n, p) => n + p.memory_count, 0);
  const positive = state.projects.reduce((n, p) => n + p.positive, 0);
  const negative = state.projects.reduce((n, p) => n + p.negative, 0);

  return (
    <Box flexDirection="column">
      <Header title="drymem — shared memory for AI coding agents" />

      <Box borderStyle="round" borderColor={MUTED} paddingX={2} flexDirection="column">
        <Text>
          <Text color="green" bold>
            {String(memories).padStart(4)}
          </Text>{" "}
          memories
        </Text>
        <Text>
          <Text color="green" bold>
            {String(state.projects.length).padStart(4)}
          </Text>{" "}
          projects
        </Text>
        <Text color={MUTED}>     {ratio(positive, negative)}</Text>
      </Box>

      {state.projects.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={MUTED}>Projects</Text>
          {state.projects.map((p) => (
            <Text key={p.id}>
              {"  "}
              <Text color="yellow">{p.project_key}</Text>{" "}
              <Text color={MUTED}>({p.memory_count})</Text>
            </Text>
          ))}
        </Box>
      )}

      <Box flexDirection="column" marginTop={1}>
        <Text color="magenta" bold>
          Actions
        </Text>
        {ACTIONS.map((action, index) => (
          <Text key={action}>
            <Cursor selected={index === state.cursor} />
            <Text color={index === state.cursor ? ACCENT : undefined}>{action}</Text>
          </Text>
        ))}
      </Box>

      <Footer keys="j/k navigate · enter select · s search · r recent · q quit" />
    </Box>
  );
}

export function Projects({ state }: { state: State }) {
  return (
    <Box flexDirection="column">
      <Header title={`Projects — ${state.projects.length}`} />

      {state.projects.length === 0 ? (
        <Text color={MUTED}>No projects yet. One appears when a memory is saved.</Text>
      ) : (
        state.projects.map((project, index) => {
          const active = project.project_key === state.activeProject;
          return (
            <Box key={project.id} flexDirection="column">
              <Text>
                <Cursor selected={index === state.cursor} />
                <Text color={index === state.cursor ? ACCENT : "yellow"}>
                  {project.project_key}
                </Text>
                {active ? <Text color="green"> ●</Text> : null}
              </Text>
              <Text color={MUTED}>
                {"    "}
                {project.memory_count} memories · {ratio(project.positive, project.negative)}
              </Text>
            </Box>
          );
        })
      )}

      <Footer keys="j/k navigate · enter open · esc back · q quit" />
    </Box>
  );
}

export function Recent({ state }: { state: State }) {
  return (
    <Box flexDirection="column">
      <Header title={`${state.activeProject} — ${state.episodes.length} memories`} />

      {state.episodes.length === 0 ? (
        <Text color={MUTED}>
          No memories yet. They appear here once an agent saves one.
        </Text>
      ) : (
        state.episodes.map((episode, index) => {
          const rating = state.ratings[episode.uuid];
          return (
            <Box key={episode.uuid} flexDirection="column">
              <Text>
                <Cursor selected={index === state.cursor} />
                <Text color={index === state.cursor ? ACCENT : "blue"}>
                  {episodeLabel(episode)}
                </Text>{" "}
                <Text color={MUTED}>
                  {author(episode.author)} · {when(episode.created_at)}
                </Text>
                {episode.scope === "team" ? <Text color="green"> [team]</Text> : null}
                {rating ? <Text>{rating > 0 ? " 👍" : " 👎"}</Text> : null}
              </Text>
              <Text color={MUTED}>    {firstLine(episode.content)}</Text>
            </Box>
          );
        })
      )}

      <Footer keys="j/k navigate · enter detail · / search · esc back · q quit" />
    </Box>
  );
}

export function Search({ state }: { state: State }) {
  return (
    <Box flexDirection="column">
      <Header title={`Search: "${state.query}" — ${state.facts.length} result(s)`} />

      {state.facts.length === 0 ? (
        <Text color={MUTED}>Nothing matched. Try a shorter keyword.</Text>
      ) : (
        state.facts.map((fact, index) => (
          <Box key={`${fact.name}-${index}`} flexDirection="column">
            <Text>
              <Cursor selected={index === state.cursor} />
              <Text color="yellow">({fact.name})</Text> {fact.fact}
            </Text>
            <Text color={MUTED}>
              {"    "}
              {when(fact.created_at)}
              {fact.superseded ? (
                <Text color="red"> [superseded]</Text>
              ) : null}
            </Text>
          </Box>
        ))
      )}

      <Footer keys="j/k navigate · / new search · esc back · q quit" />
    </Box>
  );
}

export function Searching({ state }: { state: State }) {
  return (
    <Box flexDirection="column">
      <Header title="Search memories" />
      <Text>
        <Text color={ACCENT}>› </Text>
        {state.draftQuery}
        <Text color={ACCENT}>█</Text>
      </Text>
      <Text color={MUTED}>Short keywords work best: "auth", not "authentication setup".</Text>
      <Footer keys="enter search · esc cancel" />
    </Box>
  );
}

const DETAIL_LINES = 20;

export function Detail({ state }: { state: State }) {
  const episode = state.selected;
  if (!episode) return <Text color={MUTED}>Nothing selected.</Text>;

  const lines = episode.content.split("\n");
  const visible = lines.slice(state.detailScroll, state.detailScroll + DETAIL_LINES);
  const rating = state.ratings[episode.uuid];

  return (
    <Box flexDirection="column">
      <Header title={episodeLabel(episode)} />

      <Box flexDirection="column" marginBottom={1}>
        <Text color={MUTED}>
          author {"  "}
          <Text color="yellow">{author(episode.author)}</Text>
        </Text>
        <Text color={MUTED}>
          created {" "}
          <Text color="white">{when(episode.created_at)}</Text>
        </Text>
        <Text color={MUTED}>
          scope {"   "}
          <Text color="white">{episode.scope}</Text>
        </Text>
        {rating ? <Text color={MUTED}>rating {"  "}{rating > 0 ? "👍" : "👎"}</Text> : null}
      </Box>

      {visible.map((line, index) => (
        <Text key={state.detailScroll + index}>{line || " "}</Text>
      ))}

      {lines.length > state.detailScroll + DETAIL_LINES && (
        <Text color={MUTED}>
          … {lines.length - state.detailScroll - DETAIL_LINES} more line(s)
        </Text>
      )}

      <Footer keys="j/k scroll · + useful · - not useful · p share · d delete · esc back · q quit" />
    </Box>
  );
}

export function ConfirmDelete({ state }: { state: State }) {
  return (
    <Box flexDirection="column">
      <Header title="Delete this memory?" />
      <Text color="yellow">{state.selected ? episodeLabel(state.selected) : ""}</Text>
      <Box marginTop={1}>
        <Text color="red">This cannot be undone. </Text>
        <Text>Press </Text>
        <Text bold color="red">
          y
        </Text>
        <Text> to delete, </Text>
        <Text bold>n</Text>
        <Text> to cancel.</Text>
      </Box>
    </Box>
  );
}
