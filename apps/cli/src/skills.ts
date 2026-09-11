/**
 * `drymem skills` — install the team's skill set into a project.
 *
 * The skills ship inside this npm package, so sync needs no network and no
 * server. What it writes is `.claude/skills/<name>/`, committed with the code,
 * plus a lock file recording exactly which version and content hash landed.
 *
 * The rule everything else follows from: **`.claude/skills/` belongs to the
 * team, and we are a guest in it.** A skill someone edited is never overwritten,
 * and a skill they wrote themselves is never touched at all. Silently reverting
 * someone's work is how a tool loses trust in a single command.
 */

import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const LOCK_PATH = join(".drymem", "skills.lock");
export const SKILLS_DIR = join(".claude", "skills");
const LOCK_VERSION = 1;

export interface LockEntry {
  version: string;
  hash: string;
}

export interface Lock {
  version: number;
  skills: Record<string, LockEntry>;
}

export type SkillState = "installed" | "modified" | "missing" | "outdated" | "unknown";

export interface SkillStatus {
  name: string;
  state: SkillState;
  hash?: string;
}

/**
 * Where the bundled skills live.
 *
 * `packages/skills` in the monorepo, `skills/` inside the published package.
 * Checked in order rather than assumed, because getting it wrong shows up as
 * "no skills available" rather than as an error.
 */
export function bundledSkillsDir(from = fileURLToPath(import.meta.url)): string | null {
  const candidates = [
    join(dirname(from), "..", "skills", "general"),
    join(dirname(from), "..", "..", "..", "packages", "skills", "general"),
    join(dirname(from), "..", "..", "packages", "skills", "general"),
  ];
  return candidates.find((path) => existsSync(path)) ?? null;
}

function filesOf(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesOf(path));
    else if (entry.isFile()) out.push(path);
  }
  return out.sort();
}

/**
 * A content hash over a skill directory.
 *
 * Paths are included, not just contents, so adding or renaming a file changes
 * the hash. Sorted, so the result does not depend on directory order.
 */
export function hashSkill(dir: string): string {
  const digest = createHash("sha256");
  for (const file of filesOf(dir)) {
    digest.update(relative(dir, file));
    digest.update("\0");
    digest.update(readFileSync(file));
    digest.update("\0");
  }
  return `sha256:${digest.digest("hex")}`;
}

export function availableSkills(bundled: string | null = bundledSkillsDir()): string[] {
  if (!bundled || !existsSync(bundled)) return [];
  return readdirSync(bundled, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(bundled, e.name, "SKILL.md")))
    .map((e) => e.name)
    .sort();
}

export function readLock(project: string): Lock {
  try {
    const lock = JSON.parse(readFileSync(join(project, LOCK_PATH), "utf8")) as Lock;
    if (typeof lock.skills === "object" && lock.skills !== null) return lock;
  } catch {
    /* no lock yet, or an unreadable one — treat as empty */
  }
  return { version: LOCK_VERSION, skills: {} };
}

export function writeLock(project: string, lock: Lock): void {
  const path = join(project, LOCK_PATH);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`);
}

/**
 * What is on disk, compared with the lock and with what we ship.
 *
 *   installed  matches the lock and the bundle
 *   outdated   matches the lock, but we ship something newer
 *   modified   on disk, in the lock, and changed since — leave it alone
 *   missing    in the lock, not on disk
 *   unknown    on disk, not in the lock — the team's own, not ours to manage
 */
export function statusOf(
  project: string,
  version: string,
  bundled: string | null = bundledSkillsDir(),
): SkillStatus[] {
  const lock = readLock(project);
  const installedDir = join(project, SKILLS_DIR);
  const available = availableSkills(bundled);

  const onDisk = existsSync(installedDir)
    ? readdirSync(installedDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    : [];

  const names = [...new Set([...available, ...onDisk, ...Object.keys(lock.skills)])].sort();
  const out: SkillStatus[] = [];

  for (const name of names) {
    const dir = join(installedDir, name);
    const entry = lock.skills[name];
    const present = existsSync(dir) && statSync(dir).isDirectory();

    if (!entry) {
      // Not ours. Either the team wrote it, or we have never installed it.
      if (present) out.push({ name, state: "unknown" });
      else out.push({ name, state: "missing" });
      continue;
    }
    if (!present) {
      out.push({ name, state: "missing" });
      continue;
    }

    const actual = hashSkill(dir);
    if (actual !== entry.hash) {
      out.push({ name, state: "modified", hash: actual });
      continue;
    }
    const bundledHash = bundled ? hashSkill(join(bundled, name)) : entry.hash;
    out.push({ name, state: bundledHash === entry.hash ? "installed" : "outdated", hash: actual });
  }
  return out;
}

export interface SyncResult {
  installed: string[];
  updated: string[];
  skipped: string[];
  untouched: string[];
}

/**
 * Install or update the skill set.
 *
 * `force` overwrites a modified skill; without it, a modified skill is skipped
 * and reported. A skill the team wrote (`unknown`) is never written to, with or
 * without force — force means "give me your version of *your* skill back", not
 * "throw away mine".
 */
export function sync(
  project: string,
  version: string,
  options: { force?: boolean; dryRun?: boolean; bundled?: string | null } = {},
): SyncResult {
  const bundled = options.bundled === undefined ? bundledSkillsDir() : options.bundled;
  const result: SyncResult = { installed: [], updated: [], skipped: [], untouched: [] };
  if (!bundled) return result;

  const lock = readLock(project);
  const statuses = new Map(statusOf(project, version, bundled).map((s) => [s.name, s]));

  for (const name of availableSkills(bundled)) {
    const state = statuses.get(name)?.state ?? "missing";

    if (state === "unknown") {
      result.untouched.push(name);
      continue;
    }
    if (state === "modified" && !options.force) {
      result.skipped.push(name);
      continue;
    }
    if (state === "installed") {
      result.untouched.push(name);
      continue;
    }

    const target = join(project, SKILLS_DIR, name);
    if (!options.dryRun) {
      rmSync(target, { recursive: true, force: true });
      mkdirSync(dirname(target), { recursive: true });
      cpSync(join(bundled, name), target, { recursive: true });
      lock.skills[name] = { version, hash: hashSkill(target) };
    }
    (state === "missing" ? result.installed : result.updated).push(name);
  }

  // Report the team's own skills explicitly. They are left alone either way,
  // but "we did not touch yours" is the reassurance worth printing.
  for (const status of statuses.values()) {
    if (status.state === "unknown" && !result.untouched.includes(status.name)) {
      result.untouched.push(status.name);
    }
  }
  result.untouched.sort();

  if (!options.dryRun) writeLock(project, { version: LOCK_VERSION, skills: lock.skills });
  return result;
}
