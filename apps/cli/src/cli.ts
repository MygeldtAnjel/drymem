#!/usr/bin/env node
/**
 * `drymem` — the command a developer runs.
 *
 * Everything heavy lives on the server; this is HTTP plus the local git remote.
 */

import { DrymemClient, DrymemError } from "./client.js";
import type { Source } from "./import.js";
import { requireConfig } from "./config.js";
import { HOOKS, readPayload, type HookName } from "./hooks.js";
import { resolveProjectKey } from "./identity.js";
import { runSetup } from "./setup.js";

/** Stamped into the lock file so a team can see what produced their skills. */
const VERSION = "2.1.0";

const USAGE = `drymem — shared long-term memory for AI coding agents

Usage
  npx drymem setup [--global]     Configure this machine (server URL, token, hooks, MCP)
  npx drymem save <summary>       Save a memory for the current project
  npx drymem search <query>       Search this project's memory
  npx drymem context [n]          Show the most recent memories
  npx drymem skills <cmd>         list | status | sync  (installs .claude/skills/)
  npx drymem import <source>      Backfill memories the team already wrote down
                                  (claude-memory, git, docs, ecc, engram; --dry-run to preview)
  npx drymem promote <episode-id> Share a memory with the project's members
  npx drymem delete <episode-id>  Remove a memory
  npx drymem projects             List the projects you can see
  npx drymem ui                   Browse, search and rate memories in a terminal UI
  npx drymem whoami               Show the resolved project and server
  npx drymem mcp                  Run the MCP server over stdio (used by Claude Code)
  npx drymem hook <event>         Run a session hook (used by Claude Code)
`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function when(value: string | null): string {
  return value ? value.slice(0, 16).replace("T", " ") : "?";
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(USAGE);
    return 0;
  }

  if (command === "setup") {
    return runSetup({ global: rest.includes("--global") });
  }

  if (command === "ui") {
    const { runUi } = await import("./ui/index.js");
    await runUi();
    return 0;
  }

  if (command === "mcp") {
    const { runMcp } = await import("./mcp.js");
    await runMcp();
    return 0;
  }

  if (command === "hook") {
    const name = rest[0] as HookName | undefined;
    const handler = name ? HOOKS[name] : undefined;
    if (!handler) {
      // Exit 0 regardless: a hook must never break the session it runs in.
      console.error(`drymem: unknown hook ${name ?? "(none)"}`);
      return 0;
    }
    try {
      await handler(await readPayload());
    } catch (error) {
      console.error(`drymem: hook ${name} failed (${error})`);
    }
    return 0;
  }

  // `skills` works offline: the skills ship in this package, so a developer can
  // install them before they have a server or a token.
  const needsServer = command !== "skills";
  const client = needsServer ? new DrymemClient(requireConfig()) : (null as never);
  const projectKey = needsServer ? resolveProjectKey(process.cwd()) : "";

  switch (command) {
    case "whoami": {
      const config = requireConfig();
      console.log(`project: ${projectKey}`);
      console.log(`server:  ${config.serverUrl}`);
      const health = await client.health();
      console.log(`health:  ${health.status} (postgres ${health.postgres}, neo4j ${health.neo4j})`);
      return 0;
    }

    case "save": {
      const summary = rest.join(" ").trim();
      if (!summary) fail("Nothing to save. Pass the summary as an argument.");
      const result = await client.save({ project_key: projectKey, summary });
      console.log(`Saved ${result.episode_uuid} to ${result.project_key}`);
      if (result.scrubbed) console.log(`  ${result.scrubbed}`);
      if (result.degraded) console.log(`  WARNING: extraction failed (${result.degraded})`);
      return 0;
    }

    case "search": {
      const query = rest.join(" ").trim();
      if (!query) fail("Nothing to search for.");
      const facts = await client.search(projectKey, query);
      if (facts.length === 0) {
        console.log("No memories found.");
        return 0;
      }
      for (const fact of facts) {
        const stale = fact.superseded ? " [superseded]" : "";
        console.log(`- (${fact.name}) ${fact.fact}  (${when(fact.created_at)})${stale}`);
      }
      return 0;
    }

    case "context": {
      const limit = Number(rest[0] ?? 10);
      const episodes = await client.context(projectKey, Number.isFinite(limit) ? limit : 10);
      if (episodes.length === 0) {
        console.log("No recent context.");
        return 0;
      }
      for (const episode of episodes) {
        const who = episode.author ? ` · ${episode.author}` : "";
        console.log(`### ${episode.name} (${when(episode.created_at)}${who})`);
        console.log(`${episode.content.slice(0, 300)}\n`);
      }
      return 0;
    }

    case "skills": {
      const {
        SKILLS_DIR,
        availableSkills,
        bundledSkillsDir,
        statusOf,
        sync: syncSkills,
      } = await import("./skills.js");
      const sub = rest[0] ?? "status";
      const version = VERSION;

      if (sub === "list") {
        const bundled = bundledSkillsDir();
        const names = availableSkills(bundled);
        if (names.length === 0) fail("No bundled skills found.");
        const states = new Map(statusOf(process.cwd(), version, bundled).map((s) => [s.name, s.state]));
        for (const name of names) console.log(`  ${name.padEnd(28)} ${states.get(name) ?? "missing"}`);
        return 0;
      }

      if (sub === "status") {
        const statuses = statusOf(process.cwd(), version);
        if (statuses.length === 0) {
          console.log("No skills installed. Run `drymem skills sync`.");
          return 0;
        }
        for (const s of statuses) console.log(`  ${s.name.padEnd(28)} ${s.state}`);
        console.log(`\n  ${SKILLS_DIR} · modified and unknown skills are never overwritten`);
        return 0;
      }

      if (sub === "sync") {
        const result = syncSkills(process.cwd(), version, {
          force: rest.includes("--force"),
          dryRun: rest.includes("--dry-run"),
        });
        const say = (label: string, names: string[]) => {
          if (names.length > 0) console.log(`  ${label}: ${names.join(", ")}`);
        };
        say("installed", result.installed);
        say("updated", result.updated);
        say("already current", result.untouched);
        if (result.skipped.length > 0) {
          console.log(`  skipped (edited locally): ${result.skipped.join(", ")}`);
          console.log("  Run with --force to replace them with ours.");
        }
        if (result.installed.length + result.updated.length === 0 && result.skipped.length === 0) {
          console.log("  Everything is current.");
        }
        return 0;
      }

      fail(`Unknown skills command: ${sub}. Try list, status or sync.`);
      return 1;
    }

    case "import": {
      const { SOURCES, collect, newOnly } = await import("./import.js");
      const source = rest[0] as Source | undefined;
      if (!source || !SOURCES.includes(source)) {
        fail(`Which source? One of: ${SOURCES.join(", ")}`);
      }
      const dryRun = rest.includes("--dry-run");

      const items = collect(source, process.cwd(), rest.includes("--all-projects"));
      if (items.length === 0) {
        console.log(`Nothing to import from ${source}.`);
        return 0;
      }

      // Ask what is already there rather than tracking state locally: the
      // server is the only thing that knows, and a lock file would drift.
      const existing = new Set(await client.topicKeys(projectKey));
      const pending = newOnly(items, existing);

      console.log(`${source}: ${items.length} found, ${pending.length} new`);
      if (pending.length === 0) return 0;

      if (dryRun) {
        for (const item of pending) console.log(`  would import ${item.topicKey}`);
        return 0;
      }

      let saved = 0;
      for (const item of pending) {
        try {
          const result = await client.save({
            project_key: projectKey,
            summary: item.summary,
            topic_key: item.topicKey,
            tool: `import:${item.source}`,
          });
          saved += 1;
          const notes = [result.scrubbed, result.degraded && "extraction degraded"]
            .filter(Boolean)
            .join("; ");
          console.log(`  ${saved}/${pending.length} ${item.topicKey}${notes ? ` (${notes})` : ""}`);
        } catch (error) {
          // One bad item must not abandon the rest of a long backfill.
          console.error(`  skipped ${item.topicKey}: ${error instanceof Error ? error.message : error}`);
        }
      }
      console.log(`\nImported ${saved} memory(ies). They are private until you promote them.`);
      return 0;
    }

    case "promote": {
      const id = rest[0];
      if (!id) fail("Which memory? Pass its episode id.");
      const result = await client.promote(id);
      console.log(`Promoted ${id} — scope is now ${result.scope}`);
      console.log("Your private copy is untouched; the team now has one too.");
      return 0;
    }

    case "delete": {
      const id = rest[0];
      if (!id) fail("Which episode? Pass its id.");
      await client.delete(id);
      console.log(`Deleted ${id}`);
      return 0;
    }

    case "projects": {
      const projects = await client.projects();
      if (projects.length === 0) {
        console.log("No projects yet. Save a memory to create one.");
        return 0;
      }
      for (const project of projects) {
        console.log(`${project.project_key}  (${project.memory_count} memories)`);
      }
      return 0;
    }

    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(USAGE);
      return 1;
  }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    if (error instanceof DrymemError) fail(error.message);
    fail(String(error instanceof Error ? error.message : error));
  });
