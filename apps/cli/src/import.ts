/**
 * `drymem import` — give a new project a memory before anyone has used it.
 *
 * The cold-start problem is drymem's biggest adoption risk: for the first month
 * the graph is empty, so it pays back nothing and people stop bothering. Import
 * fixes that by reading what the team has *already written down*.
 *
 * **Transcripts are deliberately not a source.** Turning a raw session log into
 * a memory needs a model to summarise it, and two of our own decisions say no:
 * the summary is written by the agent inside the session, and drymem
 * stores summaries only, never transcripts. Every source here is something
 * a human wrote on purpose — a memory file, a commit body, another tool's
 * memory store — so nothing is inferred and nothing is surveilled.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export interface Importable {
  /** Stable across runs, so a second import updates nothing rather than duplicating. */
  topicKey: string;
  summary: string;
  source: string;
}

export const SOURCES = ["claude-memory", "git", "ecc", "engram", "docs"] as const;
export type Source = (typeof SOURCES)[number];

const MIN_BODY = 40;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function readMarkdownDir(dir: string, source: string, prefix: string): Importable[] {
  if (!existsSync(dir)) return [];
  const out: Importable[] = [];

  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md")) continue;
    const path = join(dir, name);
    if (!statSync(path).isFile()) continue;

    const body = readFileSync(path, "utf8").trim();
    // An index file is a list of pointers, not a memory.
    if (body.length < MIN_BODY || /^#?\s*(memory|index)\.md$/i.test(name)) continue;

    out.push({
      topicKey: `${prefix}/${slugify(basename(name, ".md"))}`,
      summary: body,
      source,
    });
  }
  return out;
}

/** Claude Code names a project's directory after its path, with slashes as dashes. */
export function claudeProjectSlug(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

/**
 * Claude Code's own per-project memory files.
 *
 * The best source available: each file is a single fact someone chose to write
 * down, with frontmatter saying what kind it is. No interpretation needed.
 *
 * Scoped to **this** project by default. Every project on the machine has a
 * memory directory, and hoovering them all into whichever repo you happen to be
 * standing in would import another codebase's decisions as if they were this
 * one's — the precise noise drymem exists to avoid. `allProjects` is there for
 * a deliberate consolidation, not as the default.
 */
export function fromClaudeMemory(cwd: string, allProjects = false): Importable[] {
  const root = join(homedir(), ".claude", "projects");
  if (!existsSync(root)) return [];

  const dirs = allProjects
    ? readdirSync(root).map((d) => join(root, d, "memory"))
    : [join(root, claudeProjectSlug(cwd), "memory")];

  return dirs.flatMap((dir) => readMarkdownDir(dir, "claude-memory", "import/claude-memory"));
}

/**
 * Git commits that carry a body.
 *
 * A subject line is a label, not a memory — "fix: update model" tells a future
 * reader nothing. Only commits whose body explains something are worth storing,
 * which on a repo with a one-line-commit convention is correctly almost none.
 */
export function fromGit(repo: string, limit = 500): Importable[] {
  let raw: string;
  try {
    raw = execFileSync(
      "git",
      ["-C", repo, "log", `-${limit}`, "--no-merges", "--format=%H%x1f%s%x1f%b%x1e"],
      { encoding: "utf8", timeout: 20000, maxBuffer: 32 * 1024 * 1024 },
    );
  } catch {
    return [];
  }

  const out: Importable[] = [];
  for (const record of raw.split("\x1e")) {
    const [sha, subject, body] = record.trim().split("\x1f");
    if (!sha || !subject) continue;

    const explanation = (body ?? "").trim();
    if (explanation.length < MIN_BODY) continue;

    out.push({
      topicKey: `import/git/${sha.slice(0, 12)}`,
      summary: `## ${subject}\n\n${explanation}\n\n_Imported from commit ${sha.slice(0, 12)}._`,
      source: "git",
    });
  }
  return out;
}

/** Decision records and specs — documents written to be read later, which is what a memory is. */
export function fromDocs(repo: string): Importable[] {
  const out: Importable[] = [];
  for (const dir of ["docs/adr", "docs/decisions", "docs/specs", "adr"]) {
    out.push(...readMarkdownDir(join(repo, dir), "docs", `import/docs/${slugify(dir)}`));
  }
  return out;
}

/** ECC's memory vault: portable markdown, one file per memory. */
export function fromEcc(repo: string): Importable[] {
  return readMarkdownDir(join(repo, ".ecc", "memory"), "ecc", "import/ecc");
}

/**
 * engram's SQLite store.
 *
 * Read through the `sqlite3` binary rather than adding a native dependency to
 * the client: this runs once, on a machine that is migrating away from engram.
 */
export function fromEngram(dbPath = join(homedir(), ".engram", "engram.db")): Importable[] {
  if (!existsSync(dbPath)) return [];
  let raw: string;
  try {
    raw = execFileSync(
      "sqlite3",
      [dbPath, "-separator", "\x1f", "SELECT id, title, content FROM observations"],
      { encoding: "utf8", timeout: 20000, maxBuffer: 32 * 1024 * 1024 },
    );
  } catch {
    // No sqlite3, or a schema we do not recognise. Not fatal — it is one source.
    return [];
  }

  const out: Importable[] = [];
  for (const line of raw.split("\n")) {
    const [id, title, content] = line.split("\x1f");
    if (!id || !content || content.trim().length < MIN_BODY) continue;
    out.push({
      topicKey: `import/engram/${slugify(id)}`,
      summary: `## ${title ?? id}\n\n${content.trim()}`,
      source: "engram",
    });
  }
  return out;
}

export function collect(source: Source, repo: string, allProjects = false): Importable[] {
  switch (source) {
    case "claude-memory":
      return fromClaudeMemory(repo, allProjects);
    case "git":
      return fromGit(repo);
    case "docs":
      return fromDocs(repo);
    case "ecc":
      return fromEcc(repo);
    case "engram":
      return fromEngram();
  }
}

/** Drop anything already imported, so a second run is a no-op. */
export function newOnly(items: Importable[], existingTopicKeys: Set<string>): Importable[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (existingTopicKeys.has(item.topicKey) || seen.has(item.topicKey)) return false;
    seen.add(item.topicKey);
    return true;
  });
}
