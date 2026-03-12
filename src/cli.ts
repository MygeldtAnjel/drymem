import * as readline from "readline";
import {
  SaveMemoryUseCase,
  SearchMemoriesUseCase,
  GetContextUseCase,
  DeleteMemoryUseCase,
  SuggestTopicKeyUseCase,
} from "./core/use-cases/memory-use-cases.js";
import { MemoryRepository } from "./infrastructure/database/memory-repository.js";
import { db } from "./infrastructure/database/db-connector.js";
import { runMigrations } from "./infrastructure/database/migrations.js";

runMigrations();

const projectPath = process.argv[2] ?? process.cwd();

// ── Colors ────────────────────────────────────────────────────────────────────
const c = {
  reset:  "\x1b[0m",
  dim:    "\x1b[2m",
  bold:   "\x1b[1m",
  cyan:   "\x1b[36m",
  yellow: "\x1b[33m",
  green:  "\x1b[32m",
  red:    "\x1b[31m",
  gray:   "\x1b[90m",
};

function col(color: keyof typeof c, text: string): string {
  return `${c[color]}${text}${c.reset}`;
}

// ── Formatters ────────────────────────────────────────────────────────────────
function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtObservation(r: any): void {
  const topic = r.topic_key ? col("cyan", `[${r.topic_key}]`) : col("gray", "[no key]");
  const type  = col("yellow", r.type ?? "manual");
  const id    = col("gray", `#${r.id}`);
  const meta  = col("gray", `rev:${r.revision_count} dup:${r.duplicate_count} · ${fmtDate(r.updated_at ?? r.created_at)}`);
  console.log(`\n  ${id} ${type} ${topic}`);
  console.log(`  ${col("bold", r.title)}`);
  const preview = String(r.content ?? "").trim().slice(0, 300).replace(/\n/g, "\n  ");
  console.log(`  ${col("dim", preview)}`);
  console.log(`  ${meta}`);
}

function printHelp(): void {
  console.log(`
  ${col("bold", "drymem CLI")} — persistent memory for AI coding sessions

  ${col("yellow", "Search & Browse")}
    ${col("cyan", "<keyword>")}               Search observations by keyword
    ${col("cyan", "search <kw> [--type=T]")}  Search with optional type filter
    ${col("cyan", "context")}                  Show recent sessions + observations
    ${col("cyan", "list")}                     List all observations (newest first)
    ${col("cyan", "show <id>")}                Show full content of observation #id

  ${col("yellow", "Write")}
    ${col("cyan", "save")}                     Interactive: save a new observation
    ${col("cyan", "suggest <type> <title>")}   Suggest a topic_key

  ${col("yellow", "Delete")}
    ${col("cyan", "delete <id>")}              Soft-delete observation by ID

  ${col("yellow", "Info")}
    ${col("cyan", "stats")}                    Show DB statistics
    ${col("cyan", "types")}                    Show available observation types
    ${col("cyan", "project")}                  Show current project path
    ${col("cyan", "help")}                     Show this help
    ${col("cyan", "exit")}                     Exit
  `);
}

// ── Commands ──────────────────────────────────────────────────────────────────

function cmdSearch(keyword: string, typeFilter?: string): void {
  const results = SearchMemoriesUseCase.execute(keyword, projectPath, { type: typeFilter });
  if (!results.length) { console.log(col("gray", "\n  (no results)")); return; }
  for (const r of results) fmtObservation(r);
}

function cmdContext(): void {
  const ctx = GetContextUseCase.execute(projectPath);
  console.log("\n" + ctx);
}

function cmdList(): void {
  const rows = (db.prepare(`
    SELECT id, type, title, topic_key, scope, revision_count, duplicate_count, created_at, updated_at
    FROM observations
    WHERE project_path = ? AND deleted_at IS NULL
    ORDER BY created_at DESC LIMIT 50
  `).all(projectPath) as any[]);
  if (!rows.length) { console.log(col("gray", "\n  (empty)")); return; }
  for (const r of rows) fmtObservation(r);
  console.log(col("gray", `\n  ${rows.length} observation(s)`));
}

function cmdShow(idStr: string): void {
  const id = parseInt(idStr, 10);
  if (isNaN(id)) { console.log(col("red", "  Error: provide a numeric ID")); return; }
  const row = db.prepare("SELECT * FROM observations WHERE id = ?").get(id) as any;
  if (!row) { console.log(col("red", `  Not found: #${id}`)); return; }
  console.log();
  console.log(col("bold", `  #${row.id} [${row.type}] ${row.title}`));
  console.log(col("gray", `  topic_key : ${row.topic_key || "—"}`));
  console.log(col("gray", `  project   : ${row.project_path}`));
  console.log(col("gray", `  scope     : ${row.scope}`));
  console.log(col("gray", `  revisions : ${row.revision_count}  duplicates: ${row.duplicate_count}`));
  console.log(col("gray", `  created   : ${fmtDate(row.created_at)}`));
  console.log(col("gray", `  updated   : ${fmtDate(row.updated_at)}`));
  if (row.deleted_at) console.log(col("red", `  deleted   : ${fmtDate(row.deleted_at)}`));
  console.log();
  console.log(row.content);
}

function cmdDelete(idStr: string): void {
  const id = parseInt(idStr, 10);
  if (isNaN(id)) { console.log(col("red", "  Error: provide a numeric ID (use 'list' to find IDs)")); return; }
  const ok = DeleteMemoryUseCase.execute(id, projectPath);
  console.log(ok ? col("green", `  deleted #${id}`) : col("red", `  not found: #${id}`));
}

