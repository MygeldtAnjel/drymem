/**
 * Installing a skill for whichever agent is on this machine.
 *
 * A skill is platform-neutral — a folder with a `SKILL.md` — and every coding
 * agent wants it somewhere slightly different. That difference is all this file
 * is: a name, a directory, and how to write the thing once it is there.
 *
 * Two rules hold across every adapter.
 *
 * **We are a guest in these directories.** Nothing here ever touches a folder
 * drymem did not write. Each installed skill carries a marker file, and only
 * skills with one are ever replaced or removed — so a skill someone wrote by
 * hand, in the same directory, is never harmed by a `pull`.
 *
 * **Nothing is written that was not asked for.** An agent that is not installed
 * on this machine gets no directory created for it, unless it is named
 * explicitly.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The file that says "drymem put this here, and may take it away again". */
export const MARKER = ".drymem-managed";

export interface Platform {
  id: string;
  label: string;
  /** Where skills live, relative to the repository root. */
  dir: string;
  /**
   * Whether this agent looks configured in this repo or on this machine.
   * `pull` with no flags installs for the ones that are.
   */
  detect: (root: string, home: string) => boolean;
  /** How a skill is laid down. Most write the folder; Cursor writes a rule. */
  write?: (root: string, name: string, content: string, files: Record<string, string>) => void;
}

const hasAny = (...paths: string[]) => paths.some((p) => existsSync(p));

export const PLATFORMS: Platform[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    dir: join(".claude", "skills"),
    detect: (root, home) =>
      hasAny(join(root, ".claude"), join(root, ".mcp.json"), join(home, ".claude")),
  },
  {
    id: "opencode",
    label: "OpenCode",
    dir: join(".opencode", "skill"),
    detect: (root, home) =>
      hasAny(join(root, ".opencode"), join(home, ".config", "opencode"), join(home, ".opencode")),
  },
  {
    id: "codex",
    label: "Codex",
    dir: join(".codex", "skills"),
    detect: (root, home) => hasAny(join(root, ".codex"), join(home, ".codex")),
  },
  {
    id: "cursor",
    label: "Cursor",
    // Cursor reads rules, not skills, so the same content lands as one `.mdc`
    // file per skill rather than a folder.
    dir: join(".cursor", "rules"),
    detect: (root, home) => hasAny(join(root, ".cursor"), join(home, ".cursor")),
    write: (root, name, content, _files) => {
      const dir = join(root, ".cursor", "rules");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${name}.drymem.mdc`), content);
    },
  },
];

export function platformById(id: string): Platform | undefined {
  return PLATFORMS.find((p) => p.id === id);
}

/** The agents this machine actually has. */
export function detected(root: string, home: string): Platform[] {
  return PLATFORMS.filter((p) => p.detect(root, home));
}

function writeFolder(
  root: string,
  platform: Platform,
  name: string,
  content: string,
  files: Record<string, string>,
): void {
  const dir = join(root, platform.dir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), content);
  writeFileSync(join(dir, MARKER), "Written by drymem. Edit the skill in drymem, not here.\n");
  for (const [path, body] of Object.entries(files)) {
    // Nothing may escape the skill's own folder.
    const safe = path.replace(/^[/\\]+/, "").replace(/\.\.[/\\]/g, "");
    if (!safe) continue;
    const target = join(dir, safe);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, body);
  }
}

export function install(
  root: string,
  platform: Platform,
  name: string,
  content: string,
  files: Record<string, string> = {},
): void {
  if (platform.write) platform.write(root, name, content, files);
  else writeFolder(root, platform, name, content, files);
}

/** The skills drymem put here, by name. Anything unmarked is somebody else's. */
export function managed(root: string, platform: Platform): string[] {
  const base = join(root, platform.dir);
  if (!existsSync(base)) return [];

  if (platform.write) {
    return readdirSync(base)
      .filter((f) => f.endsWith(".drymem.mdc"))
      .map((f) => f.replace(/\.drymem\.mdc$/, ""));
  }
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(base, entry.name, MARKER)))
    .map((entry) => entry.name);
}

/** Remove a skill drymem installed. Refuses anything it did not. */
export function uninstall(root: string, platform: Platform, name: string): boolean {
  if (platform.write) {
    const file = join(root, platform.dir, `${name}.drymem.mdc`);
    if (!existsSync(file)) return false;
    rmSync(file);
    return true;
  }
  const dir = join(root, platform.dir, name);
  if (!existsSync(join(dir, MARKER))) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

/** What is on disk now, so `pull` can skip what already matches. */
export function readInstalled(root: string, platform: Platform, name: string): string | null {
  try {
    if (platform.write) {
      return readFileSync(join(root, platform.dir, `${name}.drymem.mdc`), "utf8");
    }
    return readFileSync(join(root, platform.dir, name, "SKILL.md"), "utf8");
  } catch {
    return null;
  }
}
