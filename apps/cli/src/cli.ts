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
import { runLogin } from "./login.js";
import { runSetup } from "./setup.js";


const USAGE = `drymem — shared long-term memory for AI coding agents

Usage
  npx drymem login [--server URL] Sign in through the browser; stores a token for this machine
  npx drymem setup [--global]     Configure this repo (signs in if needed, installs hooks + MCP)
  npx drymem save <summary>       Save a memory for the current project
  npx drymem save-session [--shared] [--type <kind>]
                                  Save deliberately, from a file or stdin
  npx drymem ask "<question>"     A grounded answer from this project's memory
  npx drymem search <query>       Search this project's memory
  npx drymem context [n]          Show the most recent memories
  npx drymem skills <cmd>         list | catalogue | add | remove | pull | publish
                                  | import owner/repo@skill | status
                                  | discover | distill <topic>
  npx drymem import <source>      Backfill memories the team already wrote down
                                  (claude-memory, git, docs, ecc, engram; --dry-run to preview)
  npx drymem promote <episode-id> Share a memory with the project's members
  npx drymem delete <episode-id>  Remove a memory
  npx drymem projects             List the projects you can see
  npx drymem ui                   Browse, search and rate memories in a terminal UI
  npx drymem whoami               Show the resolved project and server
  npx drymem token                Print this machine's token (for the web UI)
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

  if (command === "login") {
    const at = rest.indexOf("--server");
    return runLogin({ serverUrl: at >= 0 ? rest[at + 1] : undefined });
  }

  if (command === "setup") {
    const at = rest.indexOf("--server");
    return runSetup({
      global: rest.includes("--global"),
      serverUrl: at >= 0 ? rest[at + 1] : undefined,
    });
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

  // The catalogue lives on the server now, so every command needs one — except
  // `skills pull`, which falls back to the committed lockfile when it cannot
  // reach it. That fallback is inside `pull`, which needs a client object to
  // try with, so the config is still required here.
  const client = new DrymemClient(requireConfig());
  const projectKey = resolveProjectKey(process.cwd());

  switch (command) {
    case "token": {
      // The web UI needs the token this machine is already using. Without this
      // the only advice was `token-create`, which mints a *new* one — the
      // wrong answer to "how do I sign in?".
      console.log(requireConfig().token);
      return 0;
    }

    case "whoami": {
      const config = requireConfig();
      console.log(`project: ${projectKey}`);
      console.log(`server:  ${config.serverUrl}`);
      const health = await client.health();
      console.log(`health:  ${health.status} (postgres ${health.postgres}, neo4j ${health.neo4j})`);
      return 0;
    }

    case "ask": {
      const question = rest.join(" ").trim();
      if (!question) fail('Ask something: drymem ask "who changed the payments retry?"');
      const result = await client.ask(projectKey, question);
      console.log();
      console.log(result.answer);
      if (result.sources.length > 0) {
        console.log();
        for (const source of result.sources) {
          console.log(
            `  [${source.index}] ${source.type.padEnd(12)} ${source.title}` +
              `  · ${source.author} · ${when(source.created_at)}`,
          );
        }
      }
      // Saying which model wrote it matters: a local 35B and Opus are not the
      // same claim, and the reader should know which one they are trusting.
      if (result.grounded) console.log(`\n  — written by ${result.model} from those memories`);
      return 0;
    }

    /**
     * A deliberate save, from the terminal.
     *
     * The point of the command is that the *person* decides. Everything else
     * about memory is the agent's initiative; this is the one that is not.
     * Content comes from a file, from stdin, or from the remaining arguments —
     * a session summary is usually longer than a comfortable argument.
     */
    case "save-session": {
      const shared = rest.includes("--shared");
      const typeAt = rest.indexOf("--type");
      const type = typeAt >= 0 ? rest[typeAt + 1] : undefined;
      const fileAt = rest.indexOf("--file");
      const file = fileAt >= 0 ? rest[fileAt + 1] : undefined;

      const words = rest.filter(
        (arg, i) =>
          !arg.startsWith("--") &&
          i !== typeAt + 1 &&
          i !== fileAt + 1,
      );

      let summary = words.join(" ").trim();
      if (file) {
        const { readFileSync } = await import("node:fs");
        summary = readFileSync(file, "utf8");
      } else if (!summary && !process.stdin.isTTY) {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
        summary = Buffer.concat(chunks).toString("utf8");
      }
      if (!summary.trim()) {
        fail(
          "Nothing to save. Pass the summary, --file <path>, or pipe it in:\n" +
            '  drymem save-session --type decision "## Summary\n…"',
        );
      }

      const saved = await client.save({
        project_key: projectKey,
        summary,
        type: type ?? "note",
        topic_key: "",
      });
      console.log(`Saved '${saved.name}' (${saved.entity_count} entities)`);
      if (saved.scrubbed) console.log(`  ${saved.scrubbed}`);
      if (saved.degraded) console.log(`  WARNING: extraction failed (${saved.degraded})`);

      if (shared) {
        await client.promote(saved.episode_uuid);
        console.log("  shared with the project");
      } else {
        console.log("  private to you — share it from the web UI or with `drymem promote`");
      }
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

    /**
     * The catalogue, from a terminal.
     *
     * `add` and `remove` are the lead's; `pull` is everyone's and runs from the
     * session hook. `list`, `catalogue` and `usage` are for looking.
     */
    case "skills": {
      const {
        pull: pullSkills,
        describePull,
        chosenPlatforms,
      } = await import("./catalogue.js");
      const { readLockfile } = await import("./lockfile.js");
      const sub = rest[0] ?? "list";
      const root = process.cwd();

      if (sub === "list") {
        const skills = await client.enabledSkills(projectKey);
        if (skills.length === 0) {
          console.log("Nothing enabled here yet.");
          console.log("  See what the team has:   npx drymem skills catalogue");
          return 0;
        }
        for (const skill of skills) {
          const flags = [
            skill.outdated ? `v${skill.version} (v${skill.latest_version} available)` : `v${skill.version}`,
            skill.state === "deprecated" ? "DEPRECATED" : "",
            skill.uses > 0 ? `${skill.uses} uses` : "never used",
          ].filter(Boolean);
          console.log(`  ${skill.name.padEnd(28)} ${flags.join(" · ")}`);
        }
        return 0;
      }

      if (sub === "catalogue" || sub === "available") {
        const skills = await client.catalogue(projectKey);
        if (skills.length === 0) {
          console.log("The catalogue is empty. Distil one from your memories:");
          console.log('  npx drymem skills distill "payments"');
          return 0;
        }
        for (const skill of skills) {
          const mark = skill.enabled_here ? "*" : " ";
          const note = [skill.source, skill.state === "published" ? "" : skill.state]
            .filter(Boolean)
            .join(" · ");
          console.log(`${mark} ${skill.name.padEnd(28)} ${note}`);
        }
        console.log("\n  * already enabled here.  Add one: npx drymem skills add <name>");
        return 0;
      }

      if (sub === "add") {
        const spec = rest[1];
        if (!spec) fail("Which skill? npx drymem skills add <name>[@version]");
        const [name, at] = spec.split("@");
        const enabled = await client.enableSkill(
          name!,
          projectKey,
          at ? Number(at) : undefined,
        );
        console.log(`Enabled ${enabled.name}@${enabled.version} for this project.`);
        const after = await pullSkills(client, projectKey, root, rest);
        for (const line of describePull(after.results)) console.log(line);
        console.log(`\n  Commit .drymem/skills.lock so your team gets it on \`git pull\`.`);
        return 0;
      }

      if (sub === "remove") {
        const name = rest[1];
        if (!name) fail("Which skill? npx drymem skills remove <name>");
        await client.disableSkill(name, projectKey);
        console.log(`Disabled ${name} for this project.`);
        const after = await pullSkills(client, projectKey, root, rest);
        for (const line of describePull(after.results)) console.log(line);
        console.log(`\n  Commit .drymem/skills.lock.`);
        return 0;
      }

      if (sub === "pull" || sub === "sync") {
        const result = await pullSkills(client, projectKey, root, rest);
        if (result.offline) {
          const lock = result.lock;
          console.log(
            lock
              ? `Could not reach the server. ${lock.skills.length} skill(s) in the lockfile stay as they are.`
              : "Could not reach the server, and there is no lockfile to fall back on.",
          );
          return lock ? 0 : 1;
        }
        const lines = describePull(result.results);
        if (lines.length === 0) {
          const names = chosenPlatforms(rest, root);
          console.log(
            names.length === 0
              ? "No coding agent found here. Name one: --claude-code, --opencode, --cursor, --codex."
              : "Nothing to do.",
          );
          return 0;
        }
        for (const line of lines) console.log(line);
        return 0;
      }

      if (sub === "publish") {
        const { readFileSync, existsSync, readdirSync, statSync } = await import("node:fs");
        const { join, basename } = await import("node:path");
        const path = rest[1];
        if (!path) fail("Which folder or file? npx drymem skills publish ./my-skill");

        // A folder with a SKILL.md, or the SKILL.md itself.
        const isDir = existsSync(path) && statSync(path).isDirectory();
        const mdPath = isDir ? join(path, "SKILL.md") : path;
        if (!existsSync(mdPath)) fail(`No SKILL.md at ${mdPath}`);

        const content = readFileSync(mdPath, "utf8");
        const files: Record<string, string> = {};
        if (isDir) {
          for (const entry of readdirSync(path, { withFileTypes: true })) {
            if (entry.isFile() && entry.name !== "SKILL.md" && !entry.name.startsWith(".")) {
              files[entry.name] = readFileSync(join(path, entry.name), "utf8");
            }
          }
        }
        const name = rest.includes("--name")
          ? rest[rest.indexOf("--name") + 1]!
          : isDir
            ? basename(path)
            : basename(path, ".md");

        const published = await client.publishSkillVersion({
          name,
          content,
          files,
          source: "authored",
          project_key: rest.includes("--enable") ? projectKey : undefined,
        });
        if (published.unchanged) {
          console.log(`${published.name} is already at v${published.version}; nothing changed.`);
          return 0;
        }
        console.log(`Published ${published.name}@${published.version} (${published.state}).`);
        for (const finding of published.findings) {
          console.log(`  ${finding.severity}: ${finding.rule} — ${finding.detail}`);
        }
        if (published.detail) console.log(`\n  ${published.detail}`);
        return 0;
      }

      if (sub === "import") {
        const { parseSpec, originOf, fetchSkill } = await import("./registry.js");
        const raw = rest[1];
        if (!raw) fail("Which skill? npx drymem skills import owner/repo@skill-name");

        const spec = parseSpec(raw);
        console.log(`Fetching ${originOf(spec)}…`);
        const fetched = await fetchSkill(spec);

        const published = await client.publishSkillVersion({
          name: rest.includes("--name") ? rest[rest.indexOf("--name") + 1]! : fetched.name,
          content: fetched.content,
          files: fetched.files,
          source: "imported",
          origin: originOf(spec),
          project_key: rest.includes("--enable") ? projectKey : undefined,
        });

        if (published.unchanged) {
          console.log(`${published.name} is already at v${published.version}; nothing changed.`);
          return 0;
        }
        console.log(`Imported ${published.name}@${published.version} via ${fetched.via} (${published.state}).`);
        for (const finding of published.findings) {
          console.log(`  ${finding.severity}: ${finding.rule} — ${finding.detail}`);
        }
        if (published.detail) console.log(`\n  ${published.detail}`);
        else if (!rest.includes("--enable")) {
          console.log(`\n  Read it, then:  npx drymem skills add ${published.name}`);
        }
        return 0;
      }

      if (sub === "status") {
        const lock = readLockfile(root);
        const platforms = chosenPlatforms(rest, root);
        console.log(`  project: ${projectKey}`);
        console.log(
          `  agents:  ${platforms.length > 0 ? platforms.map((p) => p.label).join(", ") : "none detected"}`,
        );
        console.log(
          lock
            ? `  lockfile: ${lock.skills.length} skill(s), generated ${when(lock.generatedAt)}`
            : "  lockfile: none yet — run `npx drymem skills pull`",
        );
        return 0;
      }

      if (sub === "discover") {
        const { gaps } = await import("./skills.js");
        const clusters = await client.discover(projectKey, Number(rest[1] ?? 2));
        if (clusters.length === 0) {
          console.log("Nothing recurs yet. Discover needs memories to work from.");
          return 0;
        }
        const missing = gaps(clusters, root);
        console.log(`  ${clusters.length} recurring subject(s), ${missing.length} with no skill:\n`);
        for (const c of missing) {
          console.log(`  ${String(c.memory_count).padStart(3)} memories  ${c.topic}`);
        }
        if (missing.length > 0) {
          console.log(`\n  Draft one:  npx drymem skills distill "${missing[0]?.topic}"`);
        }
        return 0;
      }

      if (sub === "distill") {
        const { writeDraft } = await import("./skills.js");
        const topic = rest.slice(1).filter((a) => !a.startsWith("--")).join(" ").trim();
        if (!topic) fail('Which subject? e.g. npx drymem skills distill "payments"');

        console.log(`Drafting a skill for "${topic}"…`);
        const draft = await client.distill(projectKey, topic);
        const path = writeDraft(root, draft.name, draft.content);

        console.log(`\n  Drafted from ${draft.memory_count} memories using ${draft.model}`);
        console.log(`  ${path}`);
        console.log(`\n  A draft, not a published skill. Read it, edit it, then:`);
        console.log(`    npx drymem skills publish ${path.replace(/\/SKILL\.md$/, "")} --enable`);
        return 0;
      }

      fail(
        `Unknown skills command: ${sub}.\n` +
          "  list · catalogue · add · remove · pull · publish · import · status · discover · distill",
      );
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