function cmdStats(): void {
  const total   = (db.prepare("SELECT COUNT(*) as n FROM observations WHERE project_path = ? AND deleted_at IS NULL").get(projectPath) as any).n;
  const deleted = (db.prepare("SELECT COUNT(*) as n FROM observations WHERE project_path = ? AND deleted_at IS NOT NULL").get(projectPath) as any).n;
  const sessions = (db.prepare("SELECT COUNT(*) as n FROM sessions WHERE project_path = ?").get(projectPath) as any).n;
  const byType  = db.prepare(`
    SELECT type, COUNT(*) as n FROM observations
    WHERE project_path = ? AND deleted_at IS NULL
    GROUP BY type ORDER BY n DESC
  `).all(projectPath) as any[];
  console.log(`\n  ${col("bold", "Stats")} — ${col("cyan", projectPath)}`);
  console.log(`  observations : ${col("yellow", String(total))}  (${deleted} soft-deleted)`);
  console.log(`  sessions     : ${col("yellow", String(sessions))}`);
  if (byType.length) {
    console.log(`\n  by type:`);
    for (const row of byType) console.log(`    ${col("cyan", row.type.padEnd(20))} ${row.n}`);
  }
}

function cmdTypes(): void {
  console.log(`\n  Available types:\n`);
  const types = [
    ["manual",          "General save (default)"],
    ["decision",        "Architecture or workflow decision"],
    ["architecture",    "System design or structure"],
    ["bugfix",          "Bug and its root cause + fix"],
    ["pattern",         "Reusable code pattern or convention"],
    ["config",          "Setup, infra, environment config"],
    ["discovery",       "Non-obvious finding or gotcha"],
    ["learning",        "Something learned about the codebase"],
    ["session_summary", "End-of-session summary"],
    ["passive",         "Auto-extracted from agent output"],
  ];
  for (const [t, desc] of types) {
    console.log(`    ${col("cyan", t.padEnd(18))} ${col("dim", desc)}`);
  }
}

function cmdSuggest(parts: string[]): void {
  const type  = parts[0] ?? "manual";
  const title = parts.slice(1).join(" ");
  if (!title) { console.log(col("red", "  Usage: suggest <type> <title>")); return; }
  const suggested = SuggestTopicKeyUseCase.execute(type, title);
  console.log(`\n  ${col("green", suggested)}`);
}

// ── Interactive save ──────────────────────────────────────────────────────────

async function cmdSave(rl: readline.Interface): Promise<void> {
  const ask = (q: string): Promise<string> =>
    new Promise(resolve => rl.question(col("cyan", `  ${q}: `), resolve));

  console.log(col("dim", "\n  (press Enter to skip optional fields)\n"));

  const title = (await ask("title")).trim();
  if (!title) { console.log(col("red", "  title is required")); return; }

  const type = (await ask("type [manual]")).trim() || "manual";
  const topic_key = (await ask("topic_key (optional)")).trim() || undefined;

  console.log(col("dim", "  content (end with a line containing only '.'): "));
  const lines: string[] = [];
  await new Promise<void>(resolve => {
    const onLine = (line: string) => {
      if (line === ".") { rl.removeListener("line", onLine); resolve(); }
      else lines.push(line);
    };
    rl.on("line", onLine);
  });

  const content = lines.join("\n").trim();
  if (!content) { console.log(col("red", "  content is required")); return; }

  const result = SaveMemoryUseCase.execute({ title, content, type, topic_key, project_path: projectPath });

  if (!result.success) {
    console.log(col("red", `  error: ${result.error}`));
    return;
  }

  const suggested = !topic_key ? SuggestTopicKeyUseCase.execute(type, title, content) : null;
  console.log(col("green", `\n  saved #${result.id} (${result.action})`));
  if (suggested) console.log(col("dim", `  suggested topic_key: ${suggested}`));
}

// ── Main REPL ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n${col("bold", "drymem")} ${col("gray", "·")} ${col("cyan", projectPath)}`);
  console.log(col("dim", 'type a keyword to search, or "help" for commands\n'));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: col("bold", "drymem") + col("gray", "> "),
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    const [cmd, ...rest] = input.split(/\s+/);

    if (cmd === "exit" || cmd === "quit") { console.log("bye."); rl.close(); return; }
    if (cmd === "help")    { printHelp(); }
    else if (cmd === "context") { cmdContext(); }
    else if (cmd === "list")    { cmdList(); }
    else if (cmd === "stats")   { cmdStats(); }
    else if (cmd === "types")   { cmdTypes(); }
    else if (cmd === "project") { console.log(`\n  ${projectPath}`); }
    else if (cmd === "show")    { cmdShow(rest[0] ?? ""); }
    else if (cmd === "delete")  { cmdDelete(rest[0] ?? ""); }
    else if (cmd === "suggest") { cmdSuggest(rest); }
    else if (cmd === "save") {
      // pause readline so the interactive save can take over
      rl.pause();
      await cmdSave(rl);
      rl.resume();
    }
    else if (cmd === "search") {
      const typeFlag = rest.find(r => r.startsWith("--type="));
      const typeFilter = typeFlag?.split("=")[1];
      const keyword = rest.filter(r => !r.startsWith("--")).join(" ");
      if (!keyword) console.log(col("red", "  Usage: search <keyword> [--type=bugfix]"));
      else cmdSearch(keyword, typeFilter);
    }
    else {
      // bare keyword → search
      cmdSearch(input);
    }

    console.log();
    rl.prompt();
  });

  rl.on("close", () => process.exit(0));
}

main();
