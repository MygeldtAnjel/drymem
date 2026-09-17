/**
 * `.drymem/skills.lock` — the enabled set, cached on disk.
 *
 * Not committed. The server decides which skills a project uses, because that
 * is what the web UI edits; a copy in git is a second source of truth that is
 * wrong the moment an admin clicks Add, and that rewrites itself in everyone's
 * working tree at their next session. What the cache is for is the offline
 * case: an agent starting with no network can still say what it is missing.
 *
 * The server is the source of truth; this is a generated cache with hashes. It
 * exists for three reasons: the project's skills are visible in git history,
 * `git pull` is what tells a teammate something changed, and a machine with no
 * network can still install exactly what the repo says.
 *
 * Written with a trailing newline and sorted keys so it diffs cleanly. A
 * lockfile that churns on every write is one people stop reading.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const LOCK_PATH = join(".drymem", "skills.lock");

export interface LockSkill {
  name: string;
  version: number;
  sha256: string;
  source: string;
  origin?: string;
}

export interface Lockfile {
  lockfileVersion: number;
  project: string;
  generatedAt: string;
  skills: LockSkill[];
}

export function readLockfile(root: string): Lockfile | null {
  try {
    const parsed = JSON.parse(readFileSync(join(root, LOCK_PATH), "utf8")) as Lockfile;
    return Array.isArray(parsed.skills) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeLockfile(root: string, lock: Lockfile): string {
  const path = join(root, LOCK_PATH);
  mkdirSync(dirname(path), { recursive: true });
  const ordered: Lockfile = {
    ...lock,
    skills: [...lock.skills].sort((a, b) => a.name.localeCompare(b.name)),
  };
  writeFileSync(path, `${JSON.stringify(ordered, null, 2)}\n`);
  return path;
}
