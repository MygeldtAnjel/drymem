import DatabaseConstructor, { type Database } from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

/**
 * ES Modules configuration: Get the current directory path.
 * This ensures the database path is always relative to the source code,
 * preventing SQLite from creating empty DBs in the project you are working on.
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Navigate up to the project root where drymem.sqlite lives.
 * Assuming this file is at: src/infrastructure/database/db-connector.ts
 * we go up 3 levels.
 */
const dbPath = path.resolve(__dirname, "../../../drymem.sqlite");

/**
 * Initialize the database using the absolute calculated path.
 */
const db: Database = new DatabaseConstructor(dbPath);

// Enable Write-Ahead Logging for better concurrency and performance
db.pragma("journal_mode = WAL");

export { db };
export default db;