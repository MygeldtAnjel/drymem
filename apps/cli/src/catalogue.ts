/**
 * `drymem skills` — the commands a tech lead and a teammate each run once.
 *
 * The lead:  `drymem skills add payments-retry`, or Add on the web — either
 *            way, what changed is the server.
 * Everyone:  their next agent session → the hook runs `pull` → it is installed.
 *
 * Nothing to commit and nothing to remember: both paths a lead might take end
 * in the same place, and a teammate never has to know which one was used.
 *
 * `pull` is the one that has to be boring. It runs on every session start, on
 * machines with different agents installed, sometimes with no network — so it
 * writes only what changed, installs only for agents that are actually there,
 * and falls back to the committed lockfile when the server cannot be reached.
 */

import { homedir } from "node:os";

import type { DrymemClient } from "./client.js";
import { readLockfile, writeLockfile, type Lockfile, type LockSkill } from "./lockfile.js";
import {
  detected,
  install,
  managed,
  platformById,
  readInstalled,
  uninstall,
  PLATFORMS,
  type Platform,
} from "./platforms.js";

export interface CatalogueSkill {
  name: string;
  topic: string;
  description: string | null;
  author: string | null;
  scope: string;
  source: string;
  state: string;
  origin: string | null;
  latest_version: number;
  uses: number;
  enabled_here: boolean;
}

export interface EnabledSkill extends CatalogueSkill {
  content: string;
  files: Record<string, string>;
  version: number;
  sha256: string;
  outdated: boolean;
  findings: { rule: string; severity: string; detail: string }[];
}

/** Which agents to install for: what was asked for, or what is here. */
export function chosenPlatforms(flags: string[], root: string): Platform[] {
  if (flags.includes("--all")) return PLATFORMS;
  const named = PLATFORMS.filter((p) => flags.includes(`--${p.id}`));
  if (named.length > 0) return named;
  return detected(root, homedir());
}

export interface PullResult {
  platform: string;
  installed: string[];
  unchanged: string[];
  removed: string[];
}

/**
 * Put the enabled set on disk.
 *
 * Content already identical is left alone — rewriting it would churn file
 * mtimes on every session start for no reason — and any drymem-managed skill
 * that is no longer enabled is taken away, because a skill the team retired
 * should stop influencing anyone's agent.
 */
export function applyToDisk(
  root: string,
  platforms: Platform[],
  skills: { name: string; content: string; files?: Record<string, string> }[],
): PullResult[] {
  const wanted = new Map(skills.map((s) => [s.name, s]));

  return platforms.map((platform) => {
    const result: PullResult = {
      platform: platform.label,
      installed: [],
      unchanged: [],
      removed: [],
    };

    for (const skill of skills) {
      if (readInstalled(root, platform, skill.name) === skill.content) {
        result.unchanged.push(skill.name);
        continue;
      }
      install(root, platform, skill.name, skill.content, skill.files ?? {});
      result.installed.push(skill.name);
    }

    for (const name of managed(root, platform)) {
      if (!wanted.has(name) && uninstall(root, platform, name)) result.removed.push(name);
    }
    return result;
  });
}

export async function pull(
  client: DrymemClient | null,
  projectKey: string,
  root: string,
  flags: string[],
): Promise<{ results: PullResult[]; offline: boolean; lock: Lockfile | null }> {
  const platforms = chosenPlatforms(flags, root);

  let enabled: EnabledSkill[] | null = null;
  if (client) {
    try {
      enabled = await client.enabledSkills(projectKey);
    } catch {
      // Handled below: the committed lockfile is the offline answer.
      enabled = null;
    }
  }

  if (enabled) {
    const lock: Lockfile = {
      lockfileVersion: 1,
      project: projectKey,
      generatedAt: new Date().toISOString(),
      skills: enabled.map(
        (s): LockSkill => ({
          name: s.name,
          version: s.version,
          sha256: s.sha256,
          source: s.source,
          ...(s.origin ? { origin: s.origin } : {}),
        }),
      ),
    };
    // Only rewrite when the set actually changed, so `pull` on every session
    // start does not leave a dirty working tree.
    const existing = readLockfile(root);
    const same =
      existing &&
      JSON.stringify(existing.skills.map((s) => [s.name, s.sha256]).sort()) ===
        JSON.stringify(lock.skills.map((s) => [s.name, s.sha256]).sort());
    if (!same) writeLockfile(root, lock);

    return {
      results: applyToDisk(
        root,
        platforms,
        enabled.map((s) => ({ name: s.name, content: s.content, files: s.files })),
      ),
      offline: false,
      lock,
    };
  }

  // No server. The lockfile says what should be here, and anything already
  // installed matching those names stays — better a stale skill than none.
  const lock = readLockfile(root);
  return { results: [], offline: true, lock };
}

export function describePull(results: PullResult[]): string[] {
  const lines: string[] = [];
  for (const result of results) {
    const parts: string[] = [];
    if (result.installed.length) parts.push(`${result.installed.length} written`);
    if (result.unchanged.length) parts.push(`${result.unchanged.length} unchanged`);
    if (result.removed.length) parts.push(`${result.removed.length} removed`);
    lines.push(`  ${result.platform.padEnd(14)} ${parts.join(", ") || "nothing to do"}`);
    for (const name of result.installed) lines.push(`      + ${name}`);
    for (const name of result.removed) lines.push(`      - ${name}`);
  }
  return lines;
}

export { platformById, PLATFORMS };
