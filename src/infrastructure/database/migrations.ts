import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "./db-connector.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function runMigrations(): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)");

  const currentVersionRow = db.prepare("SELECT MAX(version) as v FROM schema_migrations").get() as { v: number | null };
  const currentVersion = currentVersionRow?.v || 0;

  const migrationsDir = path.join(__dirname, "../../migrations");
  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir);
  }

  const files = fs.readdirSync(migrationsDir).filter(file => file.endsWith(".sql")).sort();
  let migrationsApplied = 0;

  const executeTransaction = db.transaction((version: number, sql: string) => {
    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(version);
  });

  for (const file of files) {
    const match = file.match(/^(\d+)_/);
    const versionStr = match?.[1];
    if (versionStr === undefined) continue;

    const version = parseInt(versionStr, 10);

    if (version > currentVersion) {
      const sqlContent = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      executeTransaction(version, sqlContent);
      migrationsApplied++;
    }
  }
}
