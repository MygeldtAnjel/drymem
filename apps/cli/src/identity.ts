/**
 * Who and where a memory belongs to. A port of `identity.py`.
 *
 * This runs client-side because it needs the local git remote, which the server
 * cannot see. That means two implementations of the same rules, and a drift
 * between them silently splits a team into two projects that never share a
 * memory. Both are driven by the same fixture —
 * `packages/api-types/fixtures/remotes.json` — so neither can change alone.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { hostname, userInfo } from "node:os";
import { basename, resolve } from "node:path";

/** Bumped when stored episode metadata changes shape. Mirrors identity.py. */
export const SCHEMA_VERSION = 1;

const MAX_GROUP_ID = 60;
const CREDENTIALS = /^[^/@]*@/;

function run(command: string, args: string[]): string | null {
  try {
    const out = execFileSync(command, args, {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

function git(cwd: string, ...args: string[]): string | null {
  return run("git", ["-C", cwd, ...args]);
}

const sshHostCache = new Map<string, string>();

/**
 * Resolve an SSH config alias to the hostname it actually points at.
 *
 * Anyone juggling two GitHub accounts has a `Host github-personal` block in
 * ~/.ssh/config, so their remote reads `git@github-personal:me/repo.git` while
 * a teammate's reads `git@github.com:me/repo.git`. Same repo, and it must be
 * the same project key. `ssh -G` answers this in about 2ms without connecting,
 * and is a no-op for hosts that have no config entry.
 */
export function resolveSshHost(host: string): string {
  const cached = sshHostCache.get(host);
  if (cached !== undefined) return cached;

  let resolved = host;
  const out = run("ssh", ["-G", host]);
  if (out) {
    for (const line of out.split("\n")) {
      const [key, ...rest] = line.trim().split(" ");
      if (key === "hostname" && rest.length > 0 && rest[0]) {
        resolved = rest[0].toLowerCase();
        break;
      }
    }
  }
  sshHostCache.set(host, resolved);
  return resolved;
}

/**
 * Reduce any git remote URL to `host/org/repo`.
 *
 * All of these are the same project:
 *   git@github.com:Acme/drymem.git
 *   https://github.com/acme/drymem
 *   ssh://git@github.com:22/acme/drymem.git
 *   https://user:token@github.com/acme/drymem.git
 *   git@github-personal:acme/drymem.git   (an ~/.ssh/config alias)
 */
export function normalizeRemote(url: string): string | null {
  let value = url.trim();
  if (!value) return null;

  // scp-style (git@host:org/repo) has no scheme and uses ':' as a separator
  let isSsh = !value.includes("://") && value.includes(":");
  if (isSsh) {
    const index = value.indexOf(":");
    value = `ssh://${value.slice(0, index)}/${value.slice(index + 1)}`;
  } else if (value.startsWith("ssh://")) {
    isSsh = true;
  }

  const schemeAt = value.lastIndexOf("://");
  let rest = schemeAt === -1 ? value : value.slice(schemeAt + 3);
  rest = rest.replace(CREDENTIALS, ""); // drop user:token@ / git@

  const slash = rest.indexOf("/");
  if (slash === -1) return null;

  let host = rest.slice(0, slash).split(":")[0]?.toLowerCase() ?? "";
  let path = rest.slice(slash + 1).replace(/^\/+|\/+$/g, "");
  if (path.endsWith(".git")) path = path.slice(0, -4);

  if (!host || !path) return null;
  if (isSsh) host = resolveSshHost(host);
  return `${host}/${path.toLowerCase()}`;
}

/**
 * The stable identity of the project at `cwd`.
 *
 * Falls back to a path-derived key when there is no git remote — the hash keeps
 * two same-named folders apart, and the basename keeps it readable.
 */
export function resolveProjectKey(cwd: string): string {
  const remote = git(cwd, "remote", "get-url", "origin");
  if (remote) {
    const normalized = normalizeRemote(remote);
    if (normalized) return normalized;
  }

  const root = git(cwd, "rev-parse", "--show-toplevel") ?? cwd;
  const abspath = resolve(root);
  const digest = createHash("sha1").update(abspath).digest("hex").slice(0, 8);
  return `local/${basename(abspath).toLowerCase()}-${digest}`;
}

/**
 * Convert a project key into a stable, Neo4j-safe group id.
 *
 * Changing this orphans every memory already stored, so it changes only with a
 * migration — and only in lockstep with `identity.py`.
 */
export function sanitizeGroupId(projectKey: string): string {
  let slug = projectKey
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (slug.length > MAX_GROUP_ID) {
    const suffix = createHash("sha1").update(projectKey).digest("hex").slice(0, 8);
    slug = `${slug.slice(0, MAX_GROUP_ID - 9)}-${suffix}`;
  }
  return slug;
}

export function groupIdFor(cwd: string): string {
  return sanitizeGroupId(resolveProjectKey(cwd));
}

/** Who is saving this memory. Their git identity, or a machine-local one. */
export function resolveAuthor(cwd: string): string {
  const email = git(cwd, "config", "user.email");
  if (email) return email;
  const user = process.env.USER ?? process.env.USERNAME ?? userInfo().username ?? "unknown";
  return `${user}@${hostname()}`;
}
