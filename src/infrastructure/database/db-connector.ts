import DatabaseConstructor, { type Database } from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = process.env.DRYMEM_DB_PATH ?? path.resolve(__dirname, "../../../drymem.sqlite");

const db: Database = new DatabaseConstructor(dbPath);
db.pragma("journal_mode = WAL");

export { db };
export default db;