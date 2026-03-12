import * as readline from "readline";
import { SearchMemoriesUseCase, GetContextUseCase, DeleteMemoryUseCase } from "./core/use-cases/memory-use-cases.js";

const projectPath = process.argv[2] ?? process.cwd();

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function printResults(results: any[]): void {
  if (results.length === 0) {
    console.log("  (no results)");
    return;
  }
  for (const r of results) {
    console.log(`\n  [${r.topic_key}] (${r.scope ?? "—"}) · ${r.status} · updated ${formatDate(r.updated_at)}`);
    console.log(`  ${r.content.trim().replace(/\n/g, "\n  ")}`);
  }
}

function printHelp(): void {
  console.log(`
  Commands:
    <keyword>          Search memory for keyword
    context            Show recent project context (last 5 entries)
    delete <topic_key> Soft-delete a memory by topic key
    project            Show current project path
    help               Show this help
    exit / quit        Exit
  `);
}

async function main(): Promise<void> {
  console.log(`\ndrymem cli · project: ${projectPath}`);
  console.log(`Type a keyword to search, or "help" for commands.\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "drymem> ",
  });

  rl.prompt();

  rl.on("line", (line) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    if (input === "exit" || input === "quit") {
      console.log("bye.");
      rl.close();
      return;
    }

    if (input === "help") {
      printHelp();
      rl.prompt();
      return;
    }

    if (input === "context") {
      const results = GetContextUseCase.execute(projectPath);
      printResults(results);
      console.log();
      rl.prompt();
      return;
    }

    if (input === "project") {
      console.log(`  ${projectPath}`);
      console.log();
      rl.prompt();
      return;
    }

    if (input.startsWith("delete ")) {
      const topicKey = input.slice(7).trim();
      if (!topicKey) {
        console.log("  Usage: delete <topic_key>");
        rl.prompt();
        return;
      }
      const ok = DeleteMemoryUseCase.execute(topicKey, projectPath);
      console.log(ok ? `  deleted: ${topicKey}` : `  not found: ${topicKey}`);
      console.log();
      rl.prompt();
      return;
    }

    // default: search
    const results = SearchMemoriesUseCase.execute(input, projectPath);
    printResults(results);
    console.log();
    rl.prompt();
  });

  rl.on("close", () => {
    process.exit(0);
  });
}

main();
