#!/usr/bin/env /usr/bin/node
/**
 * drymem query helper — called from Claude Code hook scripts.
 * Usage: query.mjs <project_path> <command>
 *   command: context | search <keyword>
 */
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const DRYMEM_DIR =
  process.env.DRYMEM_DIR ?? resolve(__dirname, "../../..");
const DB_PATH =
  process.env.DRYMEM_DB_PATH ?? resolve(DRYMEM_DIR, "drymem.sqlite");

const projectPath = process.argv[2] ?? process.cwd();
const command = process.argv[3] ?? "context";
const keyword = process.argv[4] ?? "";

let db;
try {
  const Database = require(resolve(DRYMEM_DIR, "node_modules/better-sqlite3"));
  db = new Database(DB_PATH, { readonly: true });
} catch {
  process.exit(0);
}

try {
  if (command === "context") {
    const rows = db
      .prepare(
        `SELECT topic_key, content
         FROM memories
         WHERE project_path = ?
           AND deleted_at IS NULL
         ORDER BY updated_at DESC
         LIMIT 5`
      )
      .all(projectPath);

    if (rows.length > 0) {
      console.log(
        rows
          .map((r) => `### ${r.topic_key}\n${r.content}`)
          .join("\n\n---\n\n")
      );
    }
  } else if (command === "search" && keyword) {
    const rows = db
      .prepare(
        `SELECT topic_key, content
         FROM memories
         WHERE project_path = ?
           AND deleted_at IS NULL
           AND (topic_key LIKE '%' || ? || '%' OR content LIKE '%' || ? || '%')
         ORDER BY updated_at DESC
         LIMIT 5`
      )
      .all(projectPath, keyword, keyword);

    if (rows.length > 0) {
      console.log(
        rows
          .map((r) => `### ${r.topic_key}\n${r.content}`)
          .join("\n\n---\n\n")
      );
    }
  }
} catch {
  // Silent fail
} finally {
  db.close();
}
