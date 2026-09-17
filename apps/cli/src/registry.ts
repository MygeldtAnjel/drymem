/**
 * `drymem skills import owner/repo@skill` — bringing in a public skill.
 *
 * skills.sh already has the catalogue, the installer and the adoption, so
 * this does not compete with it: it fetches, then hands the result to our own
 * publish path. That is the whole point. A skill from the internet lands in the
 * org catalogue the same way a hand-written one does — scanned, versioned,
 * attributed to whoever imported it — instead of being written straight into
 * everyone's `.claude/skills` by a command nobody reviewed.
 *
 * Fetching has two routes on purpose. Their CLI is the right one: it knows the
 * layouts and the redirects. But it needs network and `npx`, and a failure
 * there should not be the end of the story, so a direct read of the repository
 * is the fallback.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface Spec {
  owner: string;
  repo: string;
  /** The skill inside the repo. Absent when the repo holds exactly one. */
  skill?: string;
}

/** `owner/repo`, `owner/repo@skill`, or either with a `github.com/` in front. */
export function parseSpec(raw: string): Spec {
  const cleaned = raw
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^(?:www\.)?github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");

  const [path, skill] = cleaned.split("@");
  const parts = (path ?? "").split("/").filter(Boolean);
  if (parts.length !== 2) {
    throw new Error(`Not a skill reference: ${raw}. Try owner/repo@skill-name.`);
  }
  const [owner, repo] = parts as [string, string];
  return skill ? { owner, repo, skill } : { owner, repo };
}

export const originOf = (spec: Spec): string =>
  `github.com/${spec.owner}/${spec.repo}${spec.skill ? `@${spec.skill}` : ""}`;

export interface Fetched {
  name: string;
  content: string;
  files: Record<string, string>;
  /** Which route found it, so the command can say so. */
  via: "skills.sh" | "github";
}

/**
 * Read a skill out of a directory tree.
 *
 * Every installer lays them out slightly differently — `SKILL.md` at the root,
 * or one folder per skill — so look for the file rather than assume a shape.
 */
export function readSkillTree(root: string, want?: string): Fetched | null {
  const direct = join(root, "SKILL.md");
  if (existsSync(direct)) {
    return { name: want ?? "skill", content: readFileSync(direct, "utf8"), files: {}, via: "github" };
  }

  const folders = existsSync(root)
    ? readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(join(root, e.name, "SKILL.md")))
        .map((e) => e.name)
    : [];
  if (folders.length === 0) return null;

  const chosen = want ? folders.find((f) => f === want) : folders.length === 1 ? folders[0] : undefined;
  if (!chosen) {
    throw new Error(
      want
        ? `No skill called ${want} there. Found: ${folders.join(", ")}`
        : `That repo has ${folders.length} skills. Pick one: ${folders.join(", ")}`,
    );
  }

  const dir = join(root, chosen);
  const files: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // One level only, and nothing hidden: a skill's extra files are references
    // beside it, not a source tree, and `.drymem-managed` must not travel.
    if (!entry.isFile() || entry.name === "SKILL.md" || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (statSync(path).size > 200_000) continue;
    files[entry.name] = readFileSync(path, "utf8");
  }
  return { name: chosen, content: readFileSync(join(dir, "SKILL.md"), "utf8"), files, via: "github" };
}

/** Where skills.sh-style repositories keep them. */
const LAYOUTS = ["skills", ".claude/skills", "", "src/skills"];

async function fromGithub(spec: Spec): Promise<Fetched> {
  if (!spec.skill) {
    throw new Error(
      `Name the skill: ${originOf(spec)}@<skill-name>. ` +
        "Without their CLI there is no index to read.",
    );
  }
  for (const branch of ["HEAD", "main", "master"]) {
    for (const layout of LAYOUTS) {
      const path = [layout, spec.skill, "SKILL.md"].filter(Boolean).join("/");
      const url = `https://raw.githubusercontent.com/${spec.owner}/${spec.repo}/${branch}/${path}`;
      const response = await fetch(url).catch(() => null);
      if (!response?.ok) continue;
      return { name: spec.skill, content: await response.text(), files: {}, via: "github" };
    }
  }
  throw new Error(`Could not find ${originOf(spec)} on GitHub.`);
}

/**
 * Fetch a skill. Their CLI first, a direct read second.
 *
 * The CLI is run inside a throwaway directory: `skills add` writes into the
 * current project, and importing something is not the same as installing it
 * here — that decision belongs to `skills add`, after a human has read it.
 */
export async function fetchSkill(spec: Spec): Promise<Fetched> {
  const scratch = mkdtempSync(join(tmpdir(), "drymem-import-"));
  try {
    execFileSync("npx", ["-y", "skills", "add", `${spec.owner}/${spec.repo}`, "--yes"], {
      cwd: scratch,
      stdio: "pipe",
      timeout: 120_000,
    });
    for (const layout of [".claude/skills", ".agents/skills", "skills"]) {
      const found = readSkillTree(join(scratch, layout), spec.skill);
      if (found) return { ...found, via: "skills.sh" };
    }
  } catch {
    // No npx, no network, or a repo their CLI does not know. Read it directly.
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return fromGithub(spec);
}
